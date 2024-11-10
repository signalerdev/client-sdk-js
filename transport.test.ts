import { assertEquals, assertGreater } from "jsr:@std/assert@1.0.7";
import { afterEach, describe, it } from "jsr:@std/testing@1.0.4/bdd";
import {
  delay,
  ReservedConnId,
  Transport,
  type TransportOptions,
} from "./transport.ts";
import type {
  ITunnelClient,
  Message,
  RecvReq,
  RecvResp,
  SendReq,
  SendResp,
} from "./rpc/v1/mod.ts";
import type { UnaryCall } from "@protobuf-ts/runtime-rpc";
import type { RpcOptions } from "@protobuf-ts/runtime-rpc";
import { Logger } from "./logger.ts";

async function waitFor(
  conditionFn: () => boolean | Promise<boolean>,
  timeout: number = 5000,
  interval: number = 50,
): Promise<void> {
  const start = performance.now();

  while ((performance.now() - start) < timeout) {
    if (await conditionFn()) {
      return;
    }
    await delay(interval);
  }

  throw new Error(`waitFor: condition not met within ${timeout}ms`);
}

class MockClient implements ITunnelClient {
  private readonly queues: Record<string, Message[]>;

  constructor() {
    this.queues = {};
  }

  getq(id: string) {
    const q = this.queues[id] || [];
    this.queues[id] = q;
    return q;
  }

  send(input: SendReq, _options?: RpcOptions): UnaryCall<SendReq, SendResp> {
    const msg = input.msg!;
    const hdr = msg.header!;
    const id = `${hdr.peerId}:${hdr.connId}`;
    const otherId = `${hdr.otherPeerId}:${hdr.otherConnId}`;
    this.getq(otherId).push(msg);

    const recv = this.getq(id).pop();
    const msgs: Message[] = [];
    if (recv) msgs.push(recv);

    // @ts-ignore: mock obj
    return Promise.resolve({ response: { msgs } });
  }

  recv(input: RecvReq, options?: RpcOptions): UnaryCall<RecvReq, RecvResp> {
    const info = input.info!;
    const id = `${info.peerId}:${info.connId}`;
    const discoveryId = `${info.peerId}:${ReservedConnId.Discovery}`;
    const msgs: Message[] = [];
    const resp = { response: { msgs } };
    const signal = options?.abort;

    // @ts-ignore: mock obj
    return waitFor(
      () => {
        let recv = this.getq(id).pop();
        if (recv) msgs.push(recv);
        recv = this.getq(discoveryId).pop();
        if (recv) msgs.push(recv);
        const aborted = !!signal && signal.aborted;
        return msgs.length > 0 || aborted;
      },
    )
      .catch(() => resp)
      .then(() => resp);
  }
}

describe("util", () => {
  it("should wait for stream count", async () => {
    let streamCount = 0;
    setTimeout(() => {
      streamCount++;
    }, 200);
    await waitFor(() => (streamCount > 0));
    assertGreater(streamCount, 0);
  });
});

describe("transport", () => {
  afterEach(() => delay(100)); // make sure all timers have exited

  it("should receive join", async () => {
    const logger = new Logger("test", {});
    const client = new MockClient();
    const opts: TransportOptions = {
      enableDiscovery: false,
      peerId: "peerA",
      logger,
      reliableMaxTryCount: 3,
      asleep: (ms, opts) => delay(ms / 100, opts), // speedup by 100x
    };
    const peerA = new Transport(client, opts);
    const peerB = new Transport(client, { ...opts, peerId: "peerB" });
    let streamCountA = 0;
    let payloadCountA = 0;
    let streamCountB = 0;
    peerA.onnewstream = (s) => {
      assertEquals(s.otherPeerId, peerB.peerId);
      assertEquals(s.otherConnId, peerB.connId);
      streamCountA++;

      s.onpayload = () => {
        payloadCountA++;
        return Promise.resolve();
      };
    };
    peerB.onnewstream = (s) => {
      assertEquals(s.otherPeerId, peerA.peerId);
      assertEquals(s.otherConnId, peerA.connId);
      streamCountB++;

      s.send({
        payloadType: {
          oneofKind: "join",
          join: {},
        },
      }, true);
    };

    peerA.listen();
    peerB.listen();

    peerA.connect("peerB");

    await waitFor(() => streamCountA > 0 && streamCountB > 0);
    await delay(100);

    peerA.close();
    peerB.close();

    assertEquals(streamCountA, 1);
    assertEquals(streamCountB, 1);
    assertEquals(payloadCountA, 1);
  });
});
