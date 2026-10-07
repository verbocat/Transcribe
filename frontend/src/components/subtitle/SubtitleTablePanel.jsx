import { Button } from './ui/controls';
import React, { useState, useMemo, useRef, useEffect, useCallback, memo } from 'react';
import {
  Search, Play, Trash2, AlertCircle, Plus, Download, ChevronUp, ChevronDown,
  Bold, Italic, Underline, Scissors, Merge, WrapText, User, LogIn, LogOut, Crosshair
} from 'lucide-react';
import { langName } from './languages';

function toSMPTE(seconds) {
  if (seconds === undefined || seconds === null || isNaN(seconds)) return '00:00:00.000';
  const totalMs = Math.round(seconds * 1000);
  const ms = totalMs % 1000;
  const totalSecs = Math.floor(totalMs / 1000);
  const s = totalSecs % 60;
  const m = Math.floor(totalSecs / 60) % 60;
  const h = Math.floor(totalSecs / 3600);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

// Accepts HH:MM:SS.mmm, MM:SS.mmm or plain seconds; returns null when unparseable
function parseSMPTE(str) {
  if (!str || !str.trim()) return null;
  const parts = str.trim().split(':').map(p => p.trim());
  if (parts.some(p => p === '' || isNaN(Number(p)))) return null;
  const nums = parts.map(Number);
  if (nums.length === 3) return nums[0] * 3600 + nums[1] * 60 + nums[2];
  if (nums.length === 2) return nums[0] * 60 + nums[1];
  if (nums.length === 1) return nums[0];
  return null;
}

const stripTags = (t) => (t || '').replace(/<[^>]+>/g, '');
const startOf = (ev) => ev.start_time ?? ev.start ?? 0;
const endOf = (ev) => ev.end_time ?? ev.end ?? 0;
const idOf = (ev) => ev.id ?? ev.event_id;

/**
 * Source-language text for each translated cue, so both can be read side by side.
 * Matched by subtitle id (translations keep the source cue's id); a cue added or split
 * since then falls back to the source cue it overlaps most in time.
 */
function buildSourceTextMap(events, sourceEvents) {
  const map = new Map();
  if (!sourceEvents?.length) return map;
  const byId = new Map(sourceEvents.map((s) => [idOf(s), s]));
  const sorted = [...sourceEvents].sort((a, b) => startOf(a) - startOf(b));
  let j = 0;
  events.forEach((ev) => {
    const id = idOf(ev);
    const same = byId.get(id);
    const s0 = startOf(ev), e0 = endOf(ev);
    if (same && Math.min(e0, endOf(same)) > Math.max(s0, startOf(same))) { map.set(id, same.text || ''); return; }
    while (j < sorted.length && endOf(sorted[j]) <= s0) j++;
    let best = null, bestOverlap = 0;
    for (let k = j; k < sorted.length && startOf(sorted[k]) < e0; k++) {
      const overlap = Math.min(e0, endOf(sorted[k])) - Math.max(s0, startOf(sorted[k]));
      if (overlap > bestOverlap) { bestOverlap = overlap; best = sorted[k]; }
    }
    map.set(id, best ? (best.text || '') : null);
  });
  return map;
}

const GRID = 'grid grid-cols-[28px_34px_100px_100px_52px_1fr_56px_52px]';

// Speaker → color strip for the left side and the timeline
const SPEAKER_STRIP_COLORS = ['#10b981', '#f59e0b', '#8b5cf6', '#3b82f6', '#ec4899', 'var(--kt-accent)'];

function getSpeakerColor(speaker, fallbackIdx = 0) {
  if (!speaker) return SPEAKER_STRIP_COLORS[fallbackIdx % SPEAKER_STRIP_COLORS.length];
  let hash = 0;
  for (let i = 0; i < speaker.length; i++) hash = speaker.charCodeAt(i) + ((hash << 5) - hash);
  return SPEAKER_STRIP_COLORS[Math.abs(hash) % SPEAKER_STRIP_COLORS.length];
}

function getEventMetrics(ev, cpsLimit, cplLimit, minDuration, maxDuration) {
  const start = startOf(ev);
  const end = endOf(ev);
  const dur = Math.max(0.01, end - start);
  const text = ev.text || '';
  const lineLengths = text.split('\n').map(l => stripTags(l).trim().length);
  const maxCpl = Math.max(...lineLengths, 0);
  const cps = stripTags(text).replace(/\n/g, ' ').trim().length / dur;
  const hasDurErr = dur < minDuration || dur > maxDuration;
  const hasCpsErr = cps > cpsLimit;
  const hasCplErr = maxCpl > cplLimit;
  return { start, end, dur, cps, lineLengths, hasDurErr, hasCpsErr, hasCplErr, hasError: hasDurErr || hasCpsErr || hasCplErr };
}

// Cue under the playhead (half-open [start, end)); events are in time order
function findPlayingId(events, t) {
  let lo = 0, hi = events.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const ev = events[mid];
    if (t < startOf(ev)) hi = mid - 1;
    else if (t >= endOf(ev)) lo = mid + 1;
    else return idOf(ev);
  }
  return null;
}

