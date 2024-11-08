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
    <>
      <nav className="bottom">
        {(!stream || !isLive)
          ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setIsLive(true);
              }}
              className="responsive"
            >
              <nav className="center-align">
                <div className="field small border round">
                  <input
                    size={6}
                    type="text"
                    placeholder="You"
                    value={peerId}
                    onChange={(e) => setPeerId(e.target.value)}
                  />
                </div>
                <button type="submit" disabled={!stream} value="Go Live">
                  Go Live
                </button>
              </nav>
            </form>
          )
          : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                peer.connect(otherPeerId);
              }}
            >
              <nav className="max center-align">
                <div className="field small border round">
                  <input
                    size={6}
                    type="text"
                    placeholder="Other"
                    value={otherPeerId}
                    onChange={(e) => setOtherPeerId(e.target.value)}
                  />
                </div>
                <button type="submit">Connect</button>
                <button className="secondary" onClick={() => setIsLive(false)}>
                  Stop
                </button>
              </nav>
            </form>
          )}
      </nav>

      <main className="responsive max grid">
        <VideoContainer
          stream={stream}
          loading={false}
          title="local"
        />
        {Object.entries(peer.sessions).map(([id, s]) => (
          <VideoContainer
            key={s.key}
            title={id}
            stream={s.remoteStream}
            loading={s.loading}
          />
        ))}
      </main>
    </>
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

  const loading = props.loading || props.stream === null;
  return (
    <article className="s12 m6 no-padding">
      {loading ? <progress className="circle large"></progress> : (
        <video
          className="responsive"
          ref={videoRef}
          autoPlay
        />
      )}
      <div className="absolute bottom left right padding white-text">
        <nav>
          <h5>{props.title}</h5>
        </nav>
      </div>
    </article>
  );
}
