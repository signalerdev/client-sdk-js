import {
  type ICECandidate,
  Logger,
  type MessagePayload,
  SdpKind,
  type Signal,
  type Stream,
} from "jsr:@signalerdev/rpc@0.0.1";

const ICE_RESTART_MAX_COUNT = 2;

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

export enum SessionState {
  New = "new",
  Initialized = "initialized",
  Connecting = "connecting",
  Connected = "connected",
  Disconnected = "disconnected",
  Closed = "closed",
}

export class Session extends RTCPeerConnection {
  private makingOffer: boolean;
  private impolite: boolean;
  private pendingCandidates: RTCIceCandidateInit[];
  public readonly logger: Logger;
  private abort: AbortController;
  private state: SessionState;
  private generationCounter: number;
  private iceRestartCount: number;

  public onstatechanged = (_from: SessionState, _to: SessionState) => {};

  constructor(
    private readonly stream: Stream,
  ) {
    const config: RTCConfiguration = {
      iceTransportPolicy: "all",
      iceCandidatePoolSize: 0,
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
      ],
    };
    super(config);

    this.makingOffer = false;
    this.pendingCandidates = [];
    this.impolite = this.stream.connId > this.stream.otherConnId;
    this.abort = new AbortController();
    this.state = SessionState.New;
    this.logger = new Logger("session", {
      role: this.impolite ? "impolite" : "polite",
    });
    this.generationCounter = 0;
    this.iceRestartCount = 0;
    stream.onpayload = this.handleMessage.bind(this);

    this.oniceconnectionstatechange = () => {
      this.logger.debug("iceconnectionstate changed", {
        "connectionstate": this.connectionState,
        "iceconnectionstate": this.iceConnectionState,
      });
    };

    this.onconnectionstatechange = () => {
      this.logger.debug("connectionstate changed", {
        "connectionstate": this.connectionState,
        "iceconnectionstate": this.iceConnectionState,
      });
      switch (this.connectionState) {
        case "connecting":
          this.updateState(SessionState.Connecting);
          break;
        case "connected":
          this.logger.debug("connection has recovered");
          this.updateState(SessionState.Connected);
          this.iceRestartCount = 0;
          break;
        case "disconnected":
          this.triggerIceRestart();
          this.updateState(SessionState.Disconnected);
          break;
        case "failed":
          this.triggerIceRestart();
          this.updateState(SessionState.Disconnected);
          break;
        case "closed":
          this.updateState(SessionState.Closed);
          break;
      }
    };
    this.onnegotiationneeded = this.handleNegotiation.bind(this);
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
    if (this.iceRestartCount >= ICE_RESTART_MAX_COUNT) this.close();
    this.logger.debug("connection failed, restarting ICE");
    this.restartIce();
    this.generationCounter++;
    this.iceRestartCount++;
  }

  start() {
    this.updateState(SessionState.Initialized);
  }

  sendSignal(signal: Omit<Signal, "generationCounter">) {
    this.stream.send({
      payloadType: {
        oneofKind: "signal",
        signal: { ...signal, generationCounter: this.generationCounter },
      },
    }, true);
  }

  override close() {
    if (this.abort.signal.aborted) return;
    this.abort.abort();
    this.logger.debug("closing");
    super.close();
    // TODO: handle graceful shutdown to other peer
    this.updateState(SessionState.Closed);
  }

  updateState(to: SessionState) {
    if (to == this.state) {
      return;
    }

    const from = this.state;
    this.state = to;
    if (this.onstatechanged) {
      this.onstatechanged(from, to);
    }
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
        await this.handleNegotiation();
        break;
    }
  }

  async handleSignal(signal: Signal) {
    if (signal.generationCounter > this.generationCounter) {
      // Sync generationCounter so this peer can reset its state machine
      // to start accepting new offers
      this.logger.debug("detected mismatch generationCounter, restarting ICE", {
        otherGenerationCounter: signal.generationCounter,
        generationCounter: this.generationCounter,
      });
      this.generationCounter = signal.generationCounter;
      this.restartIce();
    }

    const msg = signal.data;
    if (msg.oneofKind === "iceCandidate") {
      const ice = msg.iceCandidate;
      const candidate: RTCIceCandidateInit = {
        candidate: ice.candidate,
        sdpMid: ice.sdpMid,
        sdpMLineIndex: ice.sdpMLineIndex,
        usernameFragment: ice.password,
      };

      this.logger.debug(`received candidate: ${ice.candidate}`);
      this.pendingCandidates.push(candidate);
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
    const readyStates: RTCIceConnectionState[] = [
      "connected",
      "checking",
      "new",
      "disconnected",
      "completed",
    ];
    if (
      !readyStates.includes(this.iceConnectionState) ||
      !this.remoteDescription
    ) {
      this.logger.debug("wait for adding pending candidates", {
        iceConnectionState: this.iceConnectionState,
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

  id() {
    return `${this.stream.otherPeerId}:${this.stream.otherConnId}`;
  }
}