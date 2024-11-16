import {
  type ICECandidate,
  type MessagePayload,
  SdpKind,
  type Signal,
} from "./rpc/v1/mod.ts";
import { Logger } from "./logger.ts";
import type { Stream } from "./transport.ts";

const ICE_RESTART_MAX_COUNT = 2;
const ICE_RESTART_DEBOUNCE_DELAY_MS = 5000;

function toIceCandidate(ice: ICECandidate): RTCIceCandidateInit {
  return {
    candidate: ice.candidate,
    sdpMid: ice.sdpMid,
    sdpMLineIndex: ice.sdpMLineIndex,
    usernameFragment: ice.password,
  };
}

function toSDPType(kind: SdpKind): RTCSdpType {
  switch (kind) {
    case SdpKind.OFFER:
      return "offer";
    case SdpKind.ANSWER:
      return "answer";
    case SdpKind.PRANSWER:
      return "pranswer";
    case SdpKind.ROLLBACK:
      return "rollback";
    default:
      throw new Error(`unexpected kind: ${kind}`);
  }
}

function fromSDPType(t: RTCSdpType): SdpKind {
  switch (t) {
    case "offer":
      return SdpKind.OFFER;
    case "answer":
      return SdpKind.ANSWER;
    case "pranswer":
      return SdpKind.PRANSWER;
    case "rollback":
      return SdpKind.ROLLBACK;
    default:
      throw new Error(`unexpected sdp type: ${t}`);
  }
}

export class Session extends RTCPeerConnection {
  private makingOffer: boolean;
  private impolite: boolean;
  private pendingCandidates: RTCIceCandidateInit[];
  public readonly logger: Logger;
  private abort: AbortController;
  private generationCounter: number;
  private iceRestartCount: number;
  private lastIceRestart: number;
  private timers: number[];
  public closeReason?: string;

  constructor(
    private readonly stream: Stream,
    config: RTCConfiguration,
  ) {
    super(config);

    this.makingOffer = false;
    this.pendingCandidates = [];
    // Higher is impolite. [0-15] is reserved. One of the reserved value can be used
    // for implementing fixed "polite" role for lite ICE.
    this.impolite = this.stream.connId > this.stream.otherConnId;
    this.abort = new AbortController();
    this.logger = new Logger("session", {
      role: this.impolite ? "impolite" : "polite",
    });
    this.generationCounter = 0;
    this.iceRestartCount = 0;
    this.lastIceRestart = 0;
    this.timers = [];
    stream.onpayload = (msg) => this.handleMessage(msg);
    stream.onclosed = (reason) => this.close(reason);

    this.oniceconnectionstatechange = () => {
      this.logger.debug("iceconnectionstate changed", {
        "connectionstate": this.connectionState,
        "iceconnectionstate": this.iceConnectionState,
      });
    };

    let start = performance.now();
    this.onconnectionstatechange = () => {
      this.logger.debug("connectionstate changed", {
        "connectionstate": this.connectionState,
        "iceconnectionstate": this.iceConnectionState,
      });
      switch (this.connectionState) {
        case "connecting":
          start = performance.now();
          break;
        case "connected": {
          const elapsed = performance.now() - start;
          this.logger.debug(`it took ${elapsed}ms to connect`);
          this.iceRestartCount = 0;
          break;
        }
        case "disconnected":
          this.triggerIceRestart();
          break;
        case "failed":
          this.triggerIceRestart();
          break;
        case "closed":
          break;
      }
    };
    this.onnegotiationneeded = () => this.handleNegotiation();
    this.onicecandidate = ({ candidate }) => {
      const ice: ICECandidate = {
        candidate: "",
        sdpMLineIndex: 0,
        sdpMid: "",
      };
      if (!candidate || candidate.candidate === "") {
        this.logger.debug("ice gathering is finished");
        return;
      }

      ice.candidate = candidate.candidate;
      ice.sdpMLineIndex = candidate.sdpMLineIndex ?? undefined;
      ice.sdpMid = candidate.sdpMid ?? undefined;
      ice.username = candidate.usernameFragment ?? undefined;

      this.sendSignal({
        data: {
          oneofKind: "iceCandidate",
          iceCandidate: ice,
        },
      });
    };
  }

  private triggerIceRestart() {
    // the impolite offer will trigger the polite peer's to also restart Ice
    if (!this.impolite) return;

    const elapsed = performance.now() - this.lastIceRestart;
    if (elapsed < ICE_RESTART_DEBOUNCE_DELAY_MS) {
      // schedule ice restart after some delay;
      const delay = ICE_RESTART_DEBOUNCE_DELAY_MS - elapsed;
      const timerId = setTimeout(() => {
        this.triggerIceRestart();
        this.timers = this.timers.filter((v) => v === timerId);
      }, delay);
      return;
    }

    if (this.connectionState === "connected") return;
    if (this.iceRestartCount >= ICE_RESTART_MAX_COUNT) this.close();
    this.logger.debug("triggered ICE restart");
    this.restartIce();
    this.generationCounter++;
    this.iceRestartCount++;
    this.lastIceRestart = performance.now();
  }

