import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Download, Loader2, Save, AlertTriangle, Check } from 'lucide-react';
import { API_BASE } from '../../config';
import { buildSavedDraft, cps, cueAt, fmtTime, parseTime, qcIssues, suggestionText, toSrt, trackSet } from './reviewModel';

// The linguist's editor: the shared video, every cue with editable text and timing, saved back to the shared project.
// Everything here talks to /api/shares only; there is no upload, generation, translation or AI call in this file.

const AUTOSAVE_MS = 2500;
const CPS_WARN = 20;

async function api(path, options) {
  const res = await fetch(`${API_BASE}/api/shares${path}`, { ...options, headers: { 'Content-Type': 'application/json' } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(typeof data.detail === 'string' ? data.detail : 'Something went wrong'); e.status = res.status; throw e; }
  return data;
}

function TimeField({ value, onCommit, label }) {
  const [text, setText] = useState(fmtTime(value));
  const [bad, setBad] = useState(false);
  useEffect(() => { setText(fmtTime(value)); setBad(false); }, [value]);
  const commit = () => {
    const t = parseTime(text);
    if (t === null) { setBad(true); return; }
    setBad(false);
    if (Math.abs(t - value) > 0.0004) onCommit(t);
    else setText(fmtTime(value));
  };
  return (
    <input
      aria-label={label} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      className={`w-[104px] h-7 rounded-md border bg-[var(--kt-s0)] px-2 text-[12px] font-mono tabular-nums text-[var(--kt-text)] focus:outline-none focus:border-[var(--kt-accent)] ${bad ? 'border-[var(--kt-danger)]' : 'border-[var(--kt-s4)]'}`}
    />
  );
}

export default function ReviewEditor({ projectId, onBack }) {
  const [meta, setMeta] = useState(null);
  const [draft, setDraft] = useState(null);
  const [tracks, setTracks] = useState({});
  const [codes, setCodes] = useState([]);
  const [track, setTrack] = useState(null);
  const [issues, setIssues] = useState([]); // the coordinator's QC findings; resolving one is saved with the project
  const [revision, setRevision] = useState(1);
  const [state, setState] = useState('loading'); // loading | saved | dirty | saving | conflict | error
  const [error, setError] = useState('');
  const [videoUrl, setVideoUrl] = useState(null);
  const [now, setNow] = useState(0);
  const [activeIdx, setActiveIdx] = useState(-1);
  const videoRef = useRef(null);
  const timerRef = useRef(null);
  const latest = useRef({});
  latest.current = { draft, tracks, revision, state, issues };

  const load = useCallback(async () => {
    setState('loading'); setError('');
    try {
      const data = await api(`/projects/${projectId}`);
      const t = trackSet(data.draft);
      setMeta(data.project); setDraft(data.draft); setIssues(qcIssues(data.draft)); setTracks(t.tracks); setCodes(t.codes); setTrack(t.active);
      setRevision(data.project.revision); setState('saved');
      api(`/projects/${projectId}/video-link`).then((l) => setVideoUrl(l.available ? `${API_BASE}${l.url}` : null)).catch(() => setVideoUrl(null));
    } catch (e) { setError(e.message); setState('error'); }
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  const save = useCallback(async () => {
    const { draft: d, tracks: t, revision: r, issues: qi } = latest.current;
    if (!d) return;
    clearTimeout(timerRef.current);
    setState('saving'); setError('');
    try {
      const out = await api(`/projects/${projectId}/draft`, { method: 'PUT', body: JSON.stringify({ draft: buildSavedDraft(d, t, qi), base_revision: r }) });
      setRevision(out.revision);
      const unchanged = latest.current.tracks === t && latest.current.issues === qi;
      setState(unchanged ? 'saved' : 'dirty');
      if (!unchanged) timerRef.current = setTimeout(save, AUTOSAVE_MS);
    } catch (e) {
      setError(e.message); setState(e.status === 409 ? 'conflict' : 'error');
    }
  }, [projectId]);

  const touch = (next, nextIssues) => {
    if (next) setTracks(next);
    if (nextIssues) setIssues(nextIssues);
    setState('dirty');
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(save, AUTOSAVE_MS);
  };
  useEffect(() => () => clearTimeout(timerRef.current), []);
  useEffect(() => {
    const warn = (e) => { if (['dirty', 'saving', 'conflict', 'error'].includes(latest.current.state)) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  const events = useMemo(() => tracks[track] || [], [tracks, track]);
  const edit = (i, patch) => touch({ ...tracks, [track]: events.map((e, k) => (k === i ? { ...e, ...patch } : e)) });
  const trackIssues = useMemo(() => issues.filter((q) => (q.track || '__main') === track), [issues, track]);
  const openCount = trackIssues.filter((q) => q.status === 'open').length;
  const resolve = (q, status) => touch(null, issues.map((x) => (x === q ? { ...x, status } : x)));
  const useSuggestion = (q) => {
    const i = q.index - 1;
    if (!events[i]) return;
    touch({ ...tracks, [track]: events.map((e, k) => (k === i ? { ...e, text: suggestionText(q), ...(q.suggestion_end != null ? { end_time: q.suggestion_end } : {}) } : e)) },
      issues.map((x) => (x === q ? { ...x, status: 'resolved' } : x)));
  };
  const setStart = (i, t) => {
    const end = events[i].end_time ?? events[i].end;
    if (t >= end) { setError('The start must be before the end.'); return; }
    setError(''); edit(i, { start_time: t });
  };
  const setEnd = (i, t) => {
    const start = events[i].start_time ?? events[i].start;
    if (t <= start) { setError('The end must be after the start.'); return; }
    setError(''); edit(i, { end_time: t });
  };

  const seek = (i) => {
    setActiveIdx(i);
    const v = videoRef.current;
    if (v) { v.currentTime = events[i].start_time ?? events[i].start ?? 0; }
  };
  const onTime = () => {
    const t = videoRef.current?.currentTime || 0;
    setNow(t);
    const idx = cueAt(events, t);
    if (idx !== activeIdx && idx >= 0) {
      setActiveIdx(idx);
      document.getElementById(`cue-${idx}`)?.scrollIntoView({ block: 'nearest' });
    }
  };

  const exportSrt = () => {
    const blob = new Blob([toSrt(events)], { type: 'application/x-subrip' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(meta?.title || 'subtitles').replace(/[^\w.-]+/g, '_')}${track && track !== '__main' ? `.${track}` : ''}.srt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  const onCue = events[cueAt(events, now)];
  const label = { loading: 'Loading…', saved: 'All changes saved', dirty: 'Unsaved changes', saving: 'Saving…', conflict: 'Newer version exists', error: 'Not saved' }[state];

  if (state === 'loading' && !draft) return <div className="min-h-screen flex items-center justify-center bg-[var(--kt-s0)] text-[var(--kt-muted)]"><Loader2 className="animate-spin" /></div>;
  if (!draft) return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-[var(--kt-s0)] text-[var(--kt-text)]">
      <p>{error || 'This project is not available.'}</p>
      <button type="button" onClick={onBack} className="px-3 py-2 rounded-lg bg-[var(--kt-s2)] cursor-pointer">Back to shared projects</button>
    </div>
  );

  return (
    <div className="h-screen flex flex-col bg-[var(--kt-s0)] text-[var(--kt-text)]">
      <header className="flex flex-wrap items-center gap-3 px-4 py-2.5 border-b border-[var(--kt-s3)] bg-[var(--kt-s1)]">
        <button type="button" onClick={onBack} className="p-1.5 rounded-lg hover:bg-[var(--kt-s2)] cursor-pointer" aria-label="Back to shared projects"><ArrowLeft size={16} /></button>
        <div className="min-w-0">
          <div className="text-[14px] font-semibold truncate">{meta?.title}</div>
          <div className="text-[12px] text-[var(--kt-muted)]">Shared by {meta?.owner?.name}</div>
        </div>
        {codes.length > 1 && (
          <div className="flex gap-1 ml-2" role="tablist" aria-label="Languages">
            {codes.map((c) => (
              <button key={c} type="button" role="tab" aria-selected={c === track} onClick={() => { setTrack(c); setActiveIdx(-1); }}
                className={`h-7 px-2.5 rounded-md text-[12px] font-medium cursor-pointer ${c === track ? 'bg-[var(--kt-accent)] text-[var(--kt-accent-ink)]' : 'bg-[var(--kt-s2)] text-[var(--kt-muted)] hover:text-[var(--kt-text)]'}`}>{c.toUpperCase()}</button>
            ))}
          </div>
        )}
        {trackIssues.length > 0 && (
          <span className={`text-[12px] px-2 py-1 rounded-md ${openCount ? 'bg-[var(--kt-warn)]/15 text-[var(--kt-warn)]' : 'bg-[var(--kt-success)]/15 text-[var(--kt-success)]'}`}>
            {openCount ? `${openCount} QC finding${openCount === 1 ? '' : 's'} to check` : 'All QC findings resolved'}
          </span>
        )}
        <div className="ml-auto flex items-center gap-3">
          <span className={`text-[12px] inline-flex items-center gap-1 ${state === 'saved' ? 'text-[var(--kt-success)]' : state === 'conflict' || state === 'error' ? 'text-[var(--kt-danger)]' : 'text-[var(--kt-muted)]'}`}>
            {state === 'saved' ? <Check size={13} /> : state === 'saving' ? <Loader2 size={13} className="animate-spin" /> : state === 'conflict' || state === 'error' ? <AlertTriangle size={13} /> : null}{label}
          </span>
          <button type="button" onClick={save} disabled={state === 'saving' || state === 'saved' || state === 'conflict'}
            className="h-8 px-3 rounded-lg text-[13px] font-semibold bg-[var(--kt-accent)] text-[var(--kt-accent-ink)] disabled:opacity-40 cursor-pointer inline-flex items-center gap-1.5"><Save size={13} /> Save</button>
          <button type="button" onClick={exportSrt} className="h-8 px-3 rounded-lg text-[13px] font-medium bg-[var(--kt-s2)] hover:bg-[var(--kt-s3)] cursor-pointer inline-flex items-center gap-1.5"><Download size={13} /> Export SRT</button>
        </div>
      </header>

      {(state === 'conflict' || (error && state !== 'dirty')) && (
        <div className="px-4 py-2 text-[13px] bg-[var(--kt-danger)]/10 text-[var(--kt-danger)] flex items-center justify-between gap-3">
          <span>{error}</span>
          {state === 'conflict' && <button type="button" onClick={load} className="px-3 py-1 rounded-md bg-[var(--kt-s2)] text-[var(--kt-text)] cursor-pointer">Reload latest (discards my unsaved edits)</button>}
        </div>
      )}

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
        <aside className="lg:w-[44%] lg:max-w-[640px] shrink-0 p-4 border-b lg:border-b-0 lg:border-r border-[var(--kt-s3)] bg-black/20">
          {videoUrl ? (
            <div className="relative rounded-xl overflow-hidden bg-black">
              <video ref={videoRef} src={videoUrl} controls onTimeUpdate={onTime} className="w-full max-h-[56vh]" />
              {onCue && <div className="pointer-events-none absolute left-0 right-0 bottom-12 px-6 text-center"><span className="inline-block px-2 py-1 rounded bg-black/70 text-white text-[15px] leading-snug whitespace-pre-line">{String(onCue.text).replace(/<[^>]*>/g, '')}</span></div>}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-[var(--kt-s4)] p-6 text-[13px] text-[var(--kt-muted)]">No video is attached to this project. You can still review and edit the subtitles.</div>
          )}
          <p className="mt-3 text-[12px] text-[var(--kt-faint)]">Click a line to jump to it. Times accept 1:02.5 or 00:01:02.500. Lines over {CPS_WARN} characters per second are marked.</p>
        </aside>

        <main className="flex-1 min-w-0 overflow-y-auto">
          {events.length === 0 ? <div className="p-8 text-center text-[var(--kt-muted)]">This track has no subtitles.</div> : (
            <ol>
              {events.map((e, i) => {
                const speed = cps(e);
                const start = e.start_time ?? e.start ?? 0;
                const end = e.end_time ?? e.end ?? 0;
                return (
                  <li key={e.id ?? i} id={`cue-${i}`} onClick={() => seek(i)}
                    className={`flex gap-3 px-4 py-3 border-b border-[var(--kt-s3)] ${i === activeIdx ? 'bg-[var(--kt-s2)]' : ''}`}>
                    <span className="w-8 shrink-0 pt-1 text-[12px] text-[var(--kt-faint)] tabular-nums">{i + 1}</span>
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2" onClick={(ev) => ev.stopPropagation()}>
                        <TimeField label={`Start of line ${i + 1}`} value={start} onCommit={(t) => setStart(i, t)} />
                        <span className="text-[var(--kt-faint)]">→</span>
                        <TimeField label={`End of line ${i + 1}`} value={end} onCommit={(t) => setEnd(i, t)} />
                        <span className={`text-[12px] tabular-nums ${speed > CPS_WARN ? 'text-[var(--kt-danger)] font-semibold' : 'text-[var(--kt-faint)]'}`}>{speed.toFixed(1)} cps</span>
                      </div>
                      <textarea
                        aria-label={`Subtitle ${i + 1}`} value={e.text ?? ''} rows={Math.max(2, String(e.text ?? '').split('\n').length)}
                        onClick={(ev) => ev.stopPropagation()} onFocus={() => setActiveIdx(i)}
                        onChange={(ev) => edit(i, { text: ev.target.value })}
                        className="w-full rounded-lg border border-[var(--kt-s4)] bg-[var(--kt-s0)] px-3 py-2 text-[14px] leading-relaxed focus:outline-none focus:border-[var(--kt-accent)] resize-y"
                      />
                      {trackIssues.filter((q) => q.index === i + 1).map((q, n) => (
                        <div key={n} onClick={(ev) => ev.stopPropagation()}
                          className={`rounded-lg border px-3 py-2 text-[12.5px] ${q.status === 'open' ? 'border-[var(--kt-warn)]/40 bg-[var(--kt-warn)]/5' : 'border-[var(--kt-s3)] opacity-60'}`}>
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="font-medium text-[var(--kt-text)]">{q.title}{q.severity === 'error' ? '' : ' (warning)'}</div>
                              {q.description && <div className="text-[var(--kt-muted)]">{q.description}</div>}
                              {q.source && <div className="mt-1 text-[var(--kt-faint)]">Source: <span className="whitespace-pre-wrap">{q.source}</span></div>}
                              {suggestionText(q) && <div className="mt-1 text-[var(--kt-muted)]">Suggested: <span className="whitespace-pre-wrap text-[var(--kt-text)]">{suggestionText(q)}</span></div>}
                            </div>
                            <div className="flex gap-1.5 shrink-0">
                              {q.status === 'open' && suggestionText(q) && <button type="button" onClick={() => useSuggestion(q)} className="h-7 px-2 rounded-md bg-[var(--kt-accent)] text-[var(--kt-accent-ink)] font-medium cursor-pointer">Use suggestion</button>}
                              {q.status === 'open'
                                ? <button type="button" onClick={() => resolve(q, 'resolved')} className="h-7 px-2 rounded-md bg-[var(--kt-s2)] hover:bg-[var(--kt-s3)] cursor-pointer">Mark checked</button>
                                : <button type="button" onClick={() => resolve(q, 'open')} className="h-7 px-2 rounded-md bg-[var(--kt-s2)] cursor-pointer">Reopen</button>}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </main>
      </div>
    </div>
  );
}
