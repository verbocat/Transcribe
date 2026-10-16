import React, { useEffect, useRef, useState } from 'react';
import { audible } from './editModel';
import {
  DUCK_DEFAULT, MIN_DB, faderToGain, gainToFader, gainToDb, fmtDb, setTrackVolume, setTrackDuck, setMaster,
} from './audioModel';

// Meter scale: -60 dB at the bottom, 0 dB at the top (above full scale shows red).
const meterPos = (g) => Math.max(0, Math.min(1, (gainToDb(g) - MIN_DB) / -MIN_DB));

function Meter({ id, read }) {
  const bar = useRef(null);
  const hold = useRef({ v: 0, t: 0 });
  useEffect(() => {
    let raf;
    const tick = () => {
      const g = read()[id] || 0;
      const now = performance.now();
      // fast attack, slower fall, so short peaks stay visible
      const v = g > hold.current.v ? g : Math.max(g, hold.current.v * 0.92);
      hold.current = { v, t: now };
      if (bar.current) {
        bar.current.style.height = `${meterPos(v) * 100}%`;
        bar.current.style.background = v >= 0.99 ? 'var(--kt-danger)' : v >= 0.5 ? 'var(--kt-warn)' : 'var(--kt-success)';
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [id, read]);
  return (
    <div className="relative w-2 h-full rounded-sm bg-[var(--kt-s3)] overflow-hidden" aria-hidden="true">
      <div ref={bar} className="absolute bottom-0 left-0 right-0" style={{ height: 0 }} />
    </div>
  );
}

// A vertical fader in dB. One drag is one undo step: begin on press, preview while moving, end on release.
function Fader({ gain, onBegin, onPreview, onEnd, onCommit, label }) {
  const [text, setText] = useState(null);
  const db = gainToFader(gain);
  return (
    <div className="flex flex-col items-center gap-1 h-full min-h-0">
      <input type="range" min={MIN_DB} max={6} step="0.1" value={db} aria-label={`${label} volume`}
        onPointerDown={onBegin} onPointerUp={onEnd} onKeyUp={onEnd}
        onChange={(e) => onPreview(faderToGain(Number(e.target.value)))}
        onDoubleClick={() => onCommit(1)} title="Double-click for 0 dB"
        className="flex-1 min-h-0 w-6 cursor-pointer accent-[var(--kt-accent)]" style={{ writingMode: 'vertical-lr', direction: 'rtl' }} />
      <input value={text ?? fmtDb(gainToDb(gain))} aria-label={`${label} volume in dB`} onChange={(e) => setText(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={() => { if (text != null) { const v = text.trim() === '-∞' ? MIN_DB : Number(text); if (Number.isFinite(v)) onCommit(faderToGain(Math.min(6, v))); setText(null); } }}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setText(null); e.currentTarget.blur(); } }}
        className="w-12 h-6 text-center rounded bg-[var(--kt-s2)] border border-[var(--kt-s5)] text-[11px] tabular-nums" style={{ fontFamily: 'var(--kt-font-mono)' }} />
    </div>
  );
}

function SmallBtn({ on, tone, onClick, title, children }) {
  return (
    <button type="button" onClick={onClick} title={title} aria-pressed={!!on}
      className={`h-[18px] min-w-[18px] px-1 rounded-[3px] text-[10px] font-bold grid place-items-center cursor-pointer border ${on ? `${tone} border-transparent` : 'border-[var(--kt-s5)] text-[var(--kt-muted)] hover:text-[var(--kt-text)]'}`}>{children}</button>
  );
}

export default function AudioMixer({ edit, dispatch, palette, meters }) {
  const on = audible(edit);
  const tracks = edit.tracks.filter((t) => t.kind === 'audio');
  const speakers = edit.tracks.filter((t) => t.role === 'speaker').map((t) => t.id);
  const color = (t) => (t.role === 'speaker' ? palette[speakers.indexOf(t.id) % palette.length] : t.role === 'background' ? 'var(--kt-success)' : 'var(--kt-faint)');
  const begin = () => dispatch({ type: 'begin' });
  const end = () => dispatch({ type: 'end' });
  const preview = (next) => dispatch({ type: 'preview', edit: next });
  const commit = (next) => dispatch({ type: 'commit', edit: next });
  const toggle = (t, k) => commit({ ...edit, tracks: edit.tracks.map((x) => (x.id === t.id ? { ...x, [k]: !x[k] } : x)) });

  const strip = (key, name, dot, gain, setGain, extra, footer) => (
    <div key={key} className="w-[76px] shrink-0 h-full flex flex-col gap-1.5 px-1.5 py-2 border-r border-[var(--kt-s4)]">
      <div className="flex items-center gap-1 min-w-0" title={name}>
        <span className="h-2 w-2 rounded-sm shrink-0" style={{ background: dot }} />
        <span className="text-[11px] font-medium truncate">{name}</span>
      </div>
      <div className="flex gap-1 justify-center min-h-[18px]">{extra}</div>
      <div className="flex-1 min-h-0 flex justify-center gap-1.5">
        <Meter id={key} read={meters} />
        <Fader gain={gain} label={name} onBegin={begin} onEnd={end} onPreview={(g) => preview(setGain(g))} onCommit={(g) => commit(setGain(g))} />
      </div>
      {footer}
    </div>
  );

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="flex-1 min-h-0 flex overflow-x-auto overflow-y-hidden">
        {tracks.map((t) => strip(t.id, t.name, color(t), t.volume ?? 1, (g) => setTrackVolume(edit, t.id, g), (
          <>
            <SmallBtn on={t.mute} tone="bg-[var(--kt-warn)] text-[var(--kt-s0)]" title="Mute" onClick={() => toggle(t, 'mute')}>M</SmallBtn>
            <SmallBtn on={t.solo} tone="bg-[var(--kt-success)] text-[var(--kt-s0)]" title="Solo" onClick={() => toggle(t, 'solo')}>S</SmallBtn>
            {!on[t.id] ? <span className="text-[9px] text-[var(--kt-faint)] self-center">off</span> : null}
          </>
        ), t.role === 'original' ? (
          <div className="text-[9px] text-[var(--kt-faint)] text-center border-t border-[var(--kt-s4)] pt-1.5">Reference only, not in the mixed dub</div>
        ) : t.role === 'background' ? (
          <div className="flex flex-col items-center gap-1 border-t border-[var(--kt-s4)] pt-1.5">
            <SmallBtn on={t.duck?.on} tone="bg-[var(--kt-accent)] text-[var(--kt-accent-ink)]" title="Duck: lower this track while dub lines play"
              onClick={() => commit(setTrackDuck(edit, t.id, { on: !t.duck?.on }))}>Duck</SmallBtn>
            <label className="flex flex-col items-center text-[9px] text-[var(--kt-faint)]" title="How far the track dips under speech">
              <select value={t.duck?.amount ?? DUCK_DEFAULT.amount} disabled={!t.duck?.on} aria-label={`${t.name} ducking amount`}
                onChange={(e) => commit(setTrackDuck(edit, t.id, { amount: Number(e.target.value) }))}
                className="h-6 w-14 rounded bg-[var(--kt-s2)] border border-[var(--kt-s5)] text-[10px] disabled:opacity-50">
                {[-3, -6, -9, -12, -15, -18, -24, -30].map((v) => <option key={v} value={v}>{v} dB</option>)}
              </select>
            </label>
          </div>
        ) : null))}
        {strip('master', 'Master', 'var(--kt-accent)', edit.master?.volume ?? 1, (g) => setMaster(edit, g), null,
          <div className="text-[9px] text-[var(--kt-faint)] text-center border-t border-[var(--kt-s4)] pt-1.5">Whole mix</div>)}
      </div>
      <div className="shrink-0 px-2 py-1.5 border-t border-[var(--kt-s4)] text-[10px] text-[var(--kt-faint)] leading-snug">
        Faders, mute, solo and ducking apply to the preview and to the mixed dub (the original is for reference only). Meters move while playing.
      </div>
    </div>
  );
}
