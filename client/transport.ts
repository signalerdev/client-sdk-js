import type {
  Ack,
  Message,
  MessageHeader,
  MessagePayload,
  PeerInfo,
} from "./tunnel";
import {
  ITunnelClient,
} from "./tunnel.client";
import type { Logger } from "./logger";

const POLL_TIMEOUT_MS = 60000;
const RETRY_DELAY_MS = 1000;
const RETRY_JITTER_MS = 100;
const MAX_RELIABLE_RETRY_COUNT = 5;

export enum ReservedConnId {
  Discovery = 0,
  Max = 16,
}

export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(resolve, ms);

    // If an AbortSignal is provided, listen for the 'abort' event
    if (signal) {
      signal.addEventListener("abort", () => {
        clearTimeout(timeoutId); // Cancel the delay
        reject(new Error(signal.reason));
      });
    }
  });
}

const defaultAsleep = delay;
const defaultRandUint32 = (
  reserved: number,
) => (Math.floor(Math.random() * ((2 ** 32) - reserved)) + reserved);
const defaultIsRecoverable = (_err: Error) => true;

// This is a processing queue that can handle unreliable and reliable messages.
// The processing prioritizes unreliable messages over reliable messages.
// Reliable messages will be always deduplicated, unreliable messages will not be deduped.
class Queue {
  private map: Map<number, [number, Message]>;
  private emitted: Map<number, [number, Message]>;
  private unreliable: Message[];
  private processing: boolean;
  private readonly logger: Logger;
  public onmsg = async (_: Message) => { };

  constructor(logger: Logger) {
    this.logger = logger.sub("queue");
    this.map = new Map();
    this.emitted = new Map();
    this.unreliable = [];
    this.processing = false;
  }

  enqueue(msg: Message) {
    if (!msg.header?.reliable) {
      this.unreliable.push(msg);
    } else {
      const seqnum = msg.header!.seqnum;
      if (this.map.has(seqnum) || this.emitted.has(seqnum)) return;
      this.map.set(seqnum, [performance.now(), msg]);
    }

    // TODO: control queue size by pruning old messages.
    this.processNext();
  }

  async processNext() {
    if (this.processing) return;

    let msg = this.unreliable.pop();
    if (!msg) {
      const res = this.map.entries().next().value;
      if (!res) return;

      const [key, value] = res;
      this.map.delete(key);
      this.emitted.set(key, value);
      const [_, m] = value;
      if (!m.header) return;
      msg = m;
    }

    this.processing = true;
    try {
      await this.onmsg(msg);
    } catch (err) {
      const obj: Record<string, unknown> = { msg };
      if (err instanceof Error) {
        obj["err"] = err;
      }
      this.logger.error("error processing message", obj);
    }
    this.processing = false;
    this.processNext();
  }
}

export interface TransportOptions {
  readonly enableDiscovery: boolean;
  readonly groupId: string;
  readonly peerId: string;
  readonly logger: Logger;
  readonly asleep?: typeof defaultAsleep;
  readonly randUint32?: typeof defaultRandUint32;
  readonly isRecoverable?: typeof defaultIsRecoverable;
}

export class Transport {
  public readonly groupId: string;
  public readonly peerId: string;
  public readonly connId: number;
  private readonly info: PeerInfo;
  private streams: Stream[];
  private abort: AbortController;
  public readonly logger: Logger;
  public readonly asleep: typeof defaultAsleep;
  private readonly randUint32: typeof defaultRandUint32;
  private readonly isRecoverable: typeof defaultIsRecoverable;
  public onnewstream = (_: Stream) => { };
  public onclosed = (_reason: string) => { };

  constructor(
    private readonly client: ITunnelClient,
    public readonly opts: TransportOptions,
  ) {
    this.asleep = opts.asleep || defaultAsleep;
    this.randUint32 = opts.randUint32 || defaultRandUint32;
    this.isRecoverable = opts.isRecoverable || defaultIsRecoverable;

    this.groupId = opts.groupId;
    this.peerId = opts.peerId;
    this.connId = this.randUint32(ReservedConnId.Max);
    this.info = {
      connId: this.connId,
      enableDiscovery: opts.enableDiscovery,
    };
    this.abort = new AbortController();
    this.logger = opts.logger.sub("transport", {
      groupId: this.opts.groupId,
      peerId: this.opts.peerId,
      connId: this.connId,
    });
    this.streams = [];
  }

