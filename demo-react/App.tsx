// @deno-types="@types/react"
import React, { useEffect, useRef, useState } from "react";
import { usePeer } from "./peer.ts";

export default function App() {
  const [peerId, setPeerId] = useState("");
  const [otherPeerId, setOtherPeerId] = useState("");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isLive, setIsLive] = useState(false);
  const peer = usePeer(stream);

  useEffect(() => {
    (async () => {
      const s = await navigator.mediaDevices.getUserMedia({ video: true });
      setStream(s);
    })();
  }, []);

  useEffect(() => {
    if (isLive) peer.start(peerId);
    else peer.stop();
  }, [isLive, peerId, peer]);

  return (
    <div>
      {(!stream || !isLive)
        ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setIsLive(true);
            }}
          >
            <fieldset role="group">
              <input
                type="text"
                placeholder="Your PeerId"
                value={peerId}
                onChange={(e) => setPeerId(e.target.value)}
              />
              <input type="submit" disabled={!stream} value="Go Live" />
            </fieldset>
          </form>
        )
        : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              peer.connect(otherPeerId);
            }}
          >
            <fieldset role="group">
              <input
                type="text"
                placeholder="Other PeerId"
                value={otherPeerId}
                onChange={(e) => setOtherPeerId(e.target.value)}
              />
              <input type="submit" value="Connect" />
              <button className="secondary" onClick={() => setIsLive(false)}>
                Stop
              </button>
            </fieldset>
          </form>
        )}

      <div className="grid" role="group">
        <VideoContainer stream={stream} loading={false} title="local" />
        {Object.entries(peer.sessions).map(([id, s]) => (
          <VideoContainer
            key={s.key}
            title={id}
            stream={s.remoteStream}
            loading={s.loading}
          />
        ))}
      </div>
    </div>
  );
}

interface VideoContainerProps {
  title: string;
  stream: MediaStream | null;
  loading: boolean;
}

function VideoContainer(props: VideoContainerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = props.stream;
    }
  }, [props.stream]);

  return (
    <article aria-busy={props.loading || props.stream === null}>
      <header>{props.title}</header>
      <video
        ref={videoRef}
        autoPlay
        style={{ width: "auto%", height: "500px", objectFit: "contain" }}
      />
    </article>
  );
}
