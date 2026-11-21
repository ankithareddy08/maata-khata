"use client";

import { useEffect, useRef, useState } from "react";
import { transcribe, useRecorder, stopSpeaking } from "@/lib/client-voice";
import { Icon } from "./icons";
import { describe, type Lang, type Strings } from "@/lib/i18n";

type Props = {
  lang: Lang;
  t: Strings;
  disabled: boolean;
  /** True while the review sheet is open, to light the last step. */
  reviewing: boolean;
  /** Returns an error message to show, or undefined on success. */
  onText: (text: string, spoken: boolean) => Promise<string | undefined>;
};

const BARS = 64;

/** A ring of bars around the mic that follows the speaker's voice. */
function useWaveform(canvas: React.RefObject<HTMLCanvasElement | null>, active: boolean, level: () => number) {
  const levelRef = useRef(level);
  levelRef.current = level;
  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context) return;
    const ratio = window.devicePixelRatio || 1;
    const size = element.clientWidth;
    element.width = size * ratio;
    element.height = size * ratio;
    context.scale(ratio, ratio);
    const history = new Array<number>(BARS).fill(0);
    const color = getComputedStyle(element).color;
    let frame = 0;
    let tick = 0;
    const draw = () => {
      context.clearRect(0, 0, size, size);
      if (active && tick++ % 2 === 0) { history.shift(); history.push(levelRef.current()); }
      const center = size / 2;
      const inner = size * 0.33;
      context.strokeStyle = color;
      context.lineCap = "round";
      context.lineWidth = 3;
      for (let i = 0; i < BARS; i++) {
        const angle = (i / BARS) * Math.PI * 2 - Math.PI / 2;
        const value = active ? history[(i * 7) % BARS] : 0;
        const length = 3 + value * size * 0.13;
        context.globalAlpha = active ? 0.35 + value * 0.65 : 0.18;
        context.beginPath();
        context.moveTo(center + Math.cos(angle) * inner, center + Math.sin(angle) * inner);
        context.lineTo(center + Math.cos(angle) * (inner + length), center + Math.sin(angle) * (inner + length));
        context.stroke();
      }
      if (active) frame = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [canvas, active]);
}

export default function VoiceCapture({ lang, t, disabled, reviewing, onText }: Props) {
  const recorder = useRecorder(20);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [working, setWorking] = useState(false);
  const [heard, setHeard] = useState("");
  const [error, setError] = useState("");
  const [typed, setTyped] = useState("");
  const [typing, setTyping] = useState(false);
  const [heroVisible, setHeroVisible] = useState(true);
  const canvas = useRef<HTMLCanvasElement>(null);
  const hero = useRef<HTMLElement>(null);
  const micStage = useRef<HTMLDivElement>(null);
  const recording = recorder.phase === "recording";
  useWaveform(canvas, recording, recorder.level);

  useEffect(() => {
    fetch("/api/transcribe", { cache: "no-store" }).then((response) => response.json()).then((result) => setConfigured(result.configured === true)).catch(() => setConfigured(false));
  }, []);
  useEffect(() => {
    if (!micStage.current) return;
    // Show the floating mic only once the big mic itself has scrolled away.
    const observer = new IntersectionObserver(([entry]) => setHeroVisible(entry.isIntersecting), { threshold: 0.3 });
    observer.observe(micStage.current);
    return () => observer.disconnect();
  }, []);

  async function run(text: string, spoken: boolean) {
    setHeard(text);
    setWorking(true);
    setError("");
    try {
      const problem = await onText(text, spoken);
      setError(problem ?? "");
      if (!problem) { setTyped(""); setTyping(false); setHeard(""); }
    } finally { setWorking(false); }
  }

  async function onMic() {
    if (recording) { recorder.stop(); return; }
    if (disabled || working || recorder.phase !== "idle") return;
    stopSpeaking();
    setError("");
    setHeard("");
    try {
      const audio = await recorder.start();
      if (!audio) return;
      setWorking(true);
      await run(await transcribe(audio, lang), true);
    } catch (cause) {
      setWorking(false);
      setError(describe(cause, lang));
    }
  }

  const busy = working || recorder.phase === "processing" || recorder.phase === "permission";
  const stage = recording || recorder.phase === "permission" ? 0 : busy ? 1 : reviewing ? 2 : -1;
  const micDisabled = (disabled && !recording) || configured === false || (busy && !recording);
  const status = recording ? <>{t.voice.listening} <span className="timer">0:{String(recorder.seconds).padStart(2, "0")}</span></>
    : recorder.phase === "permission" ? t.voice.permission
    : busy ? t.voice.understanding
    : configured === false ? t.voice.notConfigured
    : t.voice.tap;

  return <>
    <section className="console" ref={hero} aria-labelledby="voice-title">
      <div className="console-head">
        <span className="eyebrow"><Icon name="sparkle" size={14} /> {t.voice.eyebrow}</span>
      </div>
      <h1 id="voice-title">{t.voice.title}</h1>
      <p className="console-sub">{t.voice.sub}</p>

      <div className="mic-stage" ref={micStage}>
        <canvas ref={canvas} className="wave" aria-hidden="true" />
        <button type="button" className={`mic${recording ? " live" : ""}${busy ? " busy" : ""}`} onClick={() => void onMic()} disabled={micDisabled} aria-label={recording ? "Stop recording" : "Tap and speak"}>
          {busy ? <span className="spinner" aria-hidden="true" /> : <Icon name={recording ? "stop" : "mic"} size={recording ? 34 : 40} />}
        </button>
      </div>
      <p className="mic-status" role="status" aria-live="polite">{status}</p>

      <ol className="steps" aria-label="Progress">{t.voice.steps.map((step, index) => <li key={step} className={index === stage ? "now" : index < stage ? "done" : ""}><span>{index < stage ? <Icon name="check" size={12} /> : index + 1}</span>{step}</li>)}</ol>

      {(heard || error) && <div className="feedback">
        {heard && <p className="heard"><span>{t.voice.heard}</span>“{heard}”</p>}
        {error && <p className="voice-error" role="alert">{error}</p>}
      </div>}

      <div className="examples">
        <p>{t.voice.tryThese}</p>
        <div className="chips">{t.voice.examples.map((example) => <button key={example.text} type="button" className="chip" disabled={disabled || busy || recording} onClick={() => void run(example.text, false)}><em>{example.tag}</em>{example.text}</button>)}</div>
        {!typing ? <button type="button" className="text-link" onClick={() => setTyping(true)}><Icon name="keyboard" size={16} /> {t.voice.type} <span>{t.voice.typeHint}</span></button>
          : <form className="type-box" onSubmit={(event) => { event.preventDefault(); if (typed.trim()) void run(typed.trim(), false); }}>
            <label className="sr-only" htmlFor="typed-text">Type an entry</label>
            <input id="typed-text" value={typed} onChange={(event) => setTyped(event.target.value)} placeholder={t.voice.typePlaceholder} autoFocus disabled={disabled || busy} />
            <button className="send" type="submit" aria-label="Prepare entry" disabled={!typed.trim() || disabled || busy}><Icon name="chevron" size={18} /></button>
          </form>}
      </div>
    </section>

    {!heroVisible && <button type="button" className={`fab${recording ? " live" : ""}`} onClick={() => { if (!recording && !busy) hero.current?.scrollIntoView({ behavior: "smooth", block: "start" }); void onMic(); }} disabled={micDisabled} aria-label={recording ? "Stop recording" : "Tap and speak"}>
      {busy ? <span className="spinner small" aria-hidden="true" /> : <Icon name={recording ? "stop" : "mic"} size={26} />}
    </button>}
  </>;
}
