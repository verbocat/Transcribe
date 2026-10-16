import React, { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { EFFECTS_DEFAULT } from './videoModel';

const label = 'flex flex-col gap-0.5 text-[10px] text-[var(--kt-faint)]';
const ctrl = 'h-7 rounded-md bg-[var(--kt-s2)] border border-[var(--kt-s5)] px-2 text-xs';
const btn = 'h-7 px-2 rounded-md text-[11px] cursor-pointer border border-[var(--kt-s5)] bg-[var(--kt-s2)] hover:bg-[var(--kt-s3)] disabled:opacity-40 disabled:cursor-not-allowed';
const pressed = 'h-7 px-2 rounded-md text-[11px] cursor-pointer border border-[var(--kt-accent)] bg-[var(--kt-accent)]/20 text-[var(--kt-accent)]';

function Slider({ name, value, min, max, step, onChange, fmt, disabled, reset }) {
  return (
    <label className="flex items-center gap-2 text-[11px] text-[var(--kt-muted)]">
      <span className="w-20 shrink-0">{name}</span>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} aria-label={name}
        onChange={(e) => onChange(Number(e.target.value))} onDoubleClick={() => reset != null && onChange(reset)}
        title={reset != null ? 'Double-click to reset' : undefined} className="flex-1 accent-[var(--kt-accent)]" />
      <span className="w-12 text-right tabular-nums" style={{ fontFamily: 'var(--kt-font-mono)' }}>{fmt ? fmt(value) : value}</span>
    </label>
  );
}

function Seconds({ name, value, onCommit, disabled }) {
  const [draft, setDraft] = useState(null);
  return (
    <label className={label}>{name}
      <input className={ctrl} value={draft ?? String(Math.round((value || 0) * 100) / 100)} disabled={disabled} inputMode="decimal"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { if (draft != null) { const v = Number(draft); if (Number.isFinite(v)) onCommit(Math.max(0, v)); setDraft(null); } }}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setDraft(null); e.currentTarget.blur(); } }} />
    </label>
  );
}

const POSITIONS = [['Top', 0.1], ['Middle', 0.5], ['Lower third', 0.75], ['Bottom', 0.88]];

/** A text clip: words, look, place, fades. On a subtitle, the style can be copied to every subtitle. */
export function TextSection({ clip, editable, onText, onFades, onStyleAll, isSubtitle }) {
  const s = clip.style || {};
  const [text, setText] = useState(clip.text || '');
  const set = (patch) => onText({ style: patch });
  return (
    <div className="flex flex-col gap-2.5 border-t border-[var(--kt-s4)] pt-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--kt-faint)]">{isSubtitle ? 'Subtitle' : 'Text'}</div>
      <textarea rows={3} value={text} disabled={!editable} aria-label="Text" onChange={(e) => setText(e.target.value)}
        onBlur={() => { if (text !== clip.text) onText({ text }); }}
        className="rounded-md bg-[var(--kt-s2)] border border-[var(--kt-s5)] p-2 text-[13px] resize-y" style={{ fontFamily: 'var(--kt-font-script)' }} />
      <div className="grid grid-cols-3 gap-2">
        <label className={label}>Font
          <select className={ctrl} value={s.font || 'sans'} disabled={!editable} onChange={(e) => set({ font: e.target.value })}>
            <option value="sans">Sans</option><option value="serif">Serif</option><option value="mono">Mono</option>
          </select></label>
        <label className={label}>Colour
          <input type="color" className="h-7 w-full rounded-md bg-[var(--kt-s2)] border border-[var(--kt-s5)] cursor-pointer" value={s.color || '#ffffff'} disabled={!editable} onChange={(e) => set({ color: e.target.value })} /></label>
        <label className={label}>Align
          <select className={ctrl} value={s.align || 'center'} disabled={!editable} onChange={(e) => set({ align: e.target.value })}>
            <option value="left">Left</option><option value="center">Centre</option><option value="right">Right</option>
          </select></label>
      </div>
      <div className="flex gap-1.5">
        <button type="button" className={s.bold ? pressed : btn} disabled={!editable} aria-pressed={!!s.bold} onClick={() => set({ bold: !s.bold })}><b>B</b></button>
        <button type="button" className={s.italic ? pressed : btn} disabled={!editable} aria-pressed={!!s.italic} onClick={() => set({ italic: !s.italic })}><i>I</i></button>
        <button type="button" className={s.shadow ? pressed : btn} disabled={!editable} aria-pressed={!!s.shadow} onClick={() => set({ shadow: !s.shadow })}>Shadow</button>
        <button type="button" className={s.box ? pressed : btn} disabled={!editable} aria-pressed={!!s.box} onClick={() => set({ box: !s.box })}>Box</button>
      </div>
      <Slider name="Size" value={s.size ?? 0.06} min={0.02} max={0.2} step={0.005} disabled={!editable} onChange={(v) => set({ size: v })} fmt={(v) => `${Math.round(v * 100)}%`} />
      <Slider name="Width" value={s.width ?? 0.8} min={0.2} max={1} step={0.01} disabled={!editable} onChange={(v) => set({ width: v })} fmt={(v) => `${Math.round(v * 100)}%`} />
      <div className="flex flex-wrap gap-1">
        {POSITIONS.map(([n, y]) => <button key={n} type="button" className={Math.abs((s.y ?? 0.5) - y) < 0.01 ? pressed : btn} disabled={!editable} onClick={() => set({ y, x: 0.5 })}>{n}</button>)}
      </div>
      <Slider name="Across" value={s.x ?? 0.5} min={0} max={1} step={0.01} disabled={!editable} onChange={(v) => set({ x: v })} fmt={(v) => `${Math.round(v * 100)}%`} reset={0.5} />
      <Slider name="Down" value={s.y ?? 0.5} min={0} max={1} step={0.01} disabled={!editable} onChange={(v) => set({ y: v })} fmt={(v) => `${Math.round(v * 100)}%`} />
      {s.box ? (
        <div className="grid grid-cols-[auto_1fr] gap-2 items-center">
          <input type="color" aria-label="Box colour" className="h-7 w-10 rounded-md bg-[var(--kt-s2)] border border-[var(--kt-s5)] cursor-pointer" value={s.box_color || '#000000'} disabled={!editable} onChange={(e) => set({ box_color: e.target.value })} />
          <Slider name="Box opacity" value={s.box_opacity ?? 0.6} min={0} max={1} step={0.05} disabled={!editable} onChange={(v) => set({ box_opacity: v })} fmt={(v) => `${Math.round(v * 100)}%`} />
        </div>
      ) : null}
      <div className="grid grid-cols-[auto_1fr] gap-2 items-center">
        <input type="color" aria-label="Outline colour" className="h-7 w-10 rounded-md bg-[var(--kt-s2)] border border-[var(--kt-s5)] cursor-pointer" value={s.outline_color || '#000000'} disabled={!editable} onChange={(e) => set({ outline_color: e.target.value })} />
        <Slider name="Outline" value={s.outline ?? 0} min={0} max={0.02} step={0.001} disabled={!editable} onChange={(v) => set({ outline: v })} fmt={(v) => (v ? `${(v * 100).toFixed(1)}%` : 'off')} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Seconds name="Fade in (s)" value={clip.fade_in} disabled={!editable} onCommit={(v) => onFades({ fade_in: v })} />
        <Seconds name="Fade out (s)" value={clip.fade_out} disabled={!editable} onCommit={(v) => onFades({ fade_out: v })} />
      </div>
      {isSubtitle ? <button type="button" className={btn} disabled={!editable} onClick={onStyleAll}>Use this look for every subtitle</button> : null}
    </div>
  );
}

