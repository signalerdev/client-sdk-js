import { TunnelClient } from "./rpc/v1/mod.ts";
import {
  type RpcOptions,
  type RpcTransport,
  TwirpFetchTransport,
  type UnaryCall,
} from "./deps.ts";
import { Transport } from "./transport.ts";
import { Logger } from "./logger.ts";
import { Session } from "./session.ts";
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
    transport: RpcTransport,
    opts: PeerOptions,
  ) {
    this.peerId = opts.peerId;
    this.logger = new Logger("peer", { peerId: this.peerId });

    const client = new TunnelClient(transport);
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
  const token = opts.token;

  // TODO: enhance iceServers with STUN and TURN servers
  const peer = new Peer(twirp, opts);
  return peer;
}
