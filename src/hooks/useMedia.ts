import { useCallback, useEffect, useRef, useState } from "react";

// ------------------------------------------------------------------ camera
export type CamState = "off" | "starting" | "live" | "denied" | "unavailable";

export function useCamera() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<CamState>("off");

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setState("off");
  }, []);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setState("unavailable");
      return;
    }
    setState("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 }, facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setState("live");
    } catch (err) {
      setState(err instanceof DOMException && err.name === "NotAllowedError" ? "denied" : "unavailable");
    }
  }, []);

  /** Grab a full-resolution still frame as a JPEG blob. */
  const snap = useCallback(async (): Promise<Blob | null> => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return null;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")?.drawImage(v, 0, 0);
    return new Promise((res) => c.toBlob((b) => res(b), "image/jpeg", 0.92));
  }, []);

  useEffect(() => stop, [stop]);
  return { videoRef, state, start, stop, snap };
}

// ------------------------------------------------------------ push-to-talk
// Trusted voice: the transcript only fills the Request box; the user still presses Run.

interface SpeechRec {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

export function useSpeech(onText: (text: string, final: boolean) => void) {
  const recRef = useRef<SpeechRec | null>(null);
  const [listening, setListening] = useState(false);
  const Ctor =
    typeof window !== "undefined"
      ? ((window as unknown as Record<string, unknown>).SpeechRecognition ?? (window as unknown as Record<string, unknown>).webkitSpeechRecognition)
      : undefined;
  const supported = !!Ctor;

  const start = useCallback(() => {
    if (!Ctor || listening) return;
    const rec = new (Ctor as new () => SpeechRec)();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (e) => {
      let text = "";
      let final = false;
      for (let i = 0; i < e.results.length; i++) {
        text += e.results[i][0].transcript;
        final = final || e.results[i].isFinal;
      }
      onText(text.trim(), final);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  }, [Ctor, listening, onText]);

  const stop = useCallback(() => {
    recRef.current?.stop();
  }, []);

  return { supported, listening, start, stop };
}

// --------------------------------------------------------- audio recorder
// Untrusted audio: attached as media and judged by the firewall like any other clip.

export function useRecorder(onClip: (blob: Blob) => void) {
  const recRef = useRef<MediaRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const supported = typeof window !== "undefined" && "MediaRecorder" in window && !!navigator.mediaDevices?.getUserMedia;

  useEffect(() => {
    if (!recording) return;
    const t0 = Date.now();
    const id = window.setInterval(() => setSeconds(Math.floor((Date.now() - t0) / 1000)), 250);
    return () => window.clearInterval(id);
  }, [recording]);

  const start = useCallback(async () => {
    if (!supported || recording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        setSeconds(0);
        if (chunks.length) onClip(new Blob(chunks, { type: rec.mimeType || "audio/webm" }));
      };
      recRef.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      setRecording(false);
    }
  }, [supported, recording, onClip]);

  const stop = useCallback(() => recRef.current?.state === "recording" && recRef.current.stop(), []);
  return { supported, recording, seconds, start, stop };
}
