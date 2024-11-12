import type {
  Ack,
  ITunnelClient,
  Message,
  MessageHeader,
  MessagePayload,
  PeerInfo,
} from "./rpc/v1/mod.ts";
import type { Logger } from "./logger.ts";

const POLL_TIMEOUT_MS = 60000;
const RETRY_DELAY_MS = 1000;
const RETRY_JITTER_MS = 100;

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
  readonly peerId: string;
  readonly logger: Logger;
  readonly reliableMaxTryCount: number;
  readonly asleep?: typeof defaultAsleep;
  readonly randUint32?: typeof defaultRandUint32;
}

export class Transport {
  public readonly peerId: string;
  public readonly connId: number;
  private readonly info: PeerInfo;
  private streams: Stream[];
  private abort: AbortController;
  public readonly logger: Logger;
  public readonly asleep: typeof defaultAsleep;
  private readonly randUint32: typeof defaultRandUint32;
  public onnewstream = (_: Stream) => { };
  public onclosed = (_reason: string) => { };

  constructor(
    private readonly client: ITunnelClient,
    public readonly opts: TransportOptions,
  ) {
    this.asleep = opts.asleep || defaultAsleep;
    this.randUint32 = opts.randUint32 || defaultRandUint32;

    this.peerId = opts.peerId;
    this.connId = this.randUint32(ReservedConnId.Max);
    this.info = {
      enableDiscovery: opts.enableDiscovery,
      projectId: "",
      groupId: "",
      peerId: this.peerId,
      connId: this.connId,
    };
    this.abort = new AbortController();
    this.logger = opts.logger.sub("transport", {
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
        queueMicrotask(() => this.handleMessages(resp.response.msgs));
      } catch (err) {
        let reason = "";
        if (err instanceof Error) {
          reason = err.message;
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

  close(reason?: string) {
    reason = reason || "transport is closed";
    this.abort.abort(reason);
    for (const s of this.streams) {
      s.close(reason);
    }
    this.streams = [];
  }

  private handleMessages(msgs: Message[]) {
    for (const msg of msgs) {
      if (this.abort.signal.aborted) return;
      if (!msg.header) continue;

      // TODO: maybe handle this on server
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
          msg.header.peerId,
          msg.header.connId,
          this.logger,
        );
        this.streams.push(stream);
        this.onnewstream(stream);
      }

      stream.recvq.enqueue(msg);
    }
  }

  async connect(otherPeerId: string) {
    const payload: MessagePayload = {
      payloadType: {
        oneofKind: "join",
        join: {},
      },
    };
    const header: MessageHeader = {
      peerId: this.peerId,
      connId: this.connId,
      otherPeerId: otherPeerId,
      otherConnId: ReservedConnId.Discovery,
      seqnum: 0,
      reliable: false,
    };
    await this.send(this.abort.signal, {
      header,
      payload,
    });
  }

  async send(signal: AbortSignal, msg: Message) {
    // TODO: emit disconnected state
    while (!signal.aborted) {
      try {
        const resp = await this.client.send({
          info: this.info,
          msg,
        }, {
          abort: signal,
          timeout: POLL_TIMEOUT_MS,
        });

        // make sure to not block polling loop
        queueMicrotask(() => this.handleMessages(resp.response.msgs));
        return;
      } catch (err) {
        if (err instanceof Error) {
          this.logger.error(err.message);
        }
        this.logger.warn("failed to send, retrying", { err });

        await this.asleep(
          RETRY_DELAY_MS + Math.random() * RETRY_JITTER_MS,
          this.abort.signal,
        ).catch(() => { });
      }
    }
  }
}

// Stream allows multiplexing on top of Transport, and
// configuring order and reliability mode
export class Stream {
  private readonly logger: Logger;
  private abort: AbortController;
  public recvq: Queue;
  public sendbuf: Record<string, Message>;
  public readonly peerId: string;
  public readonly connId: number;
  private lastSeqnum: number;
  public onpayload = async (_: MessagePayload) => { };
  public onclosed = (_reason: string) => { };

  constructor(
    private readonly transport: Transport,
    public readonly otherPeerId: string,
    public readonly otherConnId: number,
    logger: Logger,
  ) {
    this.logger = logger.sub("stream", {
      otherPeerId,
      otherConnId,
    });
    this.peerId = transport.peerId;
    this.connId = transport.connId;
    this.abort = new AbortController();
    this.sendbuf = {};
    this.recvq = new Queue(this.logger);
    this.recvq.onmsg = (msg) => this.handleMessage(msg);
    this.lastSeqnum = 0;
  }

  async send(payload: MessagePayload, reliable: boolean) {
    const msg: Message = {
      header: {
        peerId: this.transport.peerId,
        connId: this.transport.connId,
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
    this.sendbuf[msg.header!.seqnum] = msg;
    const resendLimit = this.transport.opts.reliableMaxTryCount;
    let tryCount = resendLimit;
    const seqnum = msg.header!.seqnum;

    while (!this.abort.signal.aborted) {
      await this.transport.send(this.abort.signal, msg);

      await this.transport.asleep(
        RETRY_DELAY_MS + Math.random() * RETRY_JITTER_MS,
        this.abort.signal,
      ).catch(() => { });

      if (!(seqnum in this.sendbuf)) {
        break;
      }

      if (tryCount <= 0) {
        this.logger.warn("reached the maximum resend limit", {
          seqnum,
          resendLimit,
          reliable,
        });

        // TODO: SOMEHOW THIS KEEPS MESSSING UP CONNECTION
        this.logger.debug(`${this.otherPeerId}:${this.otherConnId} is staled`);
        // this.close(`${this.otherPeerId}:${this.otherConnId} is staled`);
        break;
      }

      tryCount--;
      this.logger.debug("resending", { ...msg.header });
    }
  }

  private async handleMessage(msg: Message) {
    const payload = msg.payload!.payloadType;
    this.logger.debug("received message", {
      msg,
      seqnum: msg.header?.seqnum,
      payloadType: payload.oneofKind,
    });
    switch (payload.oneofKind) {
      case "ack":
        this.handleAck(payload.ack);
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
        delete this.sendbuf[s];
      }
    }
  }

  close(reason?: string) {
    reason = reason || "session is closed";
    this.abort.abort(reason);
    this.onclosed(reason);
  }
}
