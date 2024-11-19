import { createPeer, type ISession, type Peer } from "@signalerdev/client";
// @deno-types="@types/react"
import { useCallback, useRef, useState, useEffect } from "react";

const BASE_URL = "https://demo.lukas-coding.us/twirp";
// const BASE_URL = "http://localhost:3000/twirp";
const DEFAULT_GROUP = "default";
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;

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
  const update = useCallback((id: string, s: ISession, cb: UpdateHandler) => {
    setSessions((prev) => {
      const session = prev[id] || {
        key: "",
        sess: s,
        remoteStream: null,
        loading: true,
      };
      cb(session);

      session.key = `${id}:${performance.now()}`;
      return {
        ...prev,
        [id]: session,
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
      groupId: DEFAULT_GROUP,
      peerId,
      token,
      iceServers: [],
    });

    p.onnewsession = (s) => {
      const id = `${s.otherPeerId}:${s.otherConnId}`;
      s.ontrack = ({ streams }) => {
        console.log("ontrack", streams[0]);
        update(id, s, (p) => {
          p.remoteStream = streams[0];
        });
      };

      s.onconnectionstatechange = () => {
        console.log(s.connectionState);
        const loading = s.connectionState !== "connected";
        update(id, s, (p) => {
          p.loading = loading;
        });

        if (s.connectionState === "closed") {
          setSessions((prev) => {
            const newSessions = { ...prev };
            delete newSessions[s.otherPeerId];
            return newSessions;
          });
        }
      };

      if (localStream) {
        for (const track of localStream.getTracks()) {
          s.addTrack(track, localStream);
        }
      }

      s.start(); // decide to accept or reject
      update(id, s, () => { });
    };
    peer.current = p;
    p.start();

    return () => {
      p.close();
      peer.current = null;
    };
  }, [localStream, update]);

  const stop = useCallback(() => {
    if (!peer.current) return;
    peer.current.close();
    peer.current = null;
  }, []);

  useEffect(() => {
    const beforeunload = () => {
      stop();
    };

    window.addEventListener("beforeunload", beforeunload);

    return () => {
      window.removeEventListener("beforeunload", beforeunload);
    };
  }, []);

  const connect = useCallback((otherPeerId: string) => {
    if (peer.current) {
      peer.current.connect(
        DEFAULT_GROUP,
        otherPeerId,
        DEFAULT_CONNECT_TIMEOUT_MS,
      );
    }
  }, []);

  return {
    start,
    stop,
    connect,
    sessions,
  };
}
