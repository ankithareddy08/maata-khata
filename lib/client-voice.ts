"use client";

import { useEffect, useRef, useState } from "react";
import { prepareRecording } from "@/lib/audio";
import { parseVoiceCommand } from "@/lib/voice-command";
import type { Understood } from "@/lib/understand";
import { Problem, SPEECH_CODE, type Lang, type ProblemCode } from "@/lib/i18n";

type Customer = { id: string; name: string };
export type RecorderPhase = "idle" | "permission" | "recording" | "processing";

function micError(cause: unknown): Problem {
  const name = cause instanceof Error ? cause.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return new Problem("MIC_DENIED");
  if (name === "NotFoundError") return new Problem("MIC_MISSING");
  if (name === "NotReadableError") return new Problem("MIC_BUSY");
  return cause instanceof Problem ? cause : new Problem("NO_RECORDER");
}

/** Tap to start, tap to stop. Resolves with a 16 kHz mono WAV, or null if cancelled. */
export function useRecorder(maxSeconds: number) {
  const [phase, setPhase] = useState<RecorderPhase>("idle");
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const settle = useRef<((value: Blob | null) => void) | null>(null);
  const cancelled = useRef(false);
  const analyser = useRef<AnalyserNode | null>(null);
  const context = useRef<AudioContext | null>(null);
  const samples = useRef<Uint8Array<ArrayBuffer> | null>(null);

  /** Current input loudness, 0–1, for a live waveform. */
  function level(): number {
    if (!analyser.current || !samples.current) return 0;
    analyser.current.getByteTimeDomainData(samples.current);
    let sum = 0;
    for (const value of samples.current) sum += ((value - 128) / 128) ** 2;
    return Math.min(1, Math.sqrt(sum / samples.current.length) * 4);
  }

  function cleanup() {
    void context.current?.close().catch(() => undefined);
    context.current = null;
    analyser.current = null;
    timers.current.forEach((timer) => { clearTimeout(timer); clearInterval(timer); });
    timers.current = [];
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  }
  useEffect(() => () => { cancelled.current = true; if (recorder.current?.state === "recording") recorder.current.stop(); cleanup(); }, []);

  function start(): Promise<Blob | null> {
    if (phase !== "idle") return Promise.resolve(null);
    cancelled.current = false;
    return new Promise((resolve, reject) => {
      settle.current = resolve;
      void (async () => {
        if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { reject(new Problem("NO_RECORDER")); return; }
        setPhase("permission");
        try {
          const live = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
          if (cancelled.current) { live.getTracks().forEach((track) => track.stop()); setPhase("idle"); resolve(null); return; }
          stream.current = live;
          try {
            const audioContext = new AudioContext();
            const node = audioContext.createAnalyser();
            node.fftSize = 512;
            audioContext.createMediaStreamSource(live).connect(node);
            context.current = audioContext;
            analyser.current = node;
            samples.current = new Uint8Array(node.fftSize);
          } catch { /* the waveform is decoration only */ }
          const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((type) => MediaRecorder.isTypeSupported(type));
          if (!mimeType) throw new Problem("NO_RECORDER");
          const media = new MediaRecorder(live, { mimeType, audioBitsPerSecond: 64_000 });
          const chunks: Blob[] = [];
          recorder.current = media;
          media.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
          media.onstop = async () => {
            cleanup();
            recorder.current = null;
            if (cancelled.current) { setPhase("idle"); resolve(null); return; }
            setPhase("processing");
            try {
              const prepared = await prepareRecording(new Blob(chunks, { type: media.mimeType }));
              setPhase("idle");
              if (prepared.details.peak < 0.001) { reject(new Problem("SILENT")); return; }
              resolve(prepared.audio);
            } catch (cause) { setPhase("idle"); reject(cause instanceof Error ? cause : new Problem("RETRY")); }
          };
          media.start();
          setSeconds(0);
          setPhase("recording");
          const began = Date.now();
          timers.current.push(setInterval(() => setSeconds(Math.floor((Date.now() - began) / 1000)), 250));
          timers.current.push(setTimeout(() => stop(), maxSeconds * 1000));
        } catch (cause) { cleanup(); setPhase("idle"); reject(micError(cause)); }
      })();
    });
  }
  function stop() { if (recorder.current?.state === "recording") recorder.current.stop(); }
  function cancel() {
    cancelled.current = true;
    if (recorder.current?.state === "recording") recorder.current.stop();
    else { cleanup(); setPhase("idle"); settle.current?.(null); }
  }
  return { phase, seconds, start, stop, cancel, level };
}

const SERVER_PROBLEMS: Record<string, ProblemCode> = {
  SETUP_REQUIRED: "SETUP_REQUIRED", KEY_REJECTED: "KEY_REJECTED", CREDITS: "LIMIT", RATE_LIMIT: "LIMIT",
  TIMEOUT: "TIMEOUT", NETWORK: "NETWORK", NO_SPEECH: "NO_WORDS", AUDIO_DURATION: "RETRY", AUDIO_FORMAT: "RETRY",
};

/** Speech to text in the chosen language. Throws a Problem the screen can translate. */
export async function transcribe(audio: Blob, lang: Lang, signal?: AbortSignal): Promise<string> {
  const form = new FormData();
  form.set("file", audio, "speech.wav");
  form.set("language", SPEECH_CODE[lang]);
  let response: Response;
  try { response = await fetch("/api/transcribe", { method: "POST", body: form, signal }); }
  catch { throw new Problem("NETWORK"); }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Problem(SERVER_PROBLEMS[String(result.code)] ?? "RETRY", typeof result.error === "string" ? result.error : undefined);
  if (typeof result.transcript !== "string" || !result.transcript.trim()) throw new Problem("NO_WORDS");
  return result.transcript.trim();
}

/** AI first; if it is unreachable, the offline rule parser still works. */
export async function understand(text: string, customers: Customer[]): Promise<Understood & { via: "ai" | "rules" }> {
  try {
    const response = await fetch("/api/understand", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, customers }), signal: AbortSignal.timeout(20_000) });
    if (response.ok) {
      const { result } = await response.json() as { result?: Understood };
      if (result) return { ...result, via: "ai" };
    }
  } catch { /* fall through to rules */ }
  return { ...parseVoiceCommand(text, customers), via: "rules" } as Understood & { via: "rules" };
}

let current: HTMLAudioElement | null = null;
let speechToken = 0;
export function stopSpeaking() { speechToken++; current?.pause(); current = null; }

/** Speak text in the chosen language. Resolves when finished (or at once if speech is unavailable). */
export async function speak(text: string, lang: Lang): Promise<void> {
  stopSpeaking();
  const token = speechToken;
  try {
    const response = await fetch("/api/speak", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, language: SPEECH_CODE[lang] }), signal: AbortSignal.timeout(15_000) });
    if (!response.ok || token !== speechToken) return;
    const { audio, type } = await response.json() as { audio: string; type: string };
    if (token !== speechToken) return;
    const player = new Audio(`data:${type};base64,${audio}`);
    current = player;
    await new Promise<void>((resolve) => { player.onended = () => resolve(); player.onerror = () => resolve(); player.onpause = () => resolve(); player.play().catch(() => resolve()); });
  } catch { /* speech is a bonus; the screen always shows the same text */ }
}
