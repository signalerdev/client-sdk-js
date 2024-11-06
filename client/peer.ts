import { TwirpFetchTransport } from "npm:@protobuf-ts/twirp-transport@2.9.4";
import { Logger, Transport, TunnelClient } from "jsr:@signalerdev/rpc@0.0.2";
import { Session } from "./session.ts";

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

// Peer is a mediator for signaling and all sessions
export class Peer {
  private transport: Transport;
  private readonly logger: Logger;
  public onnewsession = (_s: ISession) => {};
  private sessions: Session[];

  constructor(public readonly peerId: string, baseUrl: string) {
    this.logger = new Logger("peer", { peerId });
    const twirp = new TwirpFetchTransport({
      baseUrl,
      sendJson: true,
    });
    const client = new TunnelClient(twirp);
    this.sessions = [];

    this.transport = new Transport(client, {
      enableDiscovery: false,
      peerId: peerId,
      logger: this.logger,
      reliableMaxTryCount: 3, // TODO: deprecate this?
    });
    this.transport.onnewstream = (s) => {
      const sess = new Session(s);
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
