import { TunnelClient } from "./rpc/v1/mod.ts";
import { TwirpFetchTransport } from "./deps.ts";
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
  extraIceServers: RTCIceServer[];
}

// Peer is a mediator for signaling and all sessions
export class Peer {
  private transport: Transport;
  private readonly logger: Logger;
  public onnewsession = (_s: ISession) => {};
  private sessions: Session[];

  constructor(
    public readonly peerId: string,
    baseUrl: string,
    opts?: PeerOptions,
  ) {
    this.logger = new Logger("peer", { peerId });
    const twirp = new TwirpFetchTransport({
      baseUrl,
      sendJson: true,
    });
    const client = new TunnelClient(twirp);
    this.sessions = [];

    const rtcConfig: RTCConfiguration = {
      iceTransportPolicy: "all",
      iceCandidatePoolSize: 0,
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        ...(opts?.extraIceServers || []),
      ],
    };
    this.transport = new Transport(client, {
      enableDiscovery: false,
      peerId: peerId,
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

  connect(otherPeerID: string) {
    // TODO: should keep sending, maybe every second?
    this.transport.connect(otherPeerID);
  }
}
