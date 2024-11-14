import { TunnelClient } from "./rpc/v1/mod.ts";
import {
  type RpcOptions,
  TwirpFetchTransport,
  type UnaryCall,
} from "./deps.ts";
import { Transport } from "./transport.ts";
import { Logger } from "./logger.ts";
import { Session } from "./session.ts";
import { ITunnelClient } from "./rpc/v1/tunnel.client.ts";
export { SessionState } from "./session.ts";

export type ISession = Pick<
  Session,
  | "addTrack"
  | "removeTrack"
  | "ontrack"
  | "getReceivers"
  | "getSenders"
  | "ondatachannel"
  | "createDataChannel"
  // abstraction starts here
  | "start"
  | "close"
  | "id"
  | "onstatechanged"
>;

export interface PeerOptions {
  baseUrl: string;
  groupId: string;
  peerId: string;
  token: string;
  iceServers: RTCIceServer[];
}

// Peer is a mediator for signaling and all sessions
export class Peer {
  private transport: Transport;
  private readonly logger: Logger;
  public onnewsession = (_s: ISession) => {};
  private sessions: Session[];
  public readonly peerId: string;

  constructor(
    client: ITunnelClient,
    opts: PeerOptions,
  ) {
    this.peerId = opts.peerId;
    this.logger = new Logger("peer", { peerId: this.peerId });
    this.sessions = [];

    const rtcConfig: RTCConfiguration = {
      iceTransportPolicy: "all",
      iceCandidatePoolSize: 0,
      iceServers: opts.iceServers,
    };
    this.transport = new Transport(client, {
      enableDiscovery: false,
      groupId: opts.groupId,
      peerId: opts.peerId,
      logger: this.logger,
      reliableMaxTryCount: 3, // TODO: deprecate this?
    });
    this.transport.onnewstream = (s) => {
      const sess = new Session(s, rtcConfig);
      this.sessions.push(sess);
      this.onnewsession(sess);
    };
  }

  start() {
    this.transport.listen();
  }

  stop() {
    this.transport.close();
    for (const s of this.sessions) {
      s.close();
    }
    this.sessions = [];
  }

  connect(otherGroupId: string, otherPeerID: string) {
    // TODO: should keep sending, maybe every second?
    this.transport.connect(otherGroupId, otherPeerID);
  }
}

export async function createPeer(opts: PeerOptions): Promise<Peer> {
  // TODO: add hook for refresh token
  const twirp = new TwirpFetchTransport({
    baseUrl: opts.baseUrl,
    sendJson: false,
    interceptors: [
      {
        // adds auth header to unary requests
        interceptUnary(next, method, input, options: RpcOptions): UnaryCall {
          if (!options.meta) {
            options.meta = {};
          }
          options.meta["Authorization"] = `Bearer ${token}`;
          return next(method, input, options);
        },
      },
    ],
  });
  const client = new TunnelClient(twirp);
  const token = opts.token;

  const resp = await client.prepare({});
  const iceServers = { ...opts.iceServers };
  for (const s of resp.response.iceServers) {
    iceServers.push({
      urls: s.urls,
      username: s.username,
    });
  }
  const peer = new Peer(client, { ...opts, "iceServers": iceServers });
  return peer;
}
