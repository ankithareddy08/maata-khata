"use client";

import { useEffect, useRef, useState } from "react";
import { prepareRecording } from "@/lib/audio";
import { parseVoiceCommand } from "@/lib/voice-command";
import type { Understood } from "@/lib/understand";

type Customer = { id: string; name: string };
export type RecorderPhase = "idle" | "permission" | "recording" | "processing";

function micError(cause: unknown): string {
  const name = cause instanceof Error ? cause.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "మైక్ అనుమతి ఇవ్వండి. Allow microphone access in the browser and try again.";
  if (name === "NotFoundError") return "మైక్ కనిపించలేదు. Connect a microphone and try again.";
  if (name === "NotReadableError") return "మైక్ వేరే యాప్‌లో ఉంది. Close other apps using the mic and try again.";
  return cause instanceof Error && cause.message ? cause.message : "రికార్డింగ్ మొదలవలేదు. Use a recent Chrome or Edge browser.";
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
        if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { reject(new Error("ఈ బ్రౌజర్‌లో రికార్డింగ్ లేదు. Open the app in a recent Chrome or Edge.")); return; }
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
          if (!mimeType) throw new Error("ఈ బ్రౌజర్ ఆడియో ఫార్మాట్ సపోర్ట్ చేయదు. Try Chrome or Edge.");
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
              if (prepared.details.peak < 0.001) { reject(new Error("మీ గొంతు వినిపించలేదు. Your voice was not captured; check the microphone.")); return; }
              resolve(prepared.audio);
            } catch (cause) { setPhase("idle"); reject(cause instanceof Error ? cause : new Error("Recording failed.")); }
          };
          media.start();
          setSeconds(0);
          setPhase("recording");
          const began = Date.now();
          timers.current.push(setInterval(() => setSeconds(Math.floor((Date.now() - began) / 1000)), 250));
          timers.current.push(setTimeout(() => stop(), maxSeconds * 1000));
        } catch (cause) { cleanup(); setPhase("idle"); reject(new Error(micError(cause))); }
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

export async function transcribe(audio: Blob, signal?: AbortSignal): Promise<string> {
  const form = new FormData();
  form.set("file", audio, "speech.wav");
  const response = await fetch("/api/transcribe", { method: "POST", body: form, signal });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "మాటలు అర్థం కాలేదు. Speech service failed; try again.");
  if (typeof result.transcript !== "string" || !result.transcript.trim()) throw new Error("మాటలు వినిపించలేదు. No words heard; try again.");
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

/** Speak Telugu text. Resolves when finished (or immediately if speech is unavailable). */
export async function speak(text: string): Promise<void> {
  stopSpeaking();
  const token = speechToken;
  try {
    const response = await fetch("/api/speak", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(15_000) });
    if (!response.ok || token !== speechToken) return;
    const { audio, type } = await response.json() as { audio: string; type: string };
    if (token !== speechToken) return;
    const player = new Audio(`data:${type};base64,${audio}`);
    current = player;
    await new Promise<void>((resolve) => { player.onended = () => resolve(); player.onerror = () => resolve(); player.onpause = () => resolve(); player.play().catch(() => resolve()); });
  } catch { /* speech is a bonus; the screen always shows the same text */ }
}

const rupeeWords = (paise: number) => `${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })} రూపాయలు`;
export const readBack = {
  credit: (name: string, paise: number, itemCount: number, after: number) =>
    `${name}కి ${itemCount > 1 ? `${itemCount} వస్తువులు, ` : ""}మొత్తం ${rupeeWords(paise)} బాకీ. మొత్తం బాకీ ${rupeeWords(after)} అవుతుంది. సేవ్ చేయాలా?`,
  payment: (name: string, paise: number, after: number) =>
    `${name} ${rupeeWords(paise)} ఇచ్చారు. ఇంకా ${rupeeWords(after)} బాకీ ఉంటుంది. సేవ్ చేయాలా?`,
  undo: () => "చివరి నమోదు రద్దు చేయాలా?",
  saved: () => "సేవ్ అయింది.",
  balance: (name: string, paise: number) => paise > 0 ? `${name} బాకీ ${rupeeWords(paise)}.` : `${name} బాకీ ఏమీ లేదు.`,
};