function CpsBadge({ cps, cpsLimit }) {
  const isOver = cps > cpsLimit;
  const isWarn = !isOver && cps > cpsLimit * 0.85;
  const cls = isOver
    ? 'px-1.5 py-0.5 rounded-md bg-rose-500/20 border border-rose-500/30 text-rose-300 font-bold'
    : isWarn
      ? 'px-1.5 py-0.5 rounded-md bg-amber-500/20 border border-amber-500/30 text-amber-300 font-bold'
      : 'text-slate-400';
  return <span className={`inline-flex items-center font-mono text-[11px] ${cls}`}>{cps.toFixed(1)}</span>;
}

// Editable timecode: commits on Enter/blur, reverts on Escape or invalid input
function TimeInput({ value, onCommit, invalid, label }) {
  const [draft, setDraft] = useState(toSMPTE(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setDraft(toSMPTE(value)); }, [value, focused]);

  const commit = () => {
    const parsed = parseSMPTE(draft);
    if (parsed === null || !onCommit(parsed)) setDraft(toSMPTE(value));
  };

  return (
    <input
      type="text"
      aria-label={label}
      title={`${label} (type a time and press Enter)`}
      value={draft}
      onFocus={(e) => { setFocused(true); e.target.select(); }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { setFocused(false); commit(); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') { setDraft(toSMPTE(value)); e.currentTarget.blur(); }
      }}
      className={`w-[94px] -ml-1 bg-[var(--ss-raised)] border rounded-md px-1 py-0.5 font-mono text-[11px] tabular-nums focus:outline-none focus:border-[var(--ss-accent)] ${
        invalid ? 'border-rose-500/50 text-rose-300' : 'border-[var(--ss-line)] text-[var(--ss-accent)]'
      }`}
    />
  );
}

function ToolButton({ title, onClick, children, danger = false, disabled = false }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`h-6 min-w-6 px-1 inline-flex items-center justify-center gap-1 rounded-md border text-[10px] font-semibold transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
        danger
          ? 'border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20'
          : 'border-[var(--ss-line)] bg-[var(--ss-raised)] text-slate-300 hover:text-white hover:border-slate-500'
      }`}
    >
      {children}
    </button>
  );
}

function LangTag({ children, accent }) {
  return (
    <span className={`shrink-0 mt-[3px] px-1 rounded text-[9px] font-bold uppercase tracking-wider leading-[14px] border ${
      accent ? 'border-[var(--ss-accent)]/40 text-[var(--ss-accent)] bg-[var(--ss-accent)]/10' : 'border-[var(--ss-line)] text-[var(--ss-faint)] bg-[var(--ss-raised)]'
    }`}>
      {children}
    </span>
  );
}

