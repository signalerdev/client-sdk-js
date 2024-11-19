import { type ITunnelClient, TunnelClient } from "./tunnel.client";
import { Transport } from "./transport";
import { Logger } from "./logger";
import { Session } from "./session";
import { RpcError, UnaryCall, RpcOptions } from "@protobuf-ts/runtime-rpc";
import { TwirpErrorCode, TwirpFetchTransport } from "@protobuf-ts/twirp-transport";

export type ISession = Pick<
  Session,
  | "addTrack"
  | "removeTrack"
  | "createDataChannel"
  | "connectionState"
  | "ondatachannel"
  | "onconnectionstatechange"
  | "ontrack"
  | "close"
  // abstraction starts here
  | "start"
  | "otherPeerId"
  | "otherConnId"
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
  public onnewsession = (_s: ISession) => { };
  private sessions: Session[];
  public readonly peerId: string;

  constructor(
    client: ITunnelClient,
    opts: PeerOptions,
    isRecoverable: (_err: Error) => boolean,
  ) {
    this.peerId = opts.peerId;
    this.logger = new Logger("peer", { peerId: this.peerId });
    this.sessions = [];

    const rtcConfig: RTCConfiguration = {
      bundlePolicy: "balanced",
      iceTransportPolicy: "all",
      iceCandidatePoolSize: 0,
      iceServers: opts.iceServers,
    };
    this.transport = new Transport(client, {
      enableDiscovery: false,
      groupId: opts.groupId,
      peerId: opts.peerId,
      logger: this.logger,
      isRecoverable,
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

  close() {
    this.sessions = [];
    this.transport.close();
  }

  connect(otherGroupId: string, otherPeerID: string, timeoutMs: number) {
    return this.transport.connect(otherGroupId, otherPeerID, timeoutMs);
  }
}

const TWIRP_FATAL_ERRORS: string[] = [
  TwirpErrorCode[TwirpErrorCode.permission_denied],
  TwirpErrorCode[TwirpErrorCode.invalid_argument],
  TwirpErrorCode[TwirpErrorCode.aborted],
  TwirpErrorCode[TwirpErrorCode.bad_route],
  TwirpErrorCode[TwirpErrorCode.dataloss],
  TwirpErrorCode[TwirpErrorCode.malformed],
  TwirpErrorCode[TwirpErrorCode.not_found],
  TwirpErrorCode[TwirpErrorCode.unauthenticated],
];

function isTwirpRecoverable(err: Error): boolean {
  if (!(err instanceof RpcError)) {
    return true;
  }

  return !TWIRP_FATAL_ERRORS.includes(err.code);
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
  const iceServers = [...(opts.iceServers || [])];
  for (const s of resp.response.iceServers) {
    iceServers.push({
      urls: s.urls,
      username: s.username,
      credential: s.credential,
    });
  }
  const peer = new Peer(
    client,
    { ...opts, "iceServers": iceServers },
    isTwirpRecoverable,
  );
  return peer;
}
