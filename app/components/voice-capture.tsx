"use client";

import { useEffect, useRef, useState } from "react";
import { transcribe, useRecorder, stopSpeaking } from "@/lib/client-voice";
import { describe, type Lang, type Strings } from "@/lib/i18n";
import { Icon } from "./icons";

type Props = {
  lang: Lang;
  t: Strings;
  disabled: boolean;
  /** Opens the typed form, for people who would rather not speak. */
  onOpenForm: () => void;
  /** Returns an error message to show, or undefined on success. */
  onText: (text: string, spoken: boolean) => Promise<string | undefined>;
};

/** Feeds the live voice level into the meter as a CSS variable, smoothed so it moves without jitter. */
function useVoiceLevel(target: React.RefObject<HTMLElement | null>, active: boolean, level: () => number) {
  const levelRef = useRef(level);
  levelRef.current = level;
  useEffect(() => {
    const element = target.current;
    if (!element) return;
    if (!active) { element.style.setProperty("--level", "0"); return; }
    let frame = 0;
    let smooth = 0;
    const tick = () => {
      smooth += (levelRef.current() - smooth) * 0.25;
      element.style.setProperty("--level", smooth.toFixed(3));
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [target, active]);
}

export default function VoiceCapture({ lang, t, disabled, onOpenForm, onText }: Props) {
  const recorder = useRecorder(20);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [working, setWorking] = useState(false);
  const [heard, setHeard] = useState("");
  const [error, setError] = useState("");
  const [typed, setTyped] = useState("");
  const [typing, setTyping] = useState(false);
  const [heroVisible, setHeroVisible] = useState(true);
  const hero = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const recording = recorder.phase === "recording";
  useVoiceLevel(stage, recording, recorder.level);

  useEffect(() => {
    fetch("/api/transcribe", { cache: "no-store" }).then((response) => response.json()).then((result) => setConfigured(result.configured === true)).catch(() => setConfigured(false));
  }, []);
  useEffect(() => {
    if (!stage.current) return;
    // The floating mic appears only once the main mic has scrolled away.
    const observer = new IntersectionObserver(([entry]) => setHeroVisible(entry.isIntersecting), { threshold: 0.25 });
    observer.observe(stage.current);
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
  const off = configured === false;
  const micDisabled = (disabled && !recording) || off || (busy && !recording);
  const state = recording ? "live" : busy ? "busy" : off ? "off" : "idle";
  const status = recording ? <>{t.voice.listening} <span className="timer">0:{String(recorder.seconds).padStart(2, "0")}</span></>
    : recorder.phase === "permission" ? t.voice.permission
    : busy ? t.voice.understanding
    : off ? t.voice.notConfigured
    : t.voice.tap;

  return <>
    <section className={`speak is-${state}`} ref={hero} aria-labelledby="voice-title">
      <h1 id="voice-title">{t.voice.title}</h1>
      <p className="speak-sub">{t.voice.sub}</p>

      <div className="mic-row" ref={stage}>
        <button type="button" className="mic" onClick={() => void onMic()} disabled={micDisabled} aria-label={recording ? t.stop : t.voice.tap}>
          {busy && !recording ? <span className="spinner" aria-hidden="true" /> : <Icon name={recording ? "stop" : "mic"} size={recording ? 26 : 30} />}
        </button>
        <div className="mic-info">
          <p className="mic-status" role="status" aria-live="polite">{status}</p>
          <span className="meter" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /><i /><i /></span>
        </div>
      </div>

        {(heard || error) && <div className="feedback">
          {heard && <p className="heard"><span>{t.voice.heard}</span>{heard}</p>}
          {error && <p className="voice-error" role="alert"><Icon name="close" size={14} />{error}</p>}
        </div>}

        <div className="try">
          <p className="try-label">{t.voice.tryThese}</p>
          <div className="chips">{t.voice.examples.map((example) => <button key={example.text} type="button" className="chip" disabled={disabled || busy || recording} onClick={() => void run(example.text, false)}>
            <em>{example.tag}</em><span>{example.text}</span>
          </button>)}</div>
        </div>

        {typing ? <form className="type-box" onSubmit={(event) => { event.preventDefault(); if (typed.trim()) void run(typed.trim(), false); }}>
          <label className="sr-only" htmlFor="typed-text">{t.voice.type}</label>
          <input id="typed-text" value={typed} onChange={(event) => setTyped(event.target.value)} placeholder={t.voice.typePlaceholder} autoFocus disabled={disabled || busy} />
          <button className="send" type="submit" aria-label={t.review} disabled={!typed.trim() || disabled || busy}><Icon name="chevron" size={18} /></button>
          <p className="type-hint">{t.voice.typeHint}</p>
        </form> : <div className="speak-actions">
          <button type="button" className="link-btn" onClick={() => setTyping(true)}><Icon name="keyboard" size={16} /> {t.voice.type}</button>
          <button type="button" className="link-btn" onClick={onOpenForm} disabled={disabled}><Icon name="edit" size={16} /> {t.manual.title}</button>
        </div>}
    </section>

    {!heroVisible && <button type="button" className={`fab${recording ? " live" : ""}`} onClick={() => { if (!recording && !busy) hero.current?.scrollIntoView({ behavior: "smooth", block: "start" }); void onMic(); }} disabled={micDisabled} aria-label={recording ? t.stop : t.voice.tap}>
      {busy && !recording ? <span className="spinner" aria-hidden="true" /> : <Icon name={recording ? "stop" : "mic"} size={24} />}
    </button>}
  </>;
}
