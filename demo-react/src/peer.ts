import { createPeer, type ISession, type Peer } from "@signalerdev/client";
import { create } from "zustand";
import { produce } from "immer";

const BASE_URL = "https://demo.lukas-coding.us/twirp";
// const BASE_URL = "http://localhost:3000/twirp";
const DEFAULT_GROUP = "default";
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;

interface SessionProps {
  key: number;
  sess: ISession;
  remoteStream: MediaStream | null;
  loading: boolean;
}

interface PeerState {
  ref: Peer | null;
  loading: boolean;
  sessions: Record<string, SessionProps>;
  start: (peerId: string, localStream: MediaStream | null) => Promise<void>;
  stop: () => void;
  connect: (otherPeerId: string) => void;
}

export const usePeerStore = create<PeerState>((set, get) => ({
  ref: null,
  sessions: {},
  loading: false,
  start: async (peerId, localStream) => {
    if (get().ref) return;
    if (get().loading) return;

    set({ loading: true });
    try {
      const resp = await fetch(`/auth?id=${peerId}`);
      const token = await resp.text();
      const p = await createPeer({
        baseUrl: BASE_URL,
        groupId: DEFAULT_GROUP,
        peerId,
        token,
      });

      p.onnewsession = (s) => {
        const id = `${s.otherPeerId}:${s.otherConnId}`;

        s.ontrack = ({ streams }) => {
          console.log("ontrack", streams[0]);
          set(produce((state: PeerState) => {
            state.sessions[id].remoteStream = streams[0];
            state.sessions[id].key = performance.now();
          }));
        };

        s.onconnectionstatechange = () => {
          console.log(s.connectionState);
          if (s.connectionState === "closed") {
            set((state) => {
              const { [id]: _, ...rest } = state.sessions;
              return { sessions: rest };
            });
          } else {
            const loading = s.connectionState !== "connected";
            set(produce((state: PeerState) => {
              state.sessions[id].loading = loading;
              state.sessions[id].key = performance.now();
            }));
          }
        };

        localStream?.getTracks().forEach((track) => s.addTrack(track, localStream));

        set(produce((state: PeerState) => {
          state.sessions[id] = {
            key: performance.now(),
            sess: s,
            loading: true,
            remoteStream: null,
          };
        }));

        s.start();
      };

      p.onstatechange = () => {
        if (p.state === "closed") get().stop();
      }

      set({ ref: p });
      p.start();
    } catch (error) {
      console.error("Error starting peer:", error);
    }

    set({ loading: false });
  },
  stop: () => {
    get().ref?.close();
    set({ ref: null });
  },
  connect: async (otherPeerId) => {
    set({ loading: true });
    await get().ref?.connect(DEFAULT_GROUP, otherPeerId, DEFAULT_CONNECT_TIMEOUT_MS);
    set({ loading: false });
  }
}));
