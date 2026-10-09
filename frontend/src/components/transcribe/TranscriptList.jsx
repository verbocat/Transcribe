import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Square, Scissors, Merge, Trash2, Plus, Search, AlertCircle, AlertTriangle, LocateFixed } from 'lucide-react';
import { usePlayheadSelector } from '../../utils/usePlayheadSelector';
import { speakerColor, formatStamp } from './speakerUtils';
import { translateLangName } from '../../data/languageCatalog';

const GENDERS = [
  { value: 'Male', short: 'M' },
  { value: 'Female', short: 'F' },
  { value: 'Unknown', short: '?' },
];

// Segment under the playhead (half-open [start, end)); segments are in time order
function findPlayingId(segments, t) {
  let lo = 0, hi = segments.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = segments[mid];
    if (t < s.start_time) hi = mid - 1;
    else if (t >= s.end_time) lo = mid + 1;
    else return s.segment_id;
  }
  return null;
}

function lowConfidenceWords(seg) {
  return (seg.words || []).filter((w) => w.confidence < 0.8);
}

function AutoText({ value, onChange }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const fit = () => { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; };
    fit();
    // The box also changes width (QC drawer opens, window resizes): re-wrap, or the last line is cut off
    if (typeof ResizeObserver === 'undefined') return undefined;
    let lastWidth = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth !== lastWidth) { lastWidth = el.clientWidth; fit(); }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={1}
      className="ts-text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Type exactly what is spoken"
      spellCheck={false}
      autoCorrect="off"
      autoCapitalize="off"
      data-gramm="false"
      aria-label="Transcript text"
    />
  );
}

