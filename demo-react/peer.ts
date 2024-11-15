import { createPeer, type ISession, type Peer, SessionState } from "../peer.ts";
// @deno-types="@types/react"
import { useCallback, useRef, useState } from "react";

const BASE_URL = "https://demo.lukas-coding.us/twirp";
// const BASE_URL = "http://localhost:3000/twirp";
const DEFAULT_GROUP = "default";

interface SessionProps {
  key: string;
  sess: ISession;
  remoteStream: MediaStream | null;
  loading: boolean;
}

export function usePeer(localStream: MediaStream | null) {
  const peer = useRef<Peer | null>(null);
  const [sessions, setSessions] = useState<Record<string, SessionProps>>({});

  type UpdateHandler = (props: SessionProps) => void;
  const update = useCallback((s: ISession, cb: UpdateHandler) => {
    setSessions((prev) => {
      const session = prev[s.id()] || {
        key: "",
        sess: s,
        remoteStream: null,
        loading: true,
      };
      cb(session);

      session.key = `${s.id()}:${performance.now()}`;
      return {
        ...prev,
        [s.id()]: session,
      };
    });
  }, []);

  const start = useCallback(async (peerId: string) => {
    if (peer.current) return;

    const resp = await fetch(`/auth?id=${peerId}`, {
      method: "GET",
    });
    const token = await resp.text();
    const p = await createPeer({
      baseUrl: BASE_URL,
      peerId,
      groupId: DEFAULT_GROUP,
      token,
      iceServers: [],
    });

    p.onnewsession = (s) => {
      s.ontrack = ({ streams }) => {
        console.log("ontrack", streams[0]);
        update(s, (p) => p.remoteStream = streams[0]);
      };

      s.onstatechanged = (_, state) => {
        console.log("state changed", state);
        update(s, (p) => {
          p.loading = state !== SessionState.Connected;
        });
        if (state === SessionState.Closed) {
          setSessions((prev) => {
            const newSessions = { ...prev };
            delete newSessions[s.id()];
            return newSessions;
          });
        }
      };

      if (localStream) {
        for (const track of localStream.getTracks()) {
          s.addTrack(track, localStream);
        }
      }

      update(s, () => {});
    };
    p.start();
    peer.current = p;

    return () => {
      p.stop();
      peer.current = null;
    };
  }, [localStream, update]);

  const stop = useCallback(() => {
    if (!peer.current) return;
    peer.current.stop();
    peer.current = null;
  }, []);

  const connect = useCallback((otherPeerId: string) => {
    if (peer.current) peer.current.connect(DEFAULT_GROUP, otherPeerId);
  }, []);

  return {
    start,
    stop,
    connect,
    sessions,
  };
}
