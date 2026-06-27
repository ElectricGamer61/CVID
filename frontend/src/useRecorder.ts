import { useRef, useState } from "react";

// Minimal mic recorder built on MediaRecorder. Returns a webm blob on stop.
export function useRecorder() {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string>("");
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const resolveRef = useRef<((b: Blob | null) => void) | null>(null);

  const start = async (): Promise<boolean> => {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const mr = new MediaRecorder(stream);
      mr.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        const blob = chunksRef.current.length ? new Blob(chunksRef.current, { type: "audio/webm" }) : null;
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        resolveRef.current?.(blob);
        resolveRef.current = null;
      };
      mediaRef.current = mr;
      mr.start();
      setRecording(true);
      return true;
    } catch (e: any) {
      setError(e?.message || "Microphone unavailable");
      setRecording(false);
      return false;
    }
  };

  // Stops recording and resolves with the recorded blob.
  const stop = (): Promise<Blob | null> =>
    new Promise((resolve) => {
      const mr = mediaRef.current;
      if (!mr || mr.state === "inactive") { resolve(null); return; }
      resolveRef.current = resolve;
      mr.stop();
      setRecording(false);
    });

  return { recording, error, start, stop };
}
