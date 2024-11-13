import { createPeer, type ISession, type Peer, SessionState } from "../peer.ts";
// @deno-types="@types/react"
import { useCallback, useRef, useState } from "react";

const baseUrl = "https://demo.lukas-coding.us/twirp";
// const baseUrl = "http://localhost:3000/twirp";

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
      baseUrl,
      peerId,
      groupId: "",
      token,
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        {
          urls: "turn:turn.upfor.xyz:3478",
          username: "demo",
          credential: "demo",
        },
      ],
    });

    p.onnewsession = (s) => {
      let start = performance.now();

      s.ontrack = ({ streams }) => {
        console.log("ontrack", streams[0]);
        update(s, (p) => p.remoteStream = streams[0]);
      };

      s.onstatechanged = (_, state) => {
        console.log("state changed", state);
        if (state === SessionState.Connected) {
          const elapsed = performance.now() - start;
          console.log(`it took ${elapsed}ms to connect`);
        }

        if (state === SessionState.Disconnected) {
          start = performance.now();
        }

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
    if (peer.current) peer.current.connect(otherPeerId);
  }, []);

  return {
    start,
    stop,
    connect,
    sessions,
  };
}