  async listen() {
    while (!this.abort.signal.aborted) {
      try {
        const resp = await this.client.recv({
          info: this.info,
        }, { abort: this.abort.signal, timeout: POLL_TIMEOUT_MS });

        // make sure to not block polling loop
        new Promise(() => this.handleMessages(resp.response.msgs));
      } catch (err) {
        let reason = "";
        if (err instanceof Error) {
          reason = err.message;
          if (!this.isRecoverable(err)) {
            this.logger.debug("unrecoverable error, force closing", { err });
            this.close(reason);
            return;
          }
        }

        this.logger.error("failed to poll", { reason });
        await this.asleep(
          RETRY_DELAY_MS + Math.random() * RETRY_JITTER_MS,
          this.abort.signal,
        ).catch(() => { });
      }
    }
    this.logger.debug("connection closed");
  }

  async close(reason?: string) {
    reason = reason || "transport is closed";
    await Promise.all(this.streams.map((s) => s.close(reason)));
    // Give a chance for graceful shutdown before aborting the connection
    this.abort.abort(reason);
    this.logger.debug("transport is now closed", { reason });
    this.streams = [];
  }

  private handleMessages = (msgs: Message[]) => {
    for (const msg of msgs) {
      if (this.abort.signal.aborted) return;
      if (!msg.header) continue;

      if (
        msg.header.otherConnId >= ReservedConnId.Max &&
        msg.header.otherConnId != this.connId
      ) {
        this.logger.warn(
          "received messages from a stale connection, ignoring",
          { receivedConnID: msg.header!.otherConnId },
        );
        continue;
      }

      let stream: Stream | null = null;
      for (const s of this.streams) {
        if (
          msg.header.groupId === s.otherGroupId &&
          msg.header.peerId === s.otherPeerId &&
          msg.header.connId === s.otherConnId
        ) {
          stream = s;
          break;
        }
      }

      if (!stream) {
        this.logger.debug(
          `session not found, creating one for ${msg.header.peerId}:${msg.header.connId}`,
        );

        if (msg.header.peerId == this.peerId) {
          this.logger.warn("loopback detected, ignoring messages");
          return;
        }

        stream = new Stream(
          this,
          msg.header.groupId,
          msg.header.peerId,
          msg.header.connId,
          this.logger,
        );
        this.streams.push(stream);
        this.onnewstream(stream);
      }

      stream.recvq.enqueue(msg);
    }
  };

  async connect(otherGroupId: string, otherPeerId: string, timeoutMs: number) {
    const payload: MessagePayload = {
      payloadType: {
        oneofKind: "join",
        join: {},
      },
    };
    const header: MessageHeader = {
      groupId: this.groupId,
      peerId: this.peerId,
      connId: this.connId,
      otherGroupId: otherGroupId,
      otherPeerId: otherPeerId,
      otherConnId: ReservedConnId.Discovery,
      seqnum: 0,
      reliable: false,
    };

    const start = performance.now();

    while ((performance.now() - start) < timeoutMs) {
      await this.send(this.abort.signal, {
        header,
        payload,
      });
      await this.asleep(
        RETRY_DELAY_MS + Math.random() * RETRY_JITTER_MS,
        this.abort.signal,
      ).catch(() => { });

      const found = this.streams.find((s) =>
        s.otherGroupId === otherGroupId && s.otherPeerId === otherPeerId
      );
      if (found) {
        return;
      }
    }

    throw new Error("connect failed with a timeout");
  }

  async send(signal: AbortSignal, msg: Message) {
    // In certain cases such as sending a fire-and-forget bye message,
    // the client will race between aborting and sending the signal.
    // do..while solves the race by making sure to send the message once.
    do {
      try {
        await this.client.send({
          msg,
        }, {
          abort: signal,
          timeout: POLL_TIMEOUT_MS,
        });
        return;
      } catch (err) {
        if (err instanceof Error) {
          const reason = err.message;
          if (!this.isRecoverable(err)) {
            this.close(reason);
            return;
          }
        }
        this.logger.warn("failed to send, retrying", { err });
      }

      await this.asleep(
        RETRY_DELAY_MS + Math.random() * RETRY_JITTER_MS,
        this.abort.signal,
      ).catch(() => { });
    } while (!signal.aborted && !this.abort.signal.aborted);
  }

  onstreamclosed(closed: Stream) {
    // TODO: use cooldown period to fully close. Otherwise, there's a chance that the other peer is
    // still sending some messages. In which case, we need to still ignore for some time until completely quiet.

    // streams are created by transport. Thus, its object reference is the same.
    this.streams = this.streams.filter((s) => s != closed);
    this.logger.debug("stream has been closed", { streams: this.streams });
  }
}