  sendSignal(signal: Omit<Signal, "generationCounter">) {
    this.stream.send({
      payloadType: {
        oneofKind: "signal",
        signal: { ...signal, generationCounter: this.generationCounter },
      },
    }, true);
  }

  start() {
    this.handleNegotiation();
  }

  override close(reason?: string) {
    if (this.abort.signal.aborted) return;
    this.abort.abort(reason);
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    this.timers = [];
    this.logger.debug("closing");
    this.stream.close();
    this.closeReason = reason;
    super.close();

    // RTCPeerConnection will not emit closed connection. This is a polyfill to get around it.
    // https://stackoverflow.com/questions/66297347/why-does-calling-rtcpeerconnection-close-not-send-closed-event
    const closeEvent = new Event("connectionstatechange");
    this.dispatchEvent(closeEvent);
  }

  async handleNegotiation() {
    try {
      this.makingOffer = true;
      this.logger.debug("creating an offer");
      await this.setLocalDescription();
      if (!this.localDescription) {
        throw new Error("expect localDescription to be not empty");
      }

      this.sendSignal({
        data: {
          oneofKind: "sdp",
          sdp: {
            kind: fromSDPType(this.localDescription.type),
            sdp: this.localDescription.sdp,
          },
        },
      });
    } catch (err) {
      if (err instanceof Error) {
        this.logger.error("failed in negotiating", { err });
      }
    } finally {
      this.makingOffer = false;
    }
  }

  async handleMessage(payload: MessagePayload) {
    if (this.abort.signal.aborted) {
      this.logger.warn("session is closed, ignoring message");
      return;
    }
    switch (payload.payloadType.oneofKind) {
      case "signal":
        await this.handleSignal(payload.payloadType.signal);
        break;
      case "bye":
        this.close();
        break;
      case "join":
        // nothing to do here. SDK consumer needs to manually trigger the start
        break;
    }
  }

  async handleSignal(signal: Signal) {
    if (signal.generationCounter < this.generationCounter) {
      this.logger.warn("detected staled generationCounter signals, ignoring");
      return;
    }

    const msg = signal.data;
    if (signal.generationCounter > this.generationCounter) {
      // Sync generationCounter so this peer can reset its state machine
      // to start accepting new offers
      this.logger.debug("detected new generationCounter", {
        otherGenerationCounter: signal.generationCounter,
        generationCounter: this.generationCounter,
        msg,
      });

      if (msg.oneofKind === "iceCandidate") {
        const ice = toIceCandidate(msg.iceCandidate);
        this.pendingCandidates.push(ice);
        this.logger.warn(
          "expecting an offer but got ice candidates during an ICE restart, adding to pending.",
          { ice, msg },
        );
        return;
      }

      this.generationCounter = signal.generationCounter;
    }

    if (msg.oneofKind === "iceCandidate") {
      const ice = toIceCandidate(msg.iceCandidate);
      this.pendingCandidates.push(ice);
      await this.checkPendingCandidates();

      return;
    }

    if (msg.oneofKind != "sdp") {
      return;
    }

    const sdp = msg.sdp;
    this.logger.debug("received a SDP signal", { sdpKind: sdp.kind });
    const offerCollision = sdp.kind === SdpKind.OFFER &&
      (this.makingOffer || this.signalingState !== "stable");

    const ignoreOffer = this.impolite && offerCollision;
    if (ignoreOffer) {
      this.logger.debug("ignored offer");
      return;
    }

    this.logger.debug("creating an answer");
    await this.setRemoteDescription({
      type: toSDPType(sdp.kind),
      sdp: sdp.sdp,
    });
    await this.checkPendingCandidates();
    if (sdp.kind === SdpKind.OFFER) {
      await this.setLocalDescription();
      if (!this.localDescription) return;

      // when a signal is retried many times and still failing. The failing heartbeat will kick in and close.
      this.sendSignal({
        data: {
          oneofKind: "sdp",
          sdp: {
            kind: fromSDPType(this.localDescription.type),
            sdp: this.localDescription.sdp,
          },
        },
      });
    }

    return;
  }

  async checkPendingCandidates() {
    const readyStates: RTCPeerConnectionState[] = [
      "connected",
      "new",
      "disconnected",
      "failed",
    ];
    if (
      !readyStates.includes(this.connectionState) ||
      !this.remoteDescription
    ) {
      this.logger.debug("wait for adding pending candidates", {
        iceConnectionState: this.iceConnectionState,
        connectionState: this.connectionState,
        remoteDescription: this.remoteDescription,
        pendingCandidates: this.pendingCandidates.length,
      });
      return;
    }

    for (const candidate of this.pendingCandidates) {
      if (!candidate.candidate || candidate.candidate === "") {
        continue;
      }

      await this.addIceCandidate(candidate);
      this.logger.debug(`added ice: ${candidate.candidate}`);
    }
    this.pendingCandidates = [];
  }

  id(): string {
    return `${this.stream.otherPeerId}:${this.stream.otherConnId}`;
  }
}
