import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2, Play, Save, Scissors, Merge, Trash2, Plus, Languages, Wand2, Mic2, Volume2, AlertTriangle, X, RotateCcw,
} from 'lucide-react';
import { api, call, send, GRAD, fmtTime } from './dubApi';
import VoiceOverTab from './VoiceOverTab';
import TimelineTab from './TimelineTab';

const TABS = [['transcript', 'Transcript'], ['speakers', 'Speakers & voices'], ['translation', 'Translation'], ['voiceover', 'Voice-over'], ['timeline', 'Timeline']];
const BUSY = new Set(['transcribing', 'profiling', 'translating', 'speaking', 'separating', 'rendering']);

function Btn({ children, onClick, disabled, primary, icon: Icon, small, title }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title}
      className={`${small ? 'h-7 px-2 text-xs' : 'h-9 px-4 text-[13px]'} rounded-lg font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${primary ? 'text-white' : 'border border-[var(--kt-s5)] bg-[var(--kt-s2)] hover:bg-[var(--kt-s3)]'}`}
      style={primary ? { background: GRAD } : undefined}>
      {Icon ? <Icon size={small ? 12 : 14} /> : null}{children}
    </button>
  );
}
const Chip = ({ children }) => <span className="px-2 py-0.5 rounded-md text-[11px] bg-[var(--kt-s3)] text-[var(--kt-muted)] border border-[var(--kt-s4)]">{children}</span>;
const inputCls = 'rounded-md bg-[var(--kt-s2)] border border-[var(--kt-s5)] px-2 text-sm';