// Stream allows multiplexing on top of Transport, and
// configuring order and reliability mode
export class Stream {
  private readonly logger: Logger;
  private abort: AbortController;
  public recvq: Queue;
  public ackedbuf: Record<string, boolean>;
  public readonly groupId: string;
  public readonly peerId: string;
  public readonly connId: number;
  private lastSeqnum: number;
  public onpayload = async (_: MessagePayload) => { };
  public onclosed = (_reason: string) => { };

  constructor(
    private readonly transport: Transport,
    public readonly otherGroupId: string,
    public readonly otherPeerId: string,
    public readonly otherConnId: number,
    logger: Logger,
  ) {
    this.logger = logger.sub("stream", {
      otherGroupId,
      otherPeerId,
      otherConnId,
    });
    this.groupId = transport.groupId;
    this.peerId = transport.peerId;
    this.connId = transport.connId;
    this.abort = new AbortController();
    this.ackedbuf = {};
    this.recvq = new Queue(this.logger);
    this.recvq.onmsg = (msg) => this.handleMessage(msg);
    this.lastSeqnum = 0;
  }

  async send(payload: MessagePayload, reliable: boolean) {
    const msg: Message = {
      header: {
        groupId: this.transport.groupId,
        peerId: this.transport.peerId,
        connId: this.transport.connId,
        otherGroupId: this.otherGroupId,
        otherPeerId: this.otherPeerId,
        otherConnId: this.otherConnId,
        seqnum: 0,
        reliable,
      },
      payload: { ...payload },
    };

    if (!reliable) {
      await this.transport.send(this.abort.signal, msg);
      return;
    }

    this.lastSeqnum++;
    msg.header!.seqnum = this.lastSeqnum;
    this.ackedbuf[msg.header!.seqnum] = false; // marked as unacked
    const resendLimit = MAX_RELIABLE_RETRY_COUNT;
    let tryCount = resendLimit;
    const seqnum = msg.header!.seqnum;

    // TODO: abort when generation counter doesn't match
    while (!this.abort.signal.aborted) {
      await this.transport.send(this.abort.signal, msg);

      // TODO: with 1 second, the resending causes the stream reconnection to fail.
      // stress test this more.
      await this.transport.asleep(
        5 * RETRY_DELAY_MS + Math.random() * RETRY_JITTER_MS,
        this.abort.signal,
      ).catch(() => { });

      // since ackedbuf doesn't delete the seqnum right away, it prevents from racing between
      // resending and acknolwedging
      if (this.ackedbuf[seqnum]) {
        break;
      }

      if (tryCount <= 0) {
        this.logger.warn("reached the maximum resend limit", {
          seqnum,
          resendLimit,
          reliable,
        });

        this.close(`${this.otherPeerId}:${this.otherConnId} is staled`);
        break;
      }

      tryCount--;
      this.logger.debug("resending", { ...msg.header });
    }
  }

  private async handleMessage(msg: Message) {
    const payload = msg.payload!.payloadType;
    switch (payload.oneofKind) {
      case "ack":
        this.handleAck(payload.ack);
        break;
      case "bye":
        this.close("received bye from other peer");
        break;
      case undefined:
        break;
      default: {
        if (msg.header!.reliable) {
          const ack: Ack = {
            ackRanges: [{
              seqnumStart: msg.header!.seqnum,
              seqnumEnd: msg.header!.seqnum + 1,
            }],
          };
          const reply: MessagePayload = {
            payloadType: { oneofKind: "ack", ack },
          };
          this.logger.debug("ack", { seqnum: msg.header!.seqnum });
          this.send(reply, false);
        }

        if (!msg.payload) return;
        await this.onpayload(msg.payload!);
        break;
      }
    }
  }

  handleAck(ack: Ack) {
    for (const r of ack.ackRanges) {
      for (let s = r.seqnumStart; s < r.seqnumEnd; s++) {
        this.logger.debug("received ack", { seqnum: s });
        this.ackedbuf[s] = true; // marked as acked
      }
    }
  }

  async close(reason?: string) {
    if (this.abort.signal.aborted) return;
    reason = reason || "session is closed";
    // make sure to give a chance to send a message
    await this.send({
      payloadType: {
        oneofKind: "bye",
        bye: {},
      },
    }, false);
    this.abort.abort(reason);
    this.transport.onstreamclosed(this);
    this.onclosed(reason);
    this.logger.debug("sent bye to the other peer", { reason });
  }
}
