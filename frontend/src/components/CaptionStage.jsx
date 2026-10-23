import React, { useEffect, useMemo, useState } from 'react';
import './noun.css';

const CUES = [
  { lang: 'Hindi', code: 'hi', text: 'आज की रात बहुत लंबी होने वाली है।', tc: '00:01:12:08' },
  { lang: 'Tamil', code: 'ta', text: 'இன்றிரவு மிக நீண்டதாக இருக்கும்.', tc: '00:01:15:16' },
  { lang: 'Spanish', code: 'es', text: 'Esta noche va a ser muy larga.', tc: '00:01:18:24' },
  { lang: 'Bengali', code: 'bn', text: 'আজ রাতটা অনেক লম্বা হতে চলেছে।', tc: '00:01:22:07' },
];
const CUE_MS = 3400;
const BARS = 72;

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false
  ));
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return reduced;
}

/**
 * A looping caption timeline: one line of dialogue gets timed and translated into four languages
 * while a playhead sweeps the waveform. Decorative, so it is hidden from assistive tech.
 */
export default function CaptionStage({ className = '' }) {
  const reduced = useReducedMotion();
  const [i, setI] = useState(0);
  useEffect(() => {
    if (reduced) return undefined;
    const t = setInterval(() => setI((n) => (n + 1) % CUES.length), CUE_MS);
    return () => clearInterval(t);
  }, [reduced]);

  const bars = useMemo(() => Array.from({ length: BARS }, (_, k) => {
    const a = Math.sin(k * 0.62) * 0.5 + Math.sin(k * 0.17 + 1.3) * 0.35 + Math.sin(k * 1.9) * 0.15;
    return Math.round(18 + Math.abs(a) * 78);
  }), []);

  const cue = CUES[i];
  const per = BARS / CUES.length;

  return (
    <div className={`nx-stage ${className}`} aria-hidden="true">
      <div className="nx-stage-top">
        <span className="nx-rec"><i /> Timed</span>
        <span className="nx-tc">{cue.tc}</span>
      </div>

      <div className="nx-frame">
        <p className="nx-source">Tonight is going to be a long one.</p>
        <p key={cue.code} lang={cue.code} className="nx-caption">{cue.text}</p>
        <span key={`${cue.code}-chip`} className="nx-chip">{cue.lang}</span>
      </div>

      <div className="nx-track">
        <div className="nx-ruler" />
        <div className="nx-wave">
          {bars.map((h, k) => (
            <span key={k} style={{ height: `${h}%` }} className={Math.floor(k / per) === i ? 'on' : ''} />
          ))}
        </div>
        <div className="nx-cues">
          {CUES.map((c, k) => (<span key={c.code} className={k === i ? 'on' : ''}>{c.code}</span>))}
        </div>
        <div
          key={i}
          className={`nx-playhead${reduced ? ' still' : ''}`}
          style={{ '--from': `${(i / CUES.length) * 100}%`, '--to': `${((i + 1) / CUES.length) * 100}%`, '--dur': `${CUE_MS}ms` }}
        />
      </div>
    </div>
  );
}