/** One cue. Memoized: re-renders only when its own data or state flags change. */
const SubtitleRow = memo(function SubtitleRow({
  ev, pos, isActive, isPlaying, isSelected, prevEnd, nextStart,
  cpsLimit, cplLimit, minDuration, maxDuration, frameRate,
  currentTime, availableSpeakers, focusOnActivate, actions,
  sourceText, sourceLabel, targetLabel,
}) {
  const id = idOf(ev);
  const m = getEventMetrics(ev, cpsLimit, cplLimit, minDuration, maxDuration);
  const textareaRef = useRef(null);
  const frame = 1 / (frameRate || 24);

  // Focus the editor when this row was opened by clicking its text
  useEffect(() => {
    if (isActive && focusOnActivate.current && textareaRef.current) {
      focusOnActivate.current = false;
      const ta = textareaRef.current;
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }
  }, [isActive, focusOnActivate]);

  // A freshly added cue opens with its placeholder text selected, so typing replaces it
  const autoFocusedRef = useRef(false);
  useEffect(() => {
    if (isActive && ev.autoFocusText && !autoFocusedRef.current && textareaRef.current) {
      autoFocusedRef.current = true;
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [isActive, ev.autoFocusText]);

  // Auto-grow the editor with its content
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  }, [isActive, ev.text]);

  const wrapSelection = (tag) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const { selectionStart: s, selectionEnd: e, value } = ta;
    const next = `${value.slice(0, s)}<${tag}>${value.slice(s, e)}</${tag}>${value.slice(e)}`;
    actions.updateText(id, next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(s + tag.length + 2, e + tag.length + 2);
    });
  };

  const gapIn = prevEnd === null ? null : m.start - prevEnd;
  const gapOut = nextStart === null ? null : nextStart - m.end;
  const stripColor = isActive ? 'var(--ss-accent)' : isPlaying ? 'var(--ss-text)' : getSpeakerColor(ev.speaker, pos);

  return (
    <div
      data-event-id={id}
      className={`relative border-b border-[var(--ss-line-soft)] ${
        isActive ? 'bg-[var(--ss-selected)]' : isPlaying ? 'bg-white/[0.045]' : 'hover:bg-[var(--ss-raised)]'
      }`}
    >
      <div className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ backgroundColor: stripColor, opacity: isActive || isPlaying ? 1 : 0.7 }} />

      <div
        onClick={() => actions.activate(id, m.start, false)}
        className={`${GRID} items-start px-2 py-2 text-xs cursor-pointer group`}
      >
        <div className="flex items-center justify-center pl-1 pt-1" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => actions.toggleSelect(id)}
            className="cursor-pointer rounded accent-[var(--ss-accent)] w-3 h-3"
            aria-label={`Select subtitle ${pos + 1}`}
          />
        </div>

        <div className={`text-center font-mono text-[11px] pt-0.5 ${isPlaying ? 'text-[var(--ss-text)] font-semibold' : 'text-slate-500'}`}>
          {pos + 1}
        </div>

        {isActive ? (
          <div onClick={(e) => e.stopPropagation()}>
            <TimeInput
              label="Start time"
              value={m.start}
              invalid={m.hasDurErr}
              onCommit={(s) => { if (s < 0 || s >= m.end) return false; actions.timeChange(id, s, m.end); return true; }}
            />
          </div>
        ) : (
          <div className="font-mono text-[11px] tabular-nums pt-0.5 text-slate-300">{toSMPTE(m.start)}</div>
        )}

        {isActive ? (
          <div onClick={(e) => e.stopPropagation()}>
            <TimeInput
              label="End time"
              value={m.end}
              invalid={m.hasDurErr}
              onCommit={(e) => { if (e <= m.start) return false; actions.timeChange(id, m.start, e); return true; }}
            />
          </div>
        ) : (
          <div className={`font-mono text-[11px] tabular-nums pt-0.5 ${m.hasDurErr ? 'text-rose-400' : 'text-slate-400'}`}>{toSMPTE(m.end)}</div>
        )}

        <div className={`font-mono text-[11px] tabular-nums pt-0.5 ${m.hasDurErr ? 'text-rose-400 font-bold' : 'text-slate-500'}`}>
          {m.dur.toFixed(2)}s
        </div>

        {/* Text: plain when idle, the editor itself when selected (never shown twice).
            While a translation is shown, the source-language text sits above it under the same timestamp. */}
        <div className="min-w-0">
        {sourceText !== undefined && (
          <div className="pr-2 mb-1 flex items-start gap-1.5" title={`${sourceLabel} (original)`}>
            <LangTag>{sourceLabel}</LangTag>
            <div className="min-w-0 ss-script text-[13px] leading-[1.45] whitespace-pre-wrap break-words text-[var(--ss-muted)]">
              {sourceText === null ? <span className="italic text-slate-600">No original subtitle at this time</span> : (stripTags(sourceText) || <span className="italic text-slate-600">Empty subtitle</span>)}
            </div>
          </div>
        )}
        <div className={sourceText !== undefined ? 'flex items-start gap-1.5' : ''}>
        {sourceText !== undefined && <LangTag accent>{targetLabel}</LangTag>}
        {isActive ? (
          <div className="pr-2 flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
            <textarea
              ref={textareaRef}
              rows={1}
              value={ev.text || ''}
              onChange={(e) => actions.updateText(id, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') e.currentTarget.blur();
                if ((e.ctrlKey || e.metaKey) && ['b', 'i', 'u'].includes(e.key.toLowerCase())) {
                  e.preventDefault();
                  wrapSelection(e.key.toLowerCase());
                }
              }}
              placeholder="Type subtitle text…"
              aria-label="Subtitle text"
              className="w-full -my-0.5 bg-[var(--ss-panel)] border border-[var(--ss-line)] focus:border-[var(--ss-accent)] rounded-md px-1.5 py-1 text-white ss-script text-[14px] leading-[1.45] focus:outline-none resize-none overflow-hidden font-medium placeholder-slate-500"
            />
          </div>
        ) : (
          <div
            onClick={(e) => { e.stopPropagation(); actions.activate(id, m.start, true); }}
            className={`pr-2 flex-1 min-w-0 ss-script text-[14px] leading-[1.45] whitespace-pre-wrap break-words cursor-text text-[var(--ss-text)] ${
              m.hasCplErr ? 'underline decoration-wavy decoration-rose-400/70 underline-offset-2' : ''
            }`}
            title="Click to edit"
          >
            {stripTags(ev.text) || <span className="italic text-slate-600">Empty subtitle</span>}
          </div>
        )}
        </div>
        </div>

        <div className="flex items-start justify-end pr-1 pt-0.5">
          <CpsBadge cps={m.cps} cpsLimit={cpsLimit} />
        </div>

        <div className={`flex items-start justify-end gap-0.5 transition-opacity ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'}`}>
          <button
            type="button"
            title="Play this subtitle"
            aria-label="Play this subtitle"
            onClick={(e) => { e.stopPropagation(); actions.play(id); }}
            className="p-1 rounded text-slate-400 hover:text-[var(--ss-accent)] hover:bg-white/5 cursor-pointer"
          >
            <Play size={12} />
          </button>
          <button
            type="button"
            title="Delete this subtitle"
            aria-label="Delete this subtitle"
            onClick={(e) => { e.stopPropagation(); actions.remove(id); }}
            className="p-1 rounded text-slate-400 hover:text-rose-300 hover:bg-white/5 cursor-pointer"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {isActive && (
        <div className="pl-[62px] pr-3 pb-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[10px]" onClick={(e) => e.stopPropagation()}>
          {/* Timing */}
          <span className="text-slate-500 font-semibold">In</span>
          <ToolButton title="Start −1 frame" onClick={() => actions.timeChange(id, Math.max(0, m.start - frame), m.end)}><ChevronDown size={11} /></ToolButton>
          <ToolButton title="Start +1 frame" disabled={m.start + frame >= m.end} onClick={() => actions.timeChange(id, m.start + frame, m.end)}><ChevronUp size={11} /></ToolButton>
          <ToolButton title="Set start to playhead" disabled={currentTime >= m.end} onClick={() => actions.timeChange(id, currentTime, m.end)}><LogIn size={11} /></ToolButton>
          <span className="text-slate-500 font-semibold ml-1">Out</span>
          <ToolButton title="End −1 frame" disabled={m.end - frame <= m.start} onClick={() => actions.timeChange(id, m.start, m.end - frame)}><ChevronDown size={11} /></ToolButton>
          <ToolButton title="End +1 frame" onClick={() => actions.timeChange(id, m.start, m.end + frame)}><ChevronUp size={11} /></ToolButton>
          <ToolButton title="Set end to playhead" disabled={currentTime <= m.start} onClick={() => actions.timeChange(id, m.start, currentTime)}><LogOut size={11} /></ToolButton>

          <span className="font-mono text-slate-500 ml-1">
            gap in <span className={gapIn !== null && gapIn < 0 ? 'text-rose-400' : 'text-slate-300'}>{gapIn === null ? '—' : `${gapIn.toFixed(2)}s`}</span>
            {' · '}out <span className={gapOut !== null && gapOut < 0 ? 'text-rose-400' : 'text-slate-300'}>{gapOut === null ? '—' : `${gapOut.toFixed(2)}s`}</span>
          </span>
          <span className="font-mono flex gap-1.5">
            {m.lineLengths.map((len, i) => (
              <span key={i} className={len > cplLimit ? 'text-rose-400 font-bold' : 'text-slate-400'}>L{i + 1} {len}/{cplLimit}</span>
            ))}
          </span>

          <div className="basis-full h-0" />

          {/* Text & structure */}
          <ToolButton title="Bold (Ctrl+B)" onClick={() => wrapSelection('b')}><Bold size={11} /></ToolButton>
          <ToolButton title="Italic (Ctrl+I)" onClick={() => wrapSelection('i')}><Italic size={11} /></ToolButton>
          <ToolButton title="Underline (Ctrl+U)" onClick={() => wrapSelection('u')}><Underline size={11} /></ToolButton>
          <label className="h-6 inline-flex items-center gap-1 bg-[var(--ss-raised)] border border-[var(--ss-line)] rounded-md px-1.5 text-[11px] text-white" title="Speaker">
            <User size={11} className="text-emerald-400 shrink-0" />
            <select
              value={ev.speaker || availableSpeakers?.[0] || 'Speaker 1'}
              onChange={(e) => actions.update(id, { speaker: e.target.value })}
              className="bg-transparent text-[11px] text-white focus:outline-none cursor-pointer"
              aria-label="Speaker"
            >
              {(availableSpeakers || []).map(spk => (
                <option key={spk} value={spk} className="bg-[var(--ss-raised)] text-white">{spk}</option>
              ))}
            </select>
          </label>
          <ToolButton title="Split this subtitle in the middle" onClick={() => actions.split(id)}><Scissors size={11} /> Split</ToolButton>
          <ToolButton title="Merge with the next subtitle" disabled={nextStart === null} onClick={() => actions.merge(id)}><Merge size={11} /> Merge</ToolButton>
          <ToolButton title={`Re-break lines to fit ${cplLimit} characters`} onClick={() => actions.rebreak(id)}><WrapText size={11} /> Re-break</ToolButton>
        </div>
      )}
    </div>
  );
});

