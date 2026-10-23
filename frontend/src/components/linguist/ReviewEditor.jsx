import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Download, Loader2, Save, AlertTriangle, Check, Plus, Lock } from 'lucide-react';
import AudioWaveformTimeline from '../subtitle/AudioWaveformTimeline';
import BrandLogo from '../BrandLogo';
import { publishPlayhead, getPlayhead } from '../../utils/playheadBus';
import { API_BASE } from '../../config';
import { addEvent, buildSavedDraft, cps, cueAt, ensureIds, fmtTime, mergeWithNext, parseTime, qcIssues, remapIssues, removeEvent, setTimes, shiftFollowing, splitAt, suggestionText, toSrt, trackSet } from './reviewModel';

// The linguist's editor: the shared video, every cue with editable text and timing, saved back to the shared project.
// Everything here talks to /api/shares only; there is no upload, generation, translation or AI call in this file.

const AUTOSAVE_MS = 2500;
const CPS_WARN = 20;
const PEAKS_PER_SEC = 50;
const MAX_DECODE_BYTES = 150 * 1024 * 1024;
const HISTORY_LIMIT = 80;

/** Waveform peaks (0..1) decoded in the browser from the shared video. Skipped for very large files. */
async function decodePeaks(url, signal) {
  const res = await fetch(url, { signal });
  if (!res.ok) return [];
  const len = Number(res.headers.get('content-length') || 0);
  if (len > MAX_DECODE_BYTES) return [];
  const buf = await res.arrayBuffer();
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  try {
    const audio = await ctx.decodeAudioData(buf);
    const data = audio.getChannelData(0);
    const step = Math.max(1, Math.floor(audio.sampleRate / PEAKS_PER_SEC));
    const out = [];
    let max = 0;
    for (let i = 0; i < data.length; i += step) {
      let m = 0;
      const end = Math.min(data.length, i + step);
      for (let j = i; j < end; j++) { const v = Math.abs(data[j]); if (v > m) m = v; }
      out.push(m);
      if (m > max) max = m;
    }
    return max > 0 ? out.map((v) => v / max) : out;
  } finally { ctx.close?.().catch(() => {}); }
}

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
  const [activeId, setActiveId] = useState(null);
  const [duration, setDuration] = useState(0);
  const [peaks, setPeaks] = useState([]);
  const [histState, setHistState] = useState({ undo: false, redo: false });
  const hist = useRef({ past: [], future: [], key: '', at: 0 });
  const videoRef = useRef(null);
  const timerRef = useRef(null);
  const latest = useRef({});
  latest.current = { draft, tracks, revision, state, issues };

  const load = useCallback(async () => {
    setState('loading'); setError('');
    try {
      const data = await api(`/projects/${projectId}`);
      const t = trackSet(data.draft);
      Object.keys(t.tracks).forEach((c) => { t.tracks[c] = ensureIds(t.tracks[c]); });
      hist.current = { past: [], future: [], key: '', at: 0 };
      setHistState({ undo: false, redo: false });
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

  const touch = (next, nextIssues, coalesce = '') => {
    // Remember the state before this change so Undo can return to it; typing in one field counts as one step.
    const h = hist.current;
    const now = Date.now();
    if (!(coalesce && h.key === coalesce && now - h.at < 1500)) {
      h.past.push({ tracks: latest.current.tracks, issues: latest.current.issues });
      if (h.past.length > HISTORY_LIMIT) h.past.shift();
    }
    h.future = []; h.key = coalesce; h.at = now;
    setHistState({ undo: true, redo: false });
    if (next) setTracks(next);
    if (nextIssues) setIssues(nextIssues);
    setState('dirty');
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(save, AUTOSAVE_MS);
  };
  const jump = (from, to) => {
    const h = hist.current;
    const snap = h[from].pop();
    if (!snap) return;
    h[to].push({ tracks: latest.current.tracks, issues: latest.current.issues });
    h.key = '';
    setHistState({ undo: h.past.length > 0, redo: h.future.length > 0 });
    setTracks(snap.tracks); setIssues(snap.issues);
    setState('dirty');
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(save, AUTOSAVE_MS);
  };
  const undo = () => jump('past', 'future');
  const redo = () => jump('future', 'past');
  useEffect(() => () => clearTimeout(timerRef.current), []);
  useEffect(() => {
    const warn = (e) => { if (['dirty', 'saving', 'conflict', 'error'].includes(latest.current.state)) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  const events = useMemo(() => tracks[track] || [], [tracks, track]);
  const edit = (i, patch, coalesce = '') => touch({ ...tracks, [track]: events.map((e, k) => (k === i ? { ...e, ...patch } : e)) }, null, coalesce);
  const applyOp = (r) => {
    if (!r) return;
    touch({ ...tracks, [track]: r.events }, remapIssues(issues, track, r.issueMap));
    if (r.activeId !== undefined) setActiveId(r.activeId);
  };
  const activeIdx = events.findIndex((e) => e.id === activeId);
  const canUndo = histState.undo;
  const canRedo = histState.redo;
  const onTimeChange = useCallback((id, s0, e0) => {
    const { tracks: tr } = latest.current;
    const list = tr[track] || [];
    touch({ ...tr, [track]: setTimes(list, id, s0, e0).events }, null, `time-${id}`);
  }, [track]); // eslint-disable-line react-hooks/exhaustive-deps
  const trackIssues = useMemo(() => issues.filter((q) => (q.track || '__main') === track), [issues, track]);
  const openCount = trackIssues.filter((q) => q.status === 'open').length;
  const resolve = (q, status) => touch(null, issues.map((x) => (x === q ? { ...x, status } : x)));
  const applySuggestion = (q) => {
    const i = q.index - 1;
    if (!events[i]) return;
    touch({ ...tracks, [track]: events.map((e, k) => (k === i ? { ...e, text: suggestionText(q), ...(q.suggestion_end != null ? { end_time: q.suggestion_end } : {}) } : e)) },
      issues.map((x) => (x === q ? { ...x, status: 'resolved' } : x)));
  };
  const setStart = (i, t) => {
    const end = events[i].end_time ?? events[i].end;
    if (t >= end) { setError('The start must be before the end.'); return; }
    setError(''); edit(i, { start_time: t, start: t });
  };
  const setEnd = (i, t) => {
    const start = events[i].start_time ?? events[i].start;
    if (t <= start) { setError('The end must be after the start.'); return; }
    setError(''); edit(i, { end_time: t, end: t });
  };

  const seekTo = useCallback((t) => {
    const v = videoRef.current;
    if (v) v.currentTime = Math.max(0, t);
    publishPlayhead(Math.max(0, t));
    setNow(Math.max(0, t));
  }, []);
  const seek = (i) => {
    setActiveId(events[i].id);
    seekTo(events[i].start_time ?? events[i].start ?? 0);
  };
  const onTime = () => {
    const t = videoRef.current?.currentTime || 0;
    publishPlayhead(t);
    setNow(t);
    const idx = cueAt(events, t);
    if (idx >= 0 && events[idx].id !== activeId) {
      setActiveId(events[idx].id);
      document.getElementById(`cue-${idx}`)?.scrollIntoView({ block: 'nearest' });
    }
  };
  // Keep the timeline needle moving smoothly while the video plays.
  const rafRef = useRef(0);
  const onPlay = () => {
    cancelAnimationFrame(rafRef.current);
    const tick = () => { const v = videoRef.current; if (!v || v.paused) return; publishPlayhead(v.currentTime); rafRef.current = requestAnimationFrame(tick); };
    rafRef.current = requestAnimationFrame(tick);
  };
  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);
  useEffect(() => {
    if (!videoUrl) { setPeaks([]); return undefined; }
    const ctl = new AbortController();
    decodePeaks(videoUrl, ctl.signal).then(setPeaks).catch(() => {});
    return () => ctl.abort();
  }, [videoUrl]);
  const playEvent = (id) => {
    const e = events.find((x) => x.id === id);
    if (!e) return;
    seekTo(e.start_time ?? e.start ?? 0);
    videoRef.current?.play?.().catch(() => {});
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
        <BrandLogo variant="wordmark" size={26} className="hidden sm:block" />
        <div className="min-w-0 sm:border-l sm:border-[var(--kt-s4)] sm:pl-3">
          <div className="text-[14px] font-semibold truncate">{meta?.title}</div>
          <div className="text-[12px] text-[var(--kt-muted)]">Shared by {meta?.owner?.name}</div>
        </div>
        {codes.length > 1 && (
          <div className="flex gap-1 ml-2" role="tablist" aria-label="Languages">
            {codes.map((c) => (
              <button key={c} type="button" role="tab" aria-selected={c === track} onClick={() => { setTrack(c); setActiveId(null); hist.current = { past: [], future: [], key: '', at: 0 }; setHistState({ undo: false, redo: false }); }}
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

      <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden">
        <aside className="lg:w-[40%] lg:max-w-[560px] shrink-0 p-4 border-b lg:border-b-0 lg:border-r border-[var(--kt-s3)] bg-black/20 lg:overflow-y-auto">
          {videoUrl ? (
            <div className="relative rounded-xl overflow-hidden bg-black">
              <video ref={videoRef} src={videoUrl} controls crossOrigin="anonymous" onTimeUpdate={onTime} onPlay={onPlay} onSeeked={onTime} onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)} className="w-full max-h-[40vh]" />
              {onCue && <div className="pointer-events-none absolute left-0 right-0 bottom-12 px-6 text-center"><span className="inline-block px-2 py-1 rounded bg-black/70 text-white text-[15px] leading-snug whitespace-pre-line">{String(onCue.text).replace(/<[^>]*>/g, '')}</span></div>}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-[var(--kt-s4)] p-6 text-[13px] text-[var(--kt-muted)]">No video is attached to this project. You can still review and edit the subtitles.</div>
          )}
          <p className="mt-3 text-[12px] text-[var(--kt-faint)]">Click a line to jump to it. Change a time here, or drag the edges of a block in the timeline. Times accept 1:02.5 or 00:01:02.500. Lines over {CPS_WARN} characters per second are marked.</p>
          <p className="mt-2 text-[12px] text-[var(--kt-faint)] flex items-start gap-1.5"><Lock size={13} className="mt-0.5 shrink-0" /><span>Generate, Translate and AI fixes are not available here because they use hours. Everything else works.</span></p>
        </aside>

        <main className="flex-1 min-w-0 lg:overflow-y-auto">
          <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--kt-s3)] sticky top-0 z-10 bg-[var(--kt-s0)]">
            <span className="text-[13px] font-semibold">Lines</span>
            <span className="text-[12px] text-[var(--kt-muted)]">{events.length}</span>
            <button type="button" onClick={() => { const t = getPlayhead(); applyOp(addEvent(events, t, t + 2, '')); }}
              className="ml-auto h-7 px-2.5 rounded-md text-[12px] font-semibold bg-[var(--kt-accent)] text-[var(--kt-accent-ink)] cursor-pointer inline-flex items-center gap-1"><Plus size={13} /> Add line</button>
          </div>
          {events.length === 0 ? <div className="p-8 text-center text-[var(--kt-muted)]">This track has no subtitles. Use Add line to start one at the playhead.</div> : (
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
                        onClick={(ev) => ev.stopPropagation()} onFocus={() => setActiveId(e.id)}
                        onChange={(ev) => edit(i, { text: ev.target.value }, `text-${e.id}`)}
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
                              {q.status === 'open' && suggestionText(q) && <button type="button" onClick={() => applySuggestion(q)} className="h-7 px-2 rounded-md bg-[var(--kt-accent)] text-[var(--kt-accent-ink)] font-medium cursor-pointer">Use suggestion</button>}
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
        <div className="shrink-0 border-t border-[var(--kt-s3)] bg-[var(--kt-s1)]">
          <AudioWaveformTimeline
            videoUrl={videoUrl}
            initialPeaks={peaks}
            events={events}
            duration={duration}
            activeEventId={activeId}
            setActiveEventId={setActiveId}
            onEventTimeChange={onTimeChange}
            onSeek={seekTo}
            onAddSubtitleAtTime={(s0, e0) => applyOp(addEvent(events, s0, e0 ?? s0 + 2, ''))}
            onShiftAllFollowing={(id, t) => applyOp(shiftFollowing(events, id ?? activeId, t ?? getPlayhead()))}
            onUndo={canUndo ? undo : null}
            onRedo={canRedo ? redo : null}
            onDeleteEvent={(id) => applyOp(removeEvent(events, id))}
            onSplitAtTime={(t) => applyOp(splitAt(events, t, activeId))}
            onMergeWithNext={(id) => applyOp(mergeWithNext(events, id))}
            onPlayEvent={playEvent}
            frameRate={24}
            cpsLimit={CPS_WARN}
            cplLimit={42}
            theme="dark"
          />
        </div>
      </div>
    </div>
  );
}