function SegmentRow({ translated, only, seg, isLast, isActive, color, speakerNames, onActivate, onPlay, onStop, onField, onSplit, onMerge, onDelete }) {
  const errors = seg.qc_errors || [];
  const issue = errors.some((e) => e.severity === 'error') ? 'error' : errors.length ? 'warning' : undefined;
  const lowWords = lowConfidenceWords(seg);
  const badTime = seg.start_time >= seg.end_time;
  const duration = Math.max(0, seg.end_time - seg.start_time);

  return (
    <div
      id={`seg-row-${seg.segment_id}`}
      className="ts-row"
      data-active={isActive}
      data-issue={issue}
      onClick={() => onActivate(seg.segment_id)}
    >
      {/* Index + play */}
      <div className="ts-col-play">
        <button
          type="button"
          className="ts-playbtn"
          title="Play this line on loop"
          aria-label={`Play line ${seg.segment_id}`}
          onClick={(e) => { e.stopPropagation(); onPlay(seg); }}
        >
          <Play size={12} fill="currentColor" style={{ marginLeft: 1 }} />
        </button>
        <span className="ts-mono ts-idx">{seg.segment_id}</span>
      </div>

      {/* Time */}
      <div className="ts-col-time">
        <div className="flex items-center gap-1">
          <input
            type="number" step="0.05" min="0" className="ts-time" data-bad={badTime}
            value={Number(seg.start_time.toFixed(3))} aria-label="Start time in seconds"
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onField(seg.segment_id, 'start_time', parseFloat(e.target.value) || 0)}
          />
          <span style={{ color: 'var(--ts-faint)' }}>–</span>
          <input
            type="number" step="0.05" min="0" className="ts-time" data-bad={badTime}
            value={Number(seg.end_time.toFixed(3))} aria-label="End time in seconds"
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onField(seg.segment_id, 'end_time', parseFloat(e.target.value) || 0)}
          />
        </div>
        <span className="ts-mono ts-stamp" data-warn={badTime || duration > 20 || duration < 0.5}>
          {formatStamp(seg.start_time)} · {badTime ? 'invalid' : `${duration.toFixed(2)}s`}
        </span>
      </div>

      {/* Speaker + gender */}
      <div className="ts-col-speaker" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-1.5">
          <span className="ts-spkdot" style={{ background: color }} />
          <select
            className="ts-field ts-field-sm flex-1" value={seg.speaker}
            aria-label="Speaker"
            onChange={(e) => onField(seg.segment_id, 'speaker', e.target.value)}
          >
            {speakerNames.map((n) => <option key={n} value={n}>{n}</option>)}
            <option value={`Speaker ${speakerNames.length + 1}`}>+ New speaker</option>
          </select>
        </div>
        <div className="ts-seg" role="group" aria-label="Gender">
          {GENDERS.map((g) => (
            <button
              key={g.value} type="button" aria-pressed={seg.gender === g.value} title={g.value}
              onClick={() => onField(seg.segment_id, 'gender', g.value)}
            >
              {g.short}
            </button>
          ))}
        </div>
      </div>

      {/* Source and translation, aligned side by side (stacked when narrow) */}
      <div className="ts-col-text min-w-0" data-has-translation={translated != null && !only} onClick={(e) => e.stopPropagation()}>
        {only && translated != null
          ? <div className="ts-translation">{translated}</div>
          : <AutoText value={seg.transcript || ''} onChange={(v) => onField(seg.segment_id, 'transcript', v)} />}
        {!only && translated != null && <div className="ts-translation">{translated}</div>}
        {(lowWords.length > 0 || errors.length > 0) && (
          <div className="ts-chips">
            {lowWords.map((w, i) => (
              <button
                key={`w${i}`} type="button"
                className={`ts-chip ${w.confidence < 0.5 ? 'ts-chip-danger' : 'ts-chip-warn'}`}
                title="Low confidence. Click to hear this word."
                onClick={() => onPlay({ ...seg, start_time: w.start_time ?? seg.start_time, end_time: w.end_time ?? seg.end_time })}
              >
                {w.word} <span className="ts-mono">{Math.round(w.confidence * 100)}%</span>
              </button>
            ))}
            {errors.map((err, i) => (
              <span key={`e${i}`} className={`ts-chip ${err.severity === 'error' ? 'ts-chip-danger' : 'ts-chip-warn'}`}>
                {err.severity === 'error' ? <AlertCircle size={12} /> : <AlertTriangle size={12} />}
                {err.message}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="ts-actions">
        <button type="button" className="ts-btn ts-btn-ghost ts-btn-icon ts-btn-sm" title="Stop and return to start" aria-label="Stop" onClick={(e) => { e.stopPropagation(); onStop(seg); }}>
          <Square size={12} />
        </button>
        <button type="button" className="ts-btn ts-btn-ghost ts-btn-icon ts-btn-sm" title="Split this line" aria-label="Split" onClick={(e) => { e.stopPropagation(); onSplit(seg); }}>
          <Scissors size={13} />
        </button>
        {!isLast && (
          <button type="button" className="ts-btn ts-btn-ghost ts-btn-icon ts-btn-sm" title="Merge with next line" aria-label="Merge with next" onClick={(e) => { e.stopPropagation(); onMerge(seg); }}>
            <Merge size={13} />
          </button>
        )}
        <button type="button" className="ts-btn ts-btn-ghost ts-btn-icon ts-btn-sm" title="Delete this line" aria-label="Delete" onClick={(e) => { e.stopPropagation(); onDelete(seg); }}>
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

export default function TranscriptList({
  segments, roster, filterSpeaker, setFilterSpeaker,
  activeSegmentId, setActiveSegmentId, setSegments,
  onPlaySegment, onStopSegment, onLint, onSplit, onMerge, onAdd, onOpenSrtPreview,
  translation, viewMode, onViewMode, trackCodes = [], sourceLabel, onSelectTrack, onTranslateMore,
}) {
  const [query, setQuery] = useState('');
  const [issuesOnly, setIssuesOnly] = useState(false);
  const [minConf, setMinConf] = useState(0);

  const speakerNames = useMemo(() => roster.map((r) => r.name), [roster]);
  const colorOf = useMemo(() => Object.fromEntries(roster.map((r) => [r.name, r.color])), [roster]);

  const visible = useMemo(() => segments.filter((s) => {
    if (filterSpeaker && s.speaker !== filterSpeaker) return false;
    if (issuesOnly && !(s.qc_errors || []).length) return false;
    if (minConf > 0 && (s.confidence ?? 1) * 100 < minConf) return false;
    if (query) {
      const q = query.toLowerCase();
      if (!(s.transcript || '').toLowerCase().includes(q) && !(s.speaker || '').toLowerCase().includes(q)) return false;
    }
    return true;
  }), [segments, filterSpeaker, issuesOnly, minConf, query]);

  const [followPlayback, setFollowPlayback] = useState(true);
  const listRef = useRef(null);
  const clickedRef = useRef(false);

  // Which line is under the playhead; re-renders only when that changes, not every frame
  const playingId = usePlayheadSelector((t) => findPlayingId(segments, t), [segments]);

  const isEditingInList = () => {
    const el = document.activeElement;
    const tag = el?.tagName?.toLowerCase();
    return Boolean(el && listRef.current?.contains(el) && (tag === 'textarea' || tag === 'input'));
  };

  // Short hops glide, long jumps snap, so the list never trails behind the audio. `center` keeps the playing line
  // in the middle with the next ones visible; a line the user just clicked is only nudged into view.
  const scrollToId = useCallback((id, center = false) => {
    const box = listRef.current;
    const el = box?.querySelector(`#seg-row-${id}`);
    if (!el) return;
    const b = box.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    let delta;
    if (center) delta = (r.top + r.height / 2) - (b.top + b.height / 2);
    else if (r.top < b.top) delta = r.top - b.top;
    else if (r.bottom > b.bottom) delta = Math.min(r.bottom - b.bottom, r.top - b.top);
    else return;
    if (Math.abs(delta) < 2) return;
    box.scrollTo({ top: box.scrollTop + delta, behavior: Math.abs(delta) < b.height * 1.5 ? 'smooth' : 'auto' });
  }, []);

  // Playback selects the line under the playhead (unless the user is typing in the list)
  useEffect(() => {
    if (!followPlayback || playingId == null || playingId === activeSegmentId || isEditingInList()) return;
    setActiveSegmentId(playingId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playingId, followPlayback]);

  // Keep the active line in view, whether it was chosen from the waveform, by playback or by a click
  useEffect(() => {
    const clicked = clickedRef.current;
    clickedRef.current = false;
    if (activeSegmentId == null || isEditingInList()) return;
    const fromPlayback = !clicked && activeSegmentId === playingId;
    if (fromPlayback && !followPlayback) return;
    scrollToId(activeSegmentId, fromPlayback);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSegmentId, scrollToId]);

  // Alt+Up / Alt+Down step through lines and play them
  useEffect(() => {
    const onKey = (e) => {
      if (!e.altKey || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
      e.preventDefault();
      const i = segments.findIndex((s) => s.segment_id === activeSegmentId);
      const next = segments[i + (e.key === 'ArrowDown' ? 1 : -1)];
      if (next) { setActiveSegmentId(next.segment_id); onPlaySegment(next.start_time, next.end_time); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [segments, activeSegmentId, onPlaySegment, setActiveSegmentId]);

  const setField = (id, field, value) => {
    const updated = segments.map((s) => {
      if (s.segment_id !== id) return s;
      const next = { ...s, [field]: value };
      if (field === 'start_time' || field === 'end_time') {
        next.duration = Math.max(0, parseFloat((next.end_time - next.start_time).toFixed(3)));
        next.start_time_str = formatStamp(next.start_time);
        next.end_time_str = formatStamp(next.end_time);
      }
      return next;
    });
    setSegments(updated);
    onLint(updated);
  };

  const remove = (seg) => {
    const updated = segments.filter((s) => s.segment_id !== seg.segment_id).map((s, i) => ({ ...s, segment_id: i + 1 }));
    setSegments(updated);
    onLint(updated);
  };

  const issueCount = segments.filter((s) => (s.qc_errors || []).length).length;

  return (
    <section className="flex flex-col flex-1 min-h-0 min-w-0" aria-label="Transcript">
      <div className="flex flex-wrap items-center gap-2 px-4" style={{ minHeight: 48, borderBottom: '1px solid var(--ts-line)', background: 'var(--ts-panel)' }}>
        <div className="relative">
          <Search size={14} style={{ position: 'absolute', left: 10, top: 9, color: 'var(--ts-faint)' }} />
          <input
            className="ts-field" style={{ paddingLeft: 32, width: 220 }} placeholder="Search text or speaker"
            value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search transcript"
          />
        </div>
        <button
          type="button" className={`ts-btn ts-btn-sm ${issuesOnly ? 'ts-chip-danger' : ''}`}
          aria-pressed={issuesOnly} onClick={() => setIssuesOnly(!issuesOnly)}
        >
          Issues only <span className="ts-mono">{issueCount}</span>
        </button>
        <label className="flex items-center gap-2" style={{ color: 'var(--ts-muted)', fontSize: 12 }}>
          Min confidence
          <input type="range" min="0" max="95" step="5" value={minConf} onChange={(e) => setMinConf(Number(e.target.value))} style={{ accentColor: 'var(--ts-accent)', width: 90 }} />
          <span className="ts-mono" style={{ minWidth: 32 }}>{minConf ? `${minConf}%` : 'All'}</span>
        </label>
        {(trackCodes.length > 0 || onTranslateMore) && (
          <div className="flex items-center gap-1.5" role="group" aria-label="Language">
            <select
              className="ts-field ts-field-sm" aria-label="Language shown"
              value={translation ? translation.code : 'src'}
              onChange={(e) => { if (e.target.value === '__new') onTranslateMore?.(); else onSelectTrack(e.target.value === 'src' ? null : e.target.value); }}
            >
              <option value="src">Source{sourceLabel ? ` (${sourceLabel})` : ''}</option>
              {trackCodes.map((c) => <option key={c} value={c}>{translateLangName(c)}</option>)}
              <option value="__new">Translate to…</option>
            </select>
            {translation && (
              <div className="ts-seg" role="group" aria-label="List layout">
                <button type="button" aria-pressed={viewMode !== 'only'} onClick={() => onViewMode('side')}>Side by side</button>
                <button type="button" aria-pressed={viewMode === 'only'} onClick={() => onViewMode('only')}>Active only</button>
              </div>
            )}
          </div>
        )}
        {filterSpeaker && (
          <button type="button" className="ts-chip ts-chip-accent" onClick={() => setFilterSpeaker(null)}>
            Showing {filterSpeaker} · clear
          </button>
        )}
        <span className="flex-1" />
        <span style={{ color: 'var(--ts-muted)', fontSize: 12 }}>{visible.length} of {segments.length} lines</span>
        <button
          type="button" className={`ts-btn ts-btn-sm ${followPlayback ? 'ts-chip-accent' : ''}`} aria-pressed={followPlayback}
          title={followPlayback ? 'Selecting and scrolling with the audio (click to stop)' : 'Select and scroll the list with the audio'}
          onClick={() => setFollowPlayback((v) => !v)}
        >
          <LocateFixed size={13} /> Follow
        </button>
        <button type="button" className="ts-btn ts-btn-sm" onClick={onOpenSrtPreview}>SRT preview</button>
        <button type="button" className="ts-btn ts-btn-sm ts-btn-primary" onClick={() => onAdd(segments.length ? segments[segments.length - 1].end_time + 0.1 : 0)}>
          <Plus size={13} /> Add line
        </button>
      </div>

      <div ref={listRef} className="ts-list flex-1 overflow-y-auto">
        {visible.length === 0 ? (
          <p style={{ color: 'var(--ts-muted)', padding: 48, textAlign: 'center' }}>No lines match the current filters.</p>
        ) : (
          visible.map((seg) => (
            <SegmentRow
              key={seg.segment_id}
              seg={seg}
              translated={translation ? translation.byId.get(seg.segment_id) ?? null : null}
              only={viewMode === 'only' && Boolean(translation)}
              isLast={seg.segment_id === segments[segments.length - 1]?.segment_id}
              isActive={seg.segment_id === activeSegmentId}
              color={colorOf[seg.speaker] || speakerColor(seg.speaker)}
              speakerNames={speakerNames}
              onActivate={(id) => { clickedRef.current = true; setActiveSegmentId(id); }}
              onPlay={(s) => { setActiveSegmentId(seg.segment_id); onPlaySegment(s.start_time, s.end_time); }}
              onStop={(s) => onStopSegment(s.start_time)}
              onField={setField}
              onSplit={(s) => onSplit(s.segment_id, (s.start_time + s.end_time) / 2)}
              onMerge={(s) => onMerge(s.segment_id)}
              onDelete={remove}
            />
          ))
        )}
        <div style={{ height: 24 }} />
      </div>
    </section>
  );
}