/**
 * Single subtitle list: every row shows its cue; the selected row becomes editable in place.
 * All edits go straight to the shared events state, so the video overlay and timeline update live.
 */
export default function SubtitleTablePanel({
  events = [],
  activeEventId = null,
  setActiveEventId = () => {},
  onSeek = () => {},
  onPlayEvent = () => {},
  onDeleteEvent = () => {},
  onBulkDelete = () => {},
  onUpdateEvent = () => {},
  onTimeChange = () => {},
  onSplitEvent = () => {},
  onMergeWithNext = () => {},
  onRebreakEvent = () => {},
  onAddSubtitle = () => {},
  onExport = () => {},
  currentTime = 0,
  availableSpeakers = ['Speaker 1', 'Speaker 2'],
  frameRate = 24.0,
  cplLimit = 42,
  cpsLimit = 20,
  minDuration = 0.833,
  maxDuration = 7.0,
  // Set while a translation is shown: the original-language cues and both language codes
  sourceEvents = null,
  sourceLang = null,
  targetLang = null,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [filterMode, setFilterMode] = useState('all'); // all | errors
  const [followPlayback, setFollowPlayback] = useState(true);
  const containerRef = useRef(null);
  const searchRef = useRef(null);
  const focusOnActivate = useRef(false);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Stable action object for the memoized rows; always calls the latest props
  const latest = useRef({});
  latest.current = { activeEventId, setActiveEventId, onSeek, onPlayEvent, onDeleteEvent, onUpdateEvent, onTimeChange, onSplitEvent, onMergeWithNext, onRebreakEvent };
  const actions = useMemo(() => ({
    activate: (id, start, focusText) => {
      const p = latest.current;
      if (id === p.activeEventId) return;
      focusOnActivate.current = focusText;
      p.setActiveEventId(id);
      p.onSeek(start);
    },
    toggleSelect: (id) => setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    }),
    update: (id, patch) => latest.current.onUpdateEvent(id, patch),
    updateText: (id, text) => latest.current.onUpdateEvent(id, { text, lines: text.split('\n') }),
    timeChange: (id, s, e) => latest.current.onTimeChange(id, Math.round(s * 1000) / 1000, Math.round(e * 1000) / 1000),
    play: (id) => { latest.current.setActiveEventId(id); latest.current.onPlayEvent(id); },
    remove: (id) => latest.current.onDeleteEvent(id),
    split: (id) => latest.current.onSplitEvent(id),
    merge: (id) => latest.current.onMergeWithNext(id),
    rebreak: (id) => latest.current.onRebreakEvent(id),
  }), []);

  const indexById = useMemo(() => {
    const map = new Map();
    events.forEach((ev, i) => map.set(idOf(ev), i));
    return map;
  }, [events]);

  const comparing = !!sourceEvents;
  const sourceTextById = useMemo(
    () => (comparing ? buildSourceTextMap(events, sourceEvents) : null),
    [comparing, events, sourceEvents]
  );

  const errorFlags = useMemo(
    () => events.map(ev => getEventMetrics(ev, cpsLimit, cplLimit, minDuration, maxDuration).hasError),
    [events, cpsLimit, cplLimit, minDuration, maxDuration]
  );
  const errorCount = useMemo(() => errorFlags.filter(Boolean).length, [errorFlags]);

  const filteredEvents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return events.filter((ev, i) => {
      if (q && !(ev.text || '').toLowerCase().includes(q)
        && !(sourceTextById?.get(idOf(ev)) || '').toLowerCase().includes(q)
        && String(i + 1) !== q) return false;
      if (filterMode === 'errors') return errorFlags[i];
      return true;
    });
  }, [events, searchQuery, filterMode, errorFlags, sourceTextById]);

  const playingId = useMemo(() => findPlayingId(events, currentTime), [events, currentTime]);

  // Drop selections for cues that no longer exist (after delete / renumber)
  useEffect(() => {
    setSelectedIds(prev => {
      if (prev.size === 0) return prev;
      const next = new Set([...prev].filter(id => indexById.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [indexById]);

  const allSelected = filteredEvents.length > 0 && filteredEvents.every(e => selectedIds.has(idOf(e)));
  const handleToggleSelectAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(filteredEvents.map(idOf)));
  };

  const isEditingInList = () => {
    const el = document.activeElement;
    if (!el || !containerRef.current?.contains(el)) return false;
    const tag = el.tagName?.toLowerCase();
    return tag === 'textarea' || tag === 'input' || tag === 'select';
  };

  const scrollToId = useCallback((id) => {
    const el = containerRef.current?.querySelector(`[data-event-id="${id}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, []);

  // Keep the selected cue visible
  useEffect(() => {
    if (activeEventId != null && !isEditingInList()) scrollToId(activeEventId);
  }, [activeEventId, scrollToId]);

  // Follow playback, unless the user is typing in the list
  useEffect(() => {
    if (followPlayback && playingId != null && playingId !== activeEventId && !isEditingInList()) scrollToId(playingId);
  }, [playingId, followPlayback, activeEventId, scrollToId]);

  return (
    <div className="flex-1 min-w-0 h-full flex flex-col bg-[var(--ss-panel)] overflow-hidden">
      {/* ── Header ── */}
      <div className="h-12 px-3 border-b border-[var(--ss-line)] flex items-center justify-between gap-2 shrink-0 bg-[var(--ss-panel)] select-none">
        <div className="flex items-center gap-2 shrink-0">
          <h2 className="text-sm font-bold text-white tracking-wide">Subtitles</h2>
          <span className="text-xs font-semibold text-slate-400 tabular-nums">({events.length})</span>
          {errorCount > 0 && (
            <button
              type="button"
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[11px] font-semibold cursor-pointer ${
                filterMode === 'errors' ? 'bg-rose-500/30 border-rose-400/60 text-rose-200' : 'bg-rose-500/20 border-rose-500/30 text-rose-300'
              }`}
              onClick={() => setFilterMode(prev => prev === 'errors' ? 'all' : 'errors')}
              title={filterMode === 'errors' ? 'Show all subtitles' : 'Show only subtitles with issues'}
            >
              <AlertCircle size={11} />
              {errorCount} {errorCount === 1 ? 'issue' : 'issues'}
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-1 justify-end min-w-0">
          <div className="relative flex-1 min-w-0 max-w-[220px]">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
            <input
              type="text"
              ref={searchRef}
              placeholder="Search text or #number (Ctrl+F)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { setSearchQuery(''); e.currentTarget.blur(); } }}
              className="w-full bg-[var(--ss-raised)] border border-[var(--ss-line)] rounded-lg pl-7 pr-2.5 py-1 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-[var(--ss-accent)]/60 transition-colors"
            />
          </div>

          <button
            type="button"
            onClick={() => setFollowPlayback(v => !v)}
            className={`p-1.5 rounded-lg border transition-colors cursor-pointer shrink-0 ${
              followPlayback ? 'bg-[var(--ss-accent)]/15 border-[var(--ss-accent)]/40 text-[var(--ss-accent)]' : 'bg-[var(--ss-raised)] border-[var(--ss-line)] text-slate-500 hover:text-slate-200'
            }`}
            title={followPlayback ? 'Following playback (click to stop scrolling with the video)' : 'Scroll the list with the video'}
          >
            <Crosshair size={12} />
          </button>

          {selectedIds.size > 0 && (
            <button
              type="button"
              onClick={() => {
                if (!window.confirm(`Delete ${selectedIds.size} selected subtitle${selectedIds.size > 1 ? 's' : ''}?`)) return;
                onBulkDelete([...selectedIds]);
                setSelectedIds(new Set());
              }}
              className="flex items-center gap-1 px-2 py-1 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 transition-colors cursor-pointer shrink-0 text-[11px] font-semibold"
              title={`Delete ${selectedIds.size} selected`}
            >
              <Trash2 size={12} /> {selectedIds.size}
            </button>
          )}

          <Button size="sm" icon={Plus} onClick={() => onAddSubtitle(currentTime)} title="Add a new subtitle at the playhead">
            Add
          </Button>
        </div>
      </div>

      {/* ── Column headers ── */}
      <div className={`${GRID} items-center px-2 py-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider border-b border-[var(--ss-line)] bg-[var(--ss-bg)] shrink-0 select-none`}>
        <div className="flex items-center justify-center">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={handleToggleSelectAll}
            className="cursor-pointer rounded accent-[var(--ss-accent)] w-3 h-3"
            title="Select all shown"
            aria-label="Select all shown"
          />
        </div>
        <div className="text-center">#</div>
        <div>Start</div>
        <div>End</div>
        <div>Dur</div>
        <div>{comparing ? `${langName(sourceLang)} original · ${langName(targetLang)} translation` : 'Text'}</div>
        <div className="text-right pr-1">CPS</div>
        <div />
      </div>

      {/* ── Rows ── */}
      <div ref={containerRef} className="flex-1 overflow-y-auto custom-scrollbar">
        {filteredEvents.length === 0 ? (
          <div className="h-48 flex flex-col items-center justify-center text-center p-6 select-none">
            <div className="w-10 h-10 rounded-xl bg-[var(--ss-raised)] border border-[var(--ss-line)] flex items-center justify-center mb-3">
              <Play size={16} className="text-slate-600 ml-0.5" />
            </div>
            <span className="text-xs font-semibold text-slate-300">
              {searchQuery || filterMode === 'errors' ? 'No matching subtitles' : 'No subtitles yet'}
            </span>
            <span className="text-[11px] text-slate-600 mt-1">
              {searchQuery || filterMode === 'errors' ? 'Try a different search or clear the issues filter' : 'Open a video and run AI Generate, or import an SRT/VTT file.'}
            </span>
          </div>
        ) : (
          filteredEvents.map((ev) => {
            const id = idOf(ev);
            const pos = indexById.get(id) ?? 0;
            const isActive = activeEventId === id;
            const prev = events[pos - 1];
            const next = events[pos + 1];
            return (
              <SubtitleRow
                key={id ?? pos}
                ev={ev}
                pos={pos}
                isActive={isActive}
                isPlaying={playingId === id}
                isSelected={selectedIds.has(id)}
                prevEnd={prev ? endOf(prev) : null}
                nextStart={next ? startOf(next) : null}
                cpsLimit={cpsLimit}
                cplLimit={cplLimit}
                minDuration={minDuration}
                maxDuration={maxDuration}
                frameRate={frameRate}
                currentTime={isActive ? currentTime : 0}
                availableSpeakers={isActive ? availableSpeakers : null}
                focusOnActivate={focusOnActivate}
                actions={actions}
                sourceText={comparing ? sourceTextById.get(id) : undefined}
                sourceLabel={sourceLang?.toUpperCase()}
                targetLabel={targetLang?.toUpperCase()}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
