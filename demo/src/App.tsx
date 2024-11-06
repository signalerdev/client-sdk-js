import "./App.css";
// @deno-types="@types/react"
import { useEffect, useRef, useState } from "react";
import { usePeer } from "./peer.tsx";

function App() {
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
  }, [isLive]);

  return (
    <div>
      {(!stream || !isLive)
        ? (
          <>
            <input
              type="text"
              placeholder="your peerId"
              value={peerId}
              onChange={(e) => setPeerId(e.target.value)}
            />
            <button disabled={!stream} onClick={() => setIsLive(true)}>
              Go Live
            </button>
          </>
        )
        : (
          <>
            <input
              type="text"
              placeholder="other peerId"
              value={otherPeerId}
              onChange={(e) => setOtherPeerId(e.target.value)}
            />
            <button onClick={() => peer.connect(otherPeerId)}>Connect</button>
            <button onClick={() => setIsLive(false)}>Stop</button>
          </>
        )}

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
    <div>
      <h2>{props.title}</h2>
      {(props.loading || props.stream === null) && (
        <div className="spinner"></div>
      )}
      <video
        ref={videoRef}
        autoPlay
        style={{ width: "300px", height: "auto" }}
      />
    </div>
  );
}

export default App;