export default function ProjectEditor({ projectId, onClose }) {
  const [project, setProject] = useState(null);
  const [segs, setSegs] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState('transcript');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [voices, setVoices] = useState(null);
  const [target, setTarget] = useState('English');
  const [mediaUrl, setMediaUrl] = useState('');
  const [selected, setSelected] = useState(null);
  const player = useRef(null);
  const stopAt = useRef(null);
  const carets = useRef({});
  const dirtyRef = useRef(false);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);

  const apply = useCallback((p, force = false) => {
    setProject(p);
    if (force || !dirtyRef.current) { setSegs(p.segments || []); setDirty(false); }
    if (p.target_language) setTarget(p.target_language);
    else if (p.source_language) setTarget((t) => (t === p.source_language ? (t === 'English' ? 'Hindi' : 'English') : t));
  }, []);

  const refresh = useCallback(async (force = false) => {
    try { apply(await call(`/projects/${projectId}`), force); } catch (e) { setError(e.message); }
  }, [projectId, apply]);

  useEffect(() => { refresh(true); }, [refresh]);
  useEffect(() => {
    if (!project || !BUSY.has(project.status)) return undefined;
    const t = setInterval(() => refresh(false), 2000);
    return () => clearInterval(t);
  }, [project, refresh]);

  // The recording, for playing lines
  useEffect(() => {
    let url = '';
    fetch(api(`/projects/${projectId}/media`)).then((r) => (r.ok ? r.blob() : null)).then((b) => { if (b) { url = URL.createObjectURL(b); setMediaUrl(url); } }).catch(() => {});
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [projectId]);

  useEffect(() => {
    if (tab === 'speakers' && !voices) call('/voices').then((d) => setVoices(d.voices)).catch((e) => { setVoices([]); setError(e.message); });
  }, [tab, voices]);

  const running = project && BUSY.has(project.status);
  const speakerNames = useMemo(() => Array.from(new Set(segs.map((s) => s.speaker))), [segs]);
  const lang = project?.languages || {};
  const cps = lang[target] || 14;

  const edit = (id, patch) => { setSegs((l) => l.map((s) => (s.id === id || s._k === id ? { ...s, ...patch } : s))); setDirty(true); };
  const key = (s) => s.id ?? s._k;

  const playLine = (s) => {
    const el = player.current;
    if (!el) return;
    el.currentTime = s.start; stopAt.current = s.end; el.play().catch(() => {});
    setSelected(key(s));
  };
  const onTime = () => { const el = player.current; if (el && stopAt.current != null && el.currentTime >= stopAt.current) { el.pause(); stopAt.current = null; } };

  const split = (s) => {
    const txt = s.text || '';
    const idx = Math.min(Math.max(1, carets.current[key(s)] ?? Math.floor(txt.length / 2)), Math.max(1, txt.length - 1));
    const cut = Math.round((s.start + (s.end - s.start) * (idx / Math.max(1, txt.length))) * 100) / 100;
    if (cut <= s.start + 0.05 || cut >= s.end - 0.05) return;
    setSegs((l) => l.flatMap((x) => (key(x) === key(s)
      ? [{ ...x, end: cut, text: txt.slice(0, idx).trim(), translation: '' }, { _k: `n${Date.now()}`, speaker: x.speaker, start: cut, end: x.end, text: txt.slice(idx).trim(), translation: '' }]
      : [x])));
    setDirty(true);
  };
  const merge = (i) => {
    setSegs((l) => {
      const a = l[i]; const b = l[i + 1];
      if (!b) return l;
      return [...l.slice(0, i), { ...a, end: b.end, text: `${a.text} ${b.text}`.trim(), translation: `${a.translation || ''} ${b.translation || ''}`.trim() }, ...l.slice(i + 2)];
    });
    setDirty(true);
  };
  const remove = (s) => { setSegs((l) => l.filter((x) => key(x) !== key(s))); setDirty(true); };
  const addAfter = (i) => {
    setSegs((l) => {
      const a = l[i]; const nextStart = l[i + 1]?.start ?? a.end + 2;
      const start = Math.round((a.end + 0.05) * 100) / 100; const end = Math.min(start + 2, Math.max(start + 0.5, nextStart - 0.05));
      return [...l.slice(0, i + 1), { _k: `n${Date.now()}`, speaker: a.speaker, start, end, text: '', translation: '' }, ...l.slice(i + 1)];
    });
    setDirty(true);
  };

  const wrap = async (fn) => {
    setError(''); setBusy(true);
    try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const save = () => wrap(async () => {
    const rows = segs.filter((s) => s.text.trim()).map(({ id, speaker, start, end, text, translation, tts, mute, gain, shift }) => ({ id, speaker, start, end, text, translation, tts, mute, gain, shift }));
    apply(await send('PUT', `/projects/${projectId}/segments`, { segments: rows }), true);
  });
  const translate = (ids) => wrap(async () => {
    if (dirty) await save();
    await send('POST', `/projects/${projectId}/translate`, { target_language: target, ids });
    await refresh(true);
  });
  const pickVoice = (name, v) => wrap(async () => apply(await send('PUT', `/projects/${projectId}/speakers/${encodeURIComponent(name)}/voice`, { voice_id: v.id, voice_name: v.name }), false));
  const clone = (name) => wrap(async () => apply(await send('POST', `/projects/${projectId}/speakers/${encodeURIComponent(name)}/clone`), false));
  const playSample = async (name) => {
    try {
      const r = await fetch(api(`/projects/${projectId}/speakers/${encodeURIComponent(name)}/sample`));
      if (!r.ok) throw new Error('No voice sample for this speaker.');
      const a = new Audio(URL.createObjectURL(await r.blob())); a.play();
    } catch (e) { setError(e.message); }
  };

  if (!project) return <div className="py-16 flex justify-center"><Loader2 className="animate-spin text-[var(--kt-accent)]" /></div>;
  const isVideo = project.is_video;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 flex-wrap">
        <button type="button" onClick={onClose} className="text-xs text-[var(--kt-muted)] hover:text-white cursor-pointer">&larr; All projects</button>
        <div className="font-semibold text-sm truncate">{project.filename}</div>
        <Chip>{project.source_language}</Chip>
        {project.target_language ? <Chip>to {project.target_language}</Chip> : null}
        <div className="flex-1" />
        <Btn primary icon={Save} onClick={save} disabled={!dirty || busy || running}>{dirty ? 'Save changes' : 'Saved'}</Btn>
      </div>

      {(error || project.error) ? (
        <div className="rounded-lg border border-[var(--kt-danger)]/40 bg-[var(--kt-danger)]/10 px-4 py-3 text-sm flex items-start gap-2">
          <AlertTriangle size={16} className="text-[var(--kt-danger)] mt-0.5 shrink-0" />
          <span className="flex-1">{error || project.error}</span>
          <button type="button" onClick={() => setError('')} aria-label="Dismiss" className="text-[var(--kt-faint)] hover:text-white cursor-pointer"><X size={14} /></button>
        </div>
      ) : null}

      {running ? (
        <div className="rounded-xl border border-[var(--kt-s4)] bg-[var(--kt-s1)] p-4">
          <div className="flex items-center gap-2 text-sm font-medium"><Loader2 size={15} className="animate-spin text-[var(--kt-accent)]" />{project.detail || 'Working'}</div>
          <div className="mt-3 h-2 rounded-full bg-[var(--kt-s3)] overflow-hidden"><div className="h-full transition-all" style={{ width: `${Math.max(3, project.percent || 0)}%`, background: GRAD }} /></div>
          <div className="mt-3"><Btn small icon={X} onClick={() => send('POST', `/projects/${projectId}/cancel`).then(() => refresh(true))}>Cancel</Btn></div>
        </div>
      ) : null}

      {mediaUrl ? (
        <div className="rounded-xl border border-[var(--kt-s4)] bg-black/30 p-2">
          {isVideo
            ? <video ref={player} src={mediaUrl} controls onTimeUpdate={onTime} className="w-full max-h-[260px] rounded-lg bg-black" />
            : <audio ref={player} src={mediaUrl} controls onTimeUpdate={onTime} className="w-full" />}
        </div>
      ) : null}

      <div className="flex gap-1 border-b border-[var(--kt-s4)]">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" onClick={() => setTab(id)}
            className={`px-4 h-9 text-sm cursor-pointer border-b-2 -mb-px ${tab === id ? 'border-[var(--kt-accent)] text-white font-semibold' : 'border-transparent text-[var(--kt-muted)] hover:text-white'}`}>{label}</button>
        ))}
      </div>

      {tab === 'transcript' ? (
        <div className="rounded-xl border border-[var(--kt-s4)] bg-[var(--kt-s1)] divide-y divide-[var(--kt-s4)]">
          {segs.map((s, i) => (
            <div key={key(s)} className={`p-2.5 grid grid-cols-1 md:grid-cols-[130px_150px_1fr_auto] gap-2 items-start ${selected === key(s) ? 'bg-[var(--kt-selected)]' : ''}`}>
              <div className="flex items-center gap-1 text-xs">
                <input type="number" step="0.05" min="0" value={s.start} disabled={running} onChange={(e) => edit(key(s), { start: Number(e.target.value) })} className={`${inputCls} w-[58px] h-7`} aria-label="Start seconds" />
                <span className="text-[var(--kt-faint)]">&ndash;</span>
                <input type="number" step="0.05" min="0" value={s.end} disabled={running} onChange={(e) => edit(key(s), { end: Number(e.target.value) })} className={`${inputCls} w-[58px] h-7`} aria-label="End seconds" />
              </div>
              <div className="flex items-center gap-1">
                <select value={s.speaker} disabled={running} onChange={(e) => {
                  if (e.target.value === '__new') { const n = window.prompt('Name of the new speaker'); if (n && n.trim()) edit(key(s), { speaker: n.trim().slice(0, 40) }); } else edit(key(s), { speaker: e.target.value });
                }} className={`${inputCls} h-7 w-full`}>
                  {speakerNames.map((n) => <option key={n}>{n}</option>)}<option value="__new">+ New speaker…</option>
                </select>
              </div>
              <textarea rows={2} value={s.text} disabled={running} onChange={(e) => edit(key(s), { text: e.target.value })}
                onSelect={(e) => { carets.current[key(s)] = e.target.selectionStart; }}
                className={`${inputCls} w-full py-1 resize-y`} style={{ fontFamily: 'var(--kt-font-script)' }} />
              <div className="flex gap-1 md:flex-col lg:flex-row">
                <Btn small icon={Play} title="Play this line" onClick={() => playLine(s)} />
                <Btn small icon={Scissors} title="Split at the cursor" disabled={running} onClick={() => split(s)} />
                <Btn small icon={Merge} title="Merge with the next line" disabled={running || i === segs.length - 1} onClick={() => merge(i)} />
                <Btn small icon={Plus} title="Add a line after" disabled={running} onClick={() => addAfter(i)} />
                <Btn small icon={Trash2} title="Delete" disabled={running} onClick={() => remove(s)} />
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {tab === 'speakers' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {Object.entries(project.speakers || {}).map(([name, sp]) => {
            const cur = sp.voice || {};
            const list = (voices || []).filter((v) => !sp.gender || sp.gender === 'Unknown' || !v.gender || v.gender.toLowerCase() === sp.gender.toLowerCase());
            const curVoice = (voices || []).find((v) => v.id === cur.voice_id);
            return (
              <div key={name} className="rounded-xl border border-[var(--kt-s4)] bg-[var(--kt-s1)] p-4 flex flex-col gap-2">
                <div className="flex items-center justify-between"><div className="font-semibold text-sm">{name}</div>
                  <div className="text-xs text-[var(--kt-faint)]">{fmtTime(sp.talk_seconds || 0)} speaking · {sp.lines ?? ''} lines</div></div>
                <div className="flex flex-wrap gap-1.5">
                  <Chip>{sp.gender}</Chip>{sp.age_range ? <Chip>{sp.age_range}</Chip> : null}
                  {(sp.tone || []).map((t) => <Chip key={t}>{t}</Chip>)}
                  {sp.pace ? <Chip>{sp.pace} pace · {Math.round(sp.words_per_minute || 0)} wpm</Chip> : null}
                  {sp.energy ? <Chip>{sp.energy} energy</Chip> : null}
                </div>
                {sp.accent ? <div className="text-xs text-[var(--kt-muted)]">Accent: {sp.accent}</div> : null}
                {sp.voice_description ? <div className="text-xs text-[var(--kt-faint)]">{sp.voice_description}</div> : null}
                <div className="mt-1 text-xs text-[var(--kt-muted)]">Dubbing voice: <strong className="text-white">{cur.mode === 'clone' ? 'Cloned from this speaker' : (curVoice?.name || cur.voice_name || 'not chosen')}</strong></div>
                <div className="flex flex-wrap items-center gap-2">
                  <select value={cur.mode === 'clone' ? '' : (cur.voice_id || '')} disabled={busy || !voices} onChange={(e) => { const v = voices.find((x) => x.id === e.target.value); if (v) pickVoice(name, v); }} className={`${inputCls} h-8 max-w-[220px]`}>
                    <option value="" disabled>{voices ? 'Pick a stock voice' : 'Loading voices…'}</option>
                    {list.map((v) => <option key={v.id} value={v.id}>{v.name}{v.accent ? ` · ${v.accent}` : ''}{v.age ? ` · ${v.age}` : ''}</option>)}
                  </select>
                  {curVoice?.preview_url ? <Btn small icon={Volume2} onClick={() => new Audio(curVoice.preview_url).play()}>Voice preview</Btn> : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Btn small icon={Play} onClick={() => playSample(name)}>Hear original</Btn>
                  <Btn small icon={Mic2} disabled={busy} onClick={() => clone(name)}>{cur.cloned_id ? 'Clone again' : 'Clone this voice'}</Btn>
                  {cur.cloned_id && cur.mode !== 'clone' ? <Btn small onClick={() => pickVoice(name, { id: cur.cloned_id, name: 'Cloned voice' })}>Use the clone</Btn> : null}
                </div>
              </div>
            );
          })}
          <div className="md:col-span-2"><Btn icon={RotateCcw} disabled={busy || running} onClick={() => wrap(async () => { await send('POST', `/projects/${projectId}/profiles`); await refresh(true); })}>Re-profile the speakers</Btn></div>
        </div>
      ) : null}

      {tab === 'translation' ? (
        <div className="flex flex-col gap-3">
          <div className="rounded-xl border border-[var(--kt-s4)] bg-[var(--kt-s1)] p-3 flex flex-wrap items-center gap-3">
            <Languages size={16} className="text-[var(--kt-accent)]" /><span className="text-sm">Translate into</span>
            <select value={target} onChange={(e) => setTarget(e.target.value)} className={`${inputCls} h-8`}>
              {Object.keys(lang).filter((l) => l !== project.source_language).map((l) => <option key={l}>{l}</option>)}
            </select>
            <Btn primary icon={Wand2} disabled={busy || running} onClick={() => translate(undefined)}>Translate all lines</Btn>
            <span className="text-xs text-[var(--kt-faint)]">Lines are sized to fit their time. Edit any line by hand.</span>
          </div>
          <div className="rounded-xl border border-[var(--kt-s4)] bg-[var(--kt-s1)] divide-y divide-[var(--kt-s4)]">
            {segs.filter((s) => s.id != null).map((s) => {
              const budget = Math.max(6, Math.floor((s.end - s.start) * cps));
              const len = (s.translation || '').length;
              return (
                <div key={s.id} className="p-2.5 grid grid-cols-1 md:grid-cols-[120px_1fr_1fr_auto] gap-2 items-start text-sm">
                  <div className="text-xs text-[var(--kt-faint)]">{s.speaker}<br />{fmtTime(s.start)} · {(s.end - s.start).toFixed(1)}s</div>
                  <div className="text-[var(--kt-muted)]" style={{ fontFamily: 'var(--kt-font-script)' }}>{s.text}</div>
                  <div>
                    <textarea rows={2} value={s.translation || ''} disabled={running} onChange={(e) => edit(s.id, { translation: e.target.value })}
                      className={`${inputCls} w-full py-1 resize-y ${len > budget * 1.15 ? '!border-[var(--kt-warn)]' : ''}`} style={{ fontFamily: 'var(--kt-font-script)' }} />
                    <div className={`text-[11px] ${len > budget * 1.15 ? 'text-[var(--kt-warn)]' : 'text-[var(--kt-faint)]'}`}>{len} / ~{budget} characters fit in {(s.end - s.start).toFixed(1)}s</div>
                  </div>
                  <Btn small icon={Wand2} title="Translate this line again" disabled={busy || running} onClick={() => translate([s.id])}>Redo</Btn>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {tab === 'voiceover' ? (
        <VoiceOverTab projectId={projectId} project={project} segs={segs} edit={edit} dirty={dirty} save={save} wrap={wrap}
          refresh={refresh} apply={apply} running={running} busy={busy} />
      ) : null}
      {tab === 'timeline' ? (
        <TimelineTab projectId={projectId} project={project} segs={segs} edit={edit} dirty={dirty} save={save} wrap={wrap}
          refresh={refresh} running={running} busy={busy} player={player} mediaUrl={mediaUrl} />
      ) : null}
    </div>
  );
}
