import React, { useRef, useState } from 'react';
import { Play, Pause, Mic2, Wand2, Download, SlidersHorizontal, Volume2, VolumeX, AudioLines } from 'lucide-react';
import { api, send, GRAD, fmtTime } from './dubApi';

const CONTROLS = [
  ['stability', 'Stability', 0, 1, 0.05, 'Low = more emotion and variation, high = steady and even.'],
  ['similarity', 'Voice match', 0, 1, 0.05, 'How closely it sticks to the chosen voice.'],
  ['style', 'Style', 0, 1, 0.05, 'Exaggeration of the speaking style. Higher can sound theatrical.'],
  ['speed', 'Speed', 0.7, 1.2, 0.05, 'Speaking speed of the voice itself.'],
  ['pitch', 'Pitch', -6, 6, 0.5, 'Semitones, applied after speaking. 0 = unchanged.'],
];

function Btn({ children, onClick, disabled, primary, icon: Icon, small, title }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title}
      className={`${small ? 'h-7 px-2 text-xs' : 'h-9 px-4 text-[13px]'} rounded-lg font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${primary ? 'text-white' : 'border border-[var(--kt-s5)] bg-[var(--kt-s2)] hover:bg-[var(--kt-s3)]'}`}
      style={primary ? { background: GRAD } : undefined}>
      {Icon ? <Icon size={small ? 12 : 14} /> : null}{children}
    </button>
  );
}

/** Sliders for one set of voice controls. `value` holds only what is overridden; `fallback` is shown when it is not. */
function Controls({ value = {}, fallback = {}, onChange, disabled }) {
  const set = (k, v) => onChange({ ...value, [k]: v });
  const reset = (k) => { const n = { ...value }; delete n[k]; onChange(n); };
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 mt-2">
      {CONTROLS.map(([k, label, min, max, step, tip]) => {
        const own = value[k] !== undefined;
        const shown = own ? value[k] : (fallback[k] !== undefined ? fallback[k] : (k === 'speed' ? 1 : k === 'pitch' ? 0 : null));
        return (
          <label key={k} className="text-xs" title={tip}>
            <div className="flex justify-between text-[var(--kt-muted)]">
              <span>{label}</span>
              <span>{shown === null ? 'auto' : shown}{own ? <button type="button" onClick={() => reset(k)} className="ml-2 underline cursor-pointer">reset</button> : null}</span>
            </div>
            <input type="range" min={min} max={max} step={step} value={shown ?? (min + max) / 2} disabled={disabled} onChange={(e) => set(k, Number(e.target.value))} className="w-full" />
          </label>
        );
      })}
      <label className="text-xs flex items-center gap-2 text-[var(--kt-muted)]" title="Speed the line up slightly if it is longer than its time slot.">
        <input type="checkbox" checked={value.fit !== undefined ? value.fit : (fallback.fit ?? true)} disabled={disabled} onChange={(e) => set('fit', e.target.checked)} />
        Fit to the original timing
      </label>
    </div>
  );
}