/** A video clip: effects, the transition from the clip before it, fades from / to black. */
export function VideoSection({ clip, editable, onEffects, onTransition, onFades, transition, hasCutBefore }) {
  const fx = { ...EFFECTS_DEFAULT, ...(clip.effects || {}) };
  const tr = clip.transition;
  return (
    <div className="flex flex-col gap-2.5 border-t border-[var(--kt-s4)] pt-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--kt-faint)]">Effects</span>
        <span className="flex gap-1">
          <button type="button" className={fx.saturation === 0 ? pressed : btn} disabled={!editable} onClick={() => onEffects({ saturation: fx.saturation === 0 ? 1 : 0 })}>Black and white</button>
          <button type="button" className={btn} disabled={!editable || !clip.effects} title="Reset the effects" aria-label="Reset the effects" onClick={() => onEffects({ ...EFFECTS_DEFAULT })}><RotateCcw size={11} /></button>
        </span>
      </div>
      <Slider name="Brightness" value={fx.brightness} min={0} max={2} step={0.01} reset={1} disabled={!editable} onChange={(v) => onEffects({ brightness: v })} fmt={(v) => `${Math.round(v * 100)}%`} />
      <Slider name="Contrast" value={fx.contrast} min={0} max={2} step={0.01} reset={1} disabled={!editable} onChange={(v) => onEffects({ contrast: v })} fmt={(v) => `${Math.round(v * 100)}%`} />
      <Slider name="Saturation" value={fx.saturation} min={0} max={2} step={0.01} reset={1} disabled={!editable} onChange={(v) => onEffects({ saturation: v })} fmt={(v) => `${Math.round(v * 100)}%`} />
      <Slider name="Blur" value={fx.blur} min={0} max={0.03} step={0.0005} reset={0} disabled={!editable} onChange={(v) => onEffects({ blur: v })} fmt={(v) => (v ? `${(v * 100).toFixed(1)}%` : 'off')} />

      <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--kt-faint)] mt-1">Transition into this clip</div>
      {hasCutBefore ? (
        <>
          <div className="grid grid-cols-[1fr_88px] gap-2">
            <label className={label}>Type
              <select className={ctrl} value={tr?.type || ''} disabled={!editable} onChange={(e) => onTransition(e.target.value ? { type: e.target.value, duration: tr?.duration ?? 1 } : null)}>
                <option value="">None (cut)</option><option value="dissolve">Cross dissolve</option><option value="dip">Dip to black</option>
              </select></label>
            <Seconds name="Length (s)" value={tr?.duration ?? 1} disabled={!editable || !tr} onCommit={(v) => onTransition({ type: tr.type, duration: v })} />
          </div>
          {tr && transition && transition.duration < (tr.duration ?? 1) - 1e-3 ? (
            <div className="text-[10px] text-[var(--kt-warn)]">Plays as {transition.duration.toFixed(2)}s: a dissolve needs spare video on both sides of the cut, and neither clip can be shorter than it.</div>
          ) : null}
          {tr && !transition ? <div className="text-[10px] text-[var(--kt-warn)]">There is no room for it here (no spare video around the cut).</div> : null}
        </>
      ) : <div className="text-[11px] text-[var(--kt-faint)]">This clip does not follow straight on from another one. Cut the video with the Razor (C), then add a transition at the cut, or press Ctrl+D near a cut.</div>}

      <div className="grid grid-cols-2 gap-2 mt-1">
        <Seconds name="Fade from black (s)" value={clip.fade_in} disabled={!editable} onCommit={(v) => onFades({ fade_in: v })} />
        <Seconds name="Fade to black (s)" value={clip.fade_out} disabled={!editable} onCommit={(v) => onFades({ fade_out: v })} />
      </div>
    </div>
  );
}