export default function VoiceOverTab({ projectId, project, segs, edit, dirty, save, wrap, refresh, apply, running, busy }) {
  const [openLine, setOpenLine] = useState(null);
  const [openSpeaker, setOpenSpeaker] = useState(null);
  const [playing, setPlaying] = useState(null);
  const audio = useRef(null);
  const cache = useRef({});
  const lines = segs.filter((s) => s.id != null);
  const withText = lines.filter((s) => (s.translation || '').trim());
  const todo = withText.filter((s) => !s.audio?.ready || s.audio?.stale);
  const chars = (arr) => arr.reduce((n, s) => n + (s.translation || '').length, 0);

  const speak = (ids, onlyStale) => wrap(async () => {
    if (dirty) await save();
    await send('POST', `/projects/${projectId}/speak`, { ids, only_stale: onlyStale });
    await refresh(true);
  });
  const mix = () => wrap(async () => {
    if (dirty) await save();
    await send('POST', `/projects/${projectId}/mix`);
    await refresh(true);
  });
  const saveSpeaker = (name, tts) => wrap(async () => apply(await send('PUT', `/projects/${projectId}/speakers/${encodeURIComponent(name)}/tts`, tts), false));
  const play = async (s) => {
    try {
      if (audio.current) { audio.current.pause(); audio.current = null; }
      if (playing === s.id) { setPlaying(null); return; }
      const k = `${s.id}:${s.audio.rev}`;
      if (!cache.current[k]) {
        const r = await fetch(api(`/projects/${projectId}/lines/${s.id}/audio`));
        if (!r.ok) return;
        cache.current[k] = URL.createObjectURL(await r.blob());
      }
      const a = new Audio(cache.current[k]);
      a.onended = () => setPlaying(null);
      audio.current = a; setPlaying(s.id); a.play();
    } catch { setPlaying(null); }
  };
  const download = async (path, name) => {
    const r = await fetch(api(path));
    if (!r.ok) return;
    const u = URL.createObjectURL(await r.blob());
    const a = document.createElement('a'); a.href = u; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(u), 10000);
  };

  if (!project.target_language) {
    return <div className="rounded-xl border border-dashed border-[var(--kt-s4)] px-4 py-8 text-sm text-[var(--kt-faint)]">Translate the lines first (Translation tab), then generate the voice-over here.</div>;
  }
  const out = project.outputs;
  const base = project.filename.replace(/\.[^.]+$/, '');

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl border border-[var(--kt-s4)] bg-[var(--kt-s1)] p-3 flex flex-wrap items-center gap-2">
        <Btn primary icon={Mic2} disabled={busy || running || !todo.length} onClick={() => speak(undefined, true)}>Generate {todo.length ? `${todo.length} missing or changed` : 'lines'}</Btn>
        <Btn icon={Wand2} disabled={busy || running || !withText.length} onClick={() => window.confirm(`Regenerate all ${withText.length} lines? This uses about ${chars(withText)} ElevenLabs characters.`) && speak(undefined, false)}>Regenerate all</Btn>
        <Btn icon={AudioLines} disabled={busy || running || !lines.some((s) => s.audio?.ready)} onClick={mix}>Mix the dub</Btn>
        <span className="text-xs text-[var(--kt-faint)]">{todo.length ? `About ${chars(todo)} ElevenLabs characters to generate. ` : ''}Speech uses your ElevenLabs credits, not your hours.</span>
      </div>

      {out ? (
        <div className="rounded-xl border border-[var(--kt-success)]/40 bg-[var(--kt-s1)] p-3 flex flex-col gap-2">
          <div className="text-sm font-semibold">Mixed dub</div>
          <div className="flex flex-wrap gap-2">
            <Btn primary small icon={Download} onClick={() => download(`/projects/${projectId}/download/audio`, `${base}.${project.target_language}.dub.mp3`)}>Dub audio</Btn>
            {Object.keys(out.speakers || {}).map((n) => (
              <Btn key={n} small icon={Download} onClick={() => download(`/projects/${projectId}/download/speaker?speaker=${encodeURIComponent(n)}`, `${base}.${n.replace(/\s+/g, '_')}.mp3`)}>{n}</Btn>
            ))}
          </div>
          <div className="text-xs text-[var(--kt-faint)]">Lines changed after mixing are not in this file until you mix again.</div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {Object.entries(project.speakers || {}).map(([name, sp]) => (
          <div key={name} className="rounded-xl border border-[var(--kt-s4)] bg-[var(--kt-s1)] p-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">{name} <span className="text-xs font-normal text-[var(--kt-faint)]">default voice controls</span></div>
              <Btn small icon={SlidersHorizontal} onClick={() => setOpenSpeaker(openSpeaker === name ? null : name)}>{openSpeaker === name ? 'Close' : 'Adjust'}</Btn>
            </div>
            {openSpeaker === name ? <Controls value={sp.tts || {}} disabled={busy || running} onChange={(v) => saveSpeaker(name, v)} /> : null}
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-[var(--kt-s4)] bg-[var(--kt-s1)] divide-y divide-[var(--kt-s4)]">
        {lines.map((s) => {
          const a = s.audio || {};
          const slot = s.end - s.start;
          const badge = a.error ? ['Failed', 'text-[var(--kt-danger)]'] : !a.ready ? ['Not generated', 'text-[var(--kt-faint)]']
            : a.stale ? ['Changed since generated', 'text-[var(--kt-warn)]']
              : a.overrun ? [`Longer than its slot (${a.duration.toFixed(1)}s of ${slot.toFixed(1)}s)`, 'text-[var(--kt-warn)]']
                : [`${a.duration.toFixed(1)}s of ${slot.toFixed(1)}s${a.tempo > 1.01 ? `, sped up ${a.tempo.toFixed(2)}x` : ''}`, 'text-[var(--kt-success)]'];
          return (
            <div key={s.id} className={`p-2.5 text-sm ${s.mute ? 'opacity-50' : ''}`}>
              <div className="grid grid-cols-1 md:grid-cols-[110px_1fr_auto] gap-2 items-start">
                <div className="text-xs text-[var(--kt-faint)]">{s.speaker}<br />{fmtTime(s.start)}</div>
                <div>
                  <div style={{ fontFamily: 'var(--kt-font-script)' }}>{s.translation || <span className="text-[var(--kt-faint)]">No translation</span>}</div>
                  <div className={`text-[11px] mt-0.5 ${badge[1]}`} title={a.error || ''}>{badge[0]}{a.error ? `: ${a.error}` : ''}</div>
                </div>
                <div className="flex flex-wrap gap-1 items-center">
                  <Btn small icon={playing === s.id ? Pause : Play} disabled={!a.ready} title="Play the generated line" onClick={() => play(s)} />
                  <Btn small icon={Mic2} disabled={busy || running || !(s.translation || '').trim()} title="Generate or regenerate this line" onClick={() => speak([s.id], false)}>{a.ready ? 'Redo' : 'Make'}</Btn>
                  <Btn small icon={SlidersHorizontal} title="Voice controls for this line" onClick={() => setOpenLine(openLine === s.id ? null : s.id)} />
                  <Btn small icon={s.mute ? VolumeX : Volume2} title={s.mute ? 'Muted in the mix' : 'Mute in the mix'} onClick={() => edit(s.id, { mute: !s.mute })} />
                </div>
              </div>
              {openLine === s.id ? (
                <div className="mt-2 pl-0 md:pl-[118px]">
                  <label className="text-xs text-[var(--kt-muted)] flex items-center gap-3">Level in the mix
                    <input type="range" min="0" max="2" step="0.05" value={s.gain ?? 1} onChange={(e) => edit(s.id, { gain: Number(e.target.value) })} />
                    <span>{Math.round((s.gain ?? 1) * 100)}%</span></label>
                  <label className="text-xs text-[var(--kt-muted)] flex items-center gap-3 mt-1">Start shift (seconds)
                    <input type="range" min="-3" max="3" step="0.05" value={s.shift ?? 0} onChange={(e) => edit(s.id, { shift: Number(e.target.value) })} />
                    <span>{(s.shift ?? 0).toFixed(2)}</span></label>
                  <Controls value={s.tts || {}} fallback={project.speakers?.[s.speaker]?.tts || {}} disabled={busy || running} onChange={(v) => edit(s.id, { tts: v })} />
                  <div className="text-[11px] text-[var(--kt-faint)] mt-1">Changes apply when you press Redo (level and shift apply when you mix).</div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
