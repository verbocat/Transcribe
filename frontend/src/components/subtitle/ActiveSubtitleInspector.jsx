import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Play, Repeat, SkipBack, SkipForward, ChevronLeft, ChevronRight,
  Bold, Italic, Underline, Split, Merge, Trash2, Scissors,
  User, Check, AlertTriangle, AlertCircle, Sparkles, CornerDownLeft,
  Clock, Plus, Minus, Tag
} from 'lucide-react';

/**
 * Convert seconds to SMPTE timecode (HH:MM:SS:FF)
 */
function toSMPTE(seconds, fps = 24.0) {
  if (isNaN(seconds) || seconds == null) return "00:00:00:00";
  const totalFrames = Math.max(0, Math.round(seconds * fps));
  const f = totalFrames % Math.round(fps);
  const totalSeconds = Math.floor(totalFrames / Math.round(fps));
  const s = totalSeconds % 60;
  const m = Math.floor((totalSeconds / 60) % 60);
  const h = Math.floor(totalSeconds / 3600);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
}

/**
 * Parse SMPTE timecode (HH:MM:SS:FF or HH:MM:SS.mmm) to seconds
 */
function fromSMPTE(str, fps = 24.0) {
  if (!str) return 0;
  const parts = str.trim().split(/[:.]/);
  if (parts.length === 4) {
    const [h, m, s, f] = parts.map(Number);
    if (!isNaN(h) && !isNaN(m) && !isNaN(s) && !isNaN(f)) {
      return (h * 3600) + (m * 60) + s + (f / fps);
    }
  }
  if (parts.length === 3) {
    const [h, m, s] = parts.map(Number);
    if (!isNaN(h) && !isNaN(m) && !isNaN(s)) {
      return (h * 3600) + (m * 60) + s;
    }
  }
  const floatVal = parseFloat(str);
  return isNaN(floatVal) ? 0 : floatVal;
}

export default function ActiveSubtitleInspector({
  event,
  events = [],
  onUpdate = () => {},
  onPlay = () => {},
  onSeek = () => {},
  onSplit = () => {},
  onMerge = () => {},
  onDelete = () => {},
  onRebreak = () => {},
  onNavigatePrev = () => {},
  onNavigateNext = () => {},
  onRenameSpeaker = null,
  availableSpeakers = [],
  cplLimit = 42,
  cpsLimit = 20,
  frameRate = 24.0,
  theme = 'dark'
}) {
  const isDark = true;
  const textareaRef = useRef(null);

  // Local text state for responsive editing without parent re-render lag
  const [localText, setLocalText] = useState(event ? (event.text || '') : '');
  const [inTimeStr, setInTimeStr] = useState('');
  const [outTimeStr, setOutTimeStr] = useState('');

  // Speaker Menu State
  const [isSpeakerMenuOpen, setIsSpeakerMenuOpen] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [newSpeakerName, setNewSpeakerName] = useState('');
  const [renameAllEvents, setRenameAllEvents] = useState(true);

  const debounceTimerRef = useRef(null);
  const isFocusedRef = useRef(false);

  const eventId = event ? (event.id ?? event.event_id) : null;
  const startSec = event ? (event.start_time !== undefined ? event.start_time : (event.start !== undefined ? event.start : 0)) : 0;
  const endSec = event ? (event.end_time !== undefined ? event.end_time : (event.end !== undefined ? event.end : 0)) : 0;
  const durationSec = Math.max(0.01, endSec - startSec);
  const durationFrames = Math.round(durationSec * frameRate);

  // Sync state when active event changes
  useEffect(() => {
    if (event) {
      setLocalText(event.text || '');
      setInTimeStr(toSMPTE(startSec, frameRate));
      setOutTimeStr(toSMPTE(endSec, frameRate));
    } else {
      setLocalText('');
      setInTimeStr('');
      setOutTimeStr('');
    }
  }, [eventId, startSec, endSec, event?.text, frameRate]);

  // Clean debounce text commit
  const handleTextChange = (e) => {
    const val = e.target.value;
    setLocalText(val);
    if (!eventId) return;

    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      onUpdate(eventId, 'text', val);
    }, 180);
  };

  const handleBlurText = () => {
    isFocusedRef.current = false;
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    if (eventId && localText !== (event?.text || '')) {
      onUpdate(eventId, 'text', localText);
    }
  };

  // Nudge timing by frames (+/- 1 frame or +/- 5 frames)
  const handleNudgeIn = (frames) => {
    if (!eventId) return;
    const delta = frames / frameRate;
    const newStart = Math.max(0, Math.min(endSec - (1 / frameRate), startSec + delta));
    onUpdate(eventId, 'start_time', newStart);
    onUpdate(eventId, 'start', newStart);
    setInTimeStr(toSMPTE(newStart, frameRate));
    onSeek(newStart);
  };

  const handleNudgeOut = (frames) => {
    if (!eventId) return;
    const delta = frames / frameRate;
    const newEnd = Math.max(startSec + (1 / frameRate), endSec + delta);
    onUpdate(eventId, 'end_time', newEnd);
    onUpdate(eventId, 'end', newEnd);
    setOutTimeStr(toSMPTE(newEnd, frameRate));
  };

  const handleCommitInTime = () => {
    if (!eventId) return;
    const parsed = fromSMPTE(inTimeStr, frameRate);
    if (!isNaN(parsed) && parsed >= 0 && parsed < endSec) {
      onUpdate(eventId, 'start_time', parsed);
      onUpdate(eventId, 'start', parsed);
      onSeek(parsed);
    } else {
      setInTimeStr(toSMPTE(startSec, frameRate));
    }
  };

  const handleCommitOutTime = () => {
    if (!eventId) return;
    const parsed = fromSMPTE(outTimeStr, frameRate);
    if (!isNaN(parsed) && parsed > startSec) {
      onUpdate(eventId, 'end_time', parsed);
      onUpdate(eventId, 'end', parsed);
    } else {
      setOutTimeStr(toSMPTE(endSec, frameRate));
    }
  };

  // Calculations for CPL & CPS
  const lines = useMemo(() => {
    return (localText || '').split('\n');
  }, [localText]);

  const lineCpls = useMemo(() => {
    return lines.map(line => line.replace(/<[^>]+>/g, '').trim().length);
  }, [lines]);

  const maxCpl = Math.max(...lineCpls, 0);
  const totalChars = (localText || '').replace(/<[^>]+>/g, '').trim().length;
  const wordCount = (localText || '').trim() ? (localText || '').trim().split(/\s+/).length : 0;
  const cps = durationSec > 0 ? totalChars / durationSec : 0;

  const isOverCpl = maxCpl > cplLimit;
  const isOverCps = cps > cpsLimit;
  const isCpsWarning = !isOverCps && cps > (cpsLimit * 0.85);

  // Adjacent events calculation (Gaps to previous and next)
  const currentIndex = useMemo(() => {
    if (!eventId || !events) return -1;
    return events.findIndex(e => (e.id === eventId || e.event_id === eventId));
  }, [eventId, events]);

  const prevEvent = currentIndex > 0 ? events[currentIndex - 1] : null;
  const nextEvent = currentIndex >= 0 && currentIndex < events.length - 1 ? events[currentIndex + 1] : null;

  const gapPrevSec = prevEvent ? Math.max(0, startSec - (prevEvent.end_time ?? prevEvent.end ?? 0)) : null;
  const gapPrevFrames = gapPrevSec !== null ? Math.round(gapPrevSec * frameRate) : null;
  const isShotGapError = gapPrevFrames !== null && gapPrevFrames > 0 && gapPrevFrames < 2; // Netflix rule: min 2 frames gap

  const gapNextSec = nextEvent ? Math.max(0, (nextEvent.start_time ?? nextEvent.start ?? 0) - endSec) : null;
  const gapNextFrames = gapNextSec !== null ? Math.round(gapNextSec * frameRate) : null;

  // Insert tag helper (HTML formatting tags like <i>, <b>, <u>)
  const applyTag = (tag) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selText = localText.substring(start, end);

    let newText;
    if (selText) {
      newText = localText.substring(0, start) + `<${tag}>${selText}</${tag}>` + localText.substring(end);
    } else {
      newText = localText.substring(0, start) + `<${tag}></${tag}>` + localText.substring(end);
    }
    setLocalText(newText);
    onUpdate(eventId, 'text', newText);
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + tag.length + 2, end + tag.length + 2);
    }, 50);
  };

  // Insert dialogue dash (- )
  const insertDialogueDash = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const currentLineStart = localText.lastIndexOf('\n', start - 1) + 1;
    const beforeLine = localText.substring(0, currentLineStart);
    const lineAndAfter = localText.substring(currentLineStart);

    let newText;
    if (lineAndAfter.startsWith('- ')) {
      // Toggle off
      newText = beforeLine + lineAndAfter.substring(2);
    } else {
      // Toggle on
      newText = beforeLine + '- ' + lineAndAfter;
    }
    setLocalText(newText);
    onUpdate(eventId, 'text', newText);
  };

  // Insert music note (♪ )
  const insertMusicNote = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const newText = localText.substring(0, start) + '♪ ' + localText.substring(end);
    setLocalText(newText);
    onUpdate(eventId, 'text', newText);
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + 2, start + 2);
    }, 50);
  };

  // Split at cursor
  const handleSplitAtCursor = () => {
    if (!eventId || !onSplit) return;
    const textarea = textareaRef.current;
    const cursor = textarea ? textarea.selectionStart : Math.floor(localText.length / 2);
    onSplit(eventId, cursor);
  };

  const currentSpeaker = event?.speaker || (event?.speakers && event?.speakers[0]) || 'Speaker 1';
  const speakerOptions = useMemo(() => {
    const list = ['Speaker 1', 'Speaker 2', 'Speaker 3', 'Speaker 4'];
    (availableSpeakers || []).forEach(s => {
      if (s && !list.includes(s)) list.push(s);
    });
    if (event?.speaker && !list.includes(event.speaker)) {
      list.push(event.speaker);
    }
    return list;
  }, [availableSpeakers, event?.speaker]);

  if (!event) {
    return (
      <div className={`p-4 flex flex-col items-center justify-center text-center rounded-lg border h-[190px] select-none ${
        'bg-[var(--kt-s1)] border-[var(--kt-s4)] text-slate-400'
      }`}>
        <Sparkles className={`w-6 h-6 mb-2 opacity-40 text-[var(--kt-accent)]`} />
        <span className="text-xs font-bold text-slate-300">No Subtitle Selected</span>
        <span className="text-[11px] opacity-70 mt-0.5">Click any row in the spreadsheet or on the timeline waveform to inspect and edit.</span>
      </div>
    );
  }

  return (
    <div className={`flex flex-col rounded-lg border overflow-hidden shadow-xs shrink-0 select-none transition-colors ${
      'bg-[var(--kt-s1)] border-[var(--kt-s4)]'
    }`}>
      {/* ── Top Bar: Inspector Header & Quick Nav ── */}
      <div className={`px-3 py-1.5 border-b flex items-center justify-between text-xs transition-colors ${
        'bg-[var(--kt-s2)] border-[var(--kt-s4)] text-slate-300'
      }`}>
        {/* Left: Subtitle Index & Navigation */}
        <div className="flex items-center gap-2">
          <span className={`font-mono font-bold text-xs px-2 py-0.5 rounded border ${
            'bg-[var(--kt-accent)]/15 border-[var(--kt-accent)]/40 text-[var(--kt-accent)]'
          }`}>
            SUB #{eventId}
          </span>
          {currentIndex >= 0 && (
            <span className={`text-[10px] font-mono opacity-70 text-slate-400`}>
              ({currentIndex + 1} of {events.length})
            </span>
          )}

          {/* Prev / Next Event Jump */}
          <div className="flex items-center gap-0.5 ml-1">
            <button
              type="button"
              onClick={onNavigatePrev}
              disabled={currentIndex <= 0}
              className={`p-1 rounded border transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
                'bg-[var(--kt-s1)] border-[var(--kt-s4)] text-slate-300 hover:text-white hover:bg-[var(--kt-s3)]'
              }`}
              title="Previous Subtitle (Alt + Left)"
            >
              <ChevronLeft size={13} />
            </button>
            <button
              type="button"
              onClick={onNavigateNext}
              disabled={currentIndex >= events.length - 1}
              className={`p-1 rounded border transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
                'bg-[var(--kt-s1)] border-[var(--kt-s4)] text-slate-300 hover:text-white hover:bg-[var(--kt-s3)]'
              }`}
              title="Next Subtitle (Alt + Right)"
            >
              <ChevronRight size={13} />
            </button>
          </div>
        </div>

        {/* Center: Gap Telemetry */}
        <div className="hidden sm:flex items-center gap-3 text-[10px] font-mono">
          {gapPrevSec !== null && (
            <span className={`flex items-center gap-1 ${isShotGapError ? 'text-rose-400 font-bold' : ('text-slate-400')}`} title="Gap from previous subtitle (at least 2 frames required)">
              <span>Gap In:</span>
              <span className={`px-1 py-0.2 rounded border ${isShotGapError ? 'bg-rose-950/60 border-rose-500 text-rose-300' : ('bg-[var(--kt-s1)] border-[var(--kt-s4)]')}`}>
                {gapPrevSec.toFixed(3)}s ({gapPrevFrames}f)
              </span>
            </span>
          )}
          {gapNextSec !== null && (
            <span className={`flex items-center gap-1 text-slate-400`} title="Gap to next subtitle">
              <span>Gap Out:</span>
              <span className={`px-1 py-0.2 rounded border bg-[var(--kt-s1)] border-[var(--kt-s4)]`}>
                {gapNextSec.toFixed(3)}s ({gapNextFrames}f)
              </span>
            </span>
          )}
        </div>

        {/* Right: Play / Loop Quick Actions */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onPlay(eventId)}
            className={`px-2 py-0.5 rounded text-[11px] font-bold border transition-colors cursor-pointer flex items-center gap-1 ${
              'bg-[var(--kt-s1)] hover:bg-[var(--kt-s3)] border-[var(--kt-s4)] text-slate-200 hover:text-white'
            }`}
            title="Play Subtitle Range"
          >
            <Play size={10} className="fill-current text-[var(--kt-accent)]" />
            <span>Play</span>
          </button>
        </div>
      </div>

      {/* ── Timing & Reading Speed Row (OOONA Broadcast SMPTE Grid) ── */}
      <div className={`px-3 py-1.5 border-b flex items-center justify-between gap-3 text-xs flex-wrap ${
        'bg-[var(--kt-s1)] border-[var(--kt-s4)]'
      }`}>
        {/* Time In */}
        <div className="flex items-center gap-1">
          <span className={`text-[10px] font-bold uppercase tracking-wider text-slate-400`}>In:</span>
          <div className={`flex items-center rounded border overflow-hidden border-[var(--kt-s4)] bg-[var(--kt-s2)]`}>
            <button
              type="button"
              onClick={() => handleNudgeIn(-1)}
              className={`px-1 py-0.5 text-[10px] font-mono cursor-pointer transition-colors text-slate-400 hover:text-white hover:bg-[var(--kt-s4)]`}
              title="Nudge In 1 frame back"
            >
              -1f
            </button>
            <input
              type="text"
              value={inTimeStr}
              onChange={(e) => setInTimeStr(e.target.value)}
              onBlur={handleCommitInTime}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCommitInTime(); }}
              className={`w-24 text-center font-mono font-bold text-xs py-0.5 bg-transparent focus:outline-none text-emerald-400`}
            />
            <button
              type="button"
              onClick={() => handleNudgeIn(1)}
              className={`px-1 py-0.5 text-[10px] font-mono cursor-pointer transition-colors text-slate-400 hover:text-white hover:bg-[var(--kt-s4)]`}
              title="Nudge In 1 frame forward"
            >
              +1f
            </button>
          </div>
        </div>

        {/* Time Out */}
        <div className="flex items-center gap-1">
          <span className={`text-[10px] font-bold uppercase tracking-wider text-slate-400`}>Out:</span>
          <div className={`flex items-center rounded border overflow-hidden border-[var(--kt-s4)] bg-[var(--kt-s2)]`}>
            <button
              type="button"
              onClick={() => handleNudgeOut(-1)}
              className={`px-1 py-0.5 text-[10px] font-mono cursor-pointer transition-colors text-slate-400 hover:text-white hover:bg-[var(--kt-s4)]`}
              title="Nudge Out 1 frame back"
            >
              -1f
            </button>
            <input
              type="text"
              value={outTimeStr}
              onChange={(e) => setOutTimeStr(e.target.value)}
              onBlur={handleCommitOutTime}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCommitOutTime(); }}
              className={`w-24 text-center font-mono font-bold text-xs py-0.5 bg-transparent focus:outline-none text-rose-400`}
            />
            <button
              type="button"
              onClick={() => handleNudgeOut(1)}
              className={`px-1 py-0.5 text-[10px] font-mono cursor-pointer transition-colors text-slate-400 hover:text-white hover:bg-[var(--kt-s4)]`}
              title="Nudge Out 1 frame forward"
            >
              +1f
            </button>
          </div>
        </div>

        {/* Duration */}
        <div className="flex items-center gap-1.5 font-mono text-xs">
          <span className={`text-[10px] uppercase tracking-wider font-bold text-slate-400`}>Dur:</span>
          <span className={`font-bold px-1.5 py-0.5 rounded border ${
            durationSec < 0.833 || durationSec > 7.0
              ? 'bg-rose-950/60 border-rose-500 text-rose-300 font-bold'
              : ('bg-[var(--kt-s2)] border-[var(--kt-s4)] text-slate-200')
          }`}>
            {durationSec.toFixed(2)}s ({durationFrames}f)
          </span>
        </div>

        {/* Reading Speed (CPS) */}
        <div className="flex items-center gap-1.5 font-mono text-xs ml-auto">
          <span className={`text-[10px] uppercase tracking-wider font-bold text-slate-400`}>CPS:</span>
          <span className={`font-bold px-2 py-0.5 rounded border text-[11px] flex items-center gap-1 ${
            isOverCps
              ? 'bg-rose-950/60 border-rose-500 text-rose-300 shadow-[0_0_8px_rgba(244,63,94,0.3)]'
              : isCpsWarning
                ? 'bg-amber-950/60 border-amber-500 text-amber-300'
                : 'bg-emerald-950/50 border-emerald-500/40 text-emerald-400'
          }`}>
            <span>{cps.toFixed(1)}</span>
            <span className="opacity-50 text-[9px]">/ {cpsLimit}</span>
          </span>
        </div>
      </div>

      {/* ── Text Editing Ribbon (Bold, Italic, Dash, Note, Speaker, Rebreak) ── */}
      <div className={`px-3 py-1 border-b flex items-center justify-between gap-1 flex-wrap ${
        'bg-[var(--kt-s1)] border-[var(--kt-s4)]'
      }`}>
        {/* Left: Quick Formatting Buttons */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => applyTag('b')}
            className={`p-1 rounded text-xs font-bold transition-colors cursor-pointer border ${
              'bg-[var(--kt-s2)] hover:bg-[var(--kt-s3)] border-[var(--kt-s4)] text-slate-300 hover:text-white'
            }`}
            title="Bold <b> (Ctrl+B)"
          >
            <Bold size={12} />
          </button>
          <button
            type="button"
            onClick={() => applyTag('i')}
            className={`p-1 rounded text-xs font-bold transition-colors cursor-pointer border ${
              'bg-[var(--kt-s2)] hover:bg-[var(--kt-s3)] border-[var(--kt-s4)] text-slate-300 hover:text-white'
            }`}
            title="Italics <i> (Ctrl+I)"
          >
            <Italic size={12} />
          </button>
          <button
            type="button"
            onClick={() => applyTag('u')}
            className={`p-1 rounded text-xs font-bold transition-colors cursor-pointer border ${
              'bg-[var(--kt-s2)] hover:bg-[var(--kt-s3)] border-[var(--kt-s4)] text-slate-300 hover:text-white'
            }`}
            title="Underline <u>"
          >
            <Underline size={12} />
          </button>
          <button
            type="button"
            onClick={insertDialogueDash}
            className={`px-1.5 py-0.5 rounded text-[11px] font-bold font-mono transition-colors cursor-pointer border ${
              'bg-[var(--kt-s2)] hover:bg-[var(--kt-s3)] border-[var(--kt-s4)] text-slate-300 hover:text-white'
            }`}
            title="Toggle Dialogue Dash (- ) for 2-speaker lines"
          >
            - Dash
          </button>
          <button
            type="button"
            onClick={insertMusicNote}
            className={`px-1.5 py-0.5 rounded text-[11px] font-bold transition-colors cursor-pointer border ${
              'bg-[var(--kt-s2)] hover:bg-[var(--kt-s3)] border-[var(--kt-s4)] text-slate-300 hover:text-white'
            }`}
            title="Insert Music Note ♪"
          >
            ♪ Note
          </button>
        </div>

        {/* Center: Speaker Selector */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setIsSpeakerMenuOpen(!isSpeakerMenuOpen)}
            className={`px-2 py-0.5 rounded text-[11px] font-semibold border flex items-center gap-1.5 cursor-pointer transition-colors ${
              'bg-[var(--kt-s2)] hover:bg-[var(--kt-s3)] border-[var(--kt-s4)] text-emerald-400'
            }`}
          >
            <User size={11} />
            <span>{currentSpeaker}</span>
          </button>

          {isSpeakerMenuOpen && (
            <div className={`absolute left-0 mt-1 w-44 rounded-lg border shadow-xl p-1 z-50 ${
              'bg-[var(--kt-s2)] border-[var(--kt-s4)] text-slate-200'
            }`}>
              <div className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 opacity-60">Assign Speaker</div>
              {speakerOptions.map(spk => (
                <button
                  key={spk}
                  type="button"
                  onClick={() => {
                    onUpdate(eventId, 'speaker', spk);
                    onUpdate(eventId, 'speakers', [spk]);
                    setIsSpeakerMenuOpen(false);
                  }}
                  className={`w-full text-left px-2 py-1 rounded text-xs flex items-center justify-between cursor-pointer ${
                    currentSpeaker === spk
                      ? ('bg-[var(--kt-accent)]/20 text-[var(--kt-accent)] font-bold')
                      : ('hover:bg-[var(--kt-s3)]')
                  }`}
                >
                  <span>{spk}</span>
                  {currentSpeaker === spk && <Check size={11} />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right: Structural Actions (Rebreak, Split, Merge, Delete) */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onRebreak(eventId)}
            className={`px-2 py-0.5 rounded text-[11px] font-semibold border transition-colors cursor-pointer flex items-center gap-1 ${
              'bg-[var(--kt-s2)] hover:bg-[var(--kt-s3)] border-[var(--kt-s4)] text-slate-300 hover:text-white'
            }`}
            title="Auto-Break lines according to syntactic grammar"
          >
            <Sparkles size={11} className={"text-[var(--kt-accent)]"} />
            <span>Re-Break</span>
          </button>
          <button
            type="button"
            onClick={handleSplitAtCursor}
            className={`p-1 rounded text-xs transition-colors cursor-pointer border ${
              'bg-[var(--kt-s2)] hover:bg-[var(--kt-s3)] border-[var(--kt-s4)] text-slate-300 hover:text-white'
            }`}
            title="Split subtitle at cursor position"
          >
            <Scissors size={12} />
          </button>
          {currentIndex < events.length - 1 && (
            <button
              type="button"
              onClick={() => onMerge(eventId, events[currentIndex + 1].id ?? events[currentIndex + 1].event_id)}
              className={`p-1 rounded text-xs transition-colors cursor-pointer border ${
                'bg-[var(--kt-s2)] hover:bg-[var(--kt-s3)] border-[var(--kt-s4)] text-slate-300 hover:text-white'
              }`}
              title="Merge with next subtitle"
            >
              <Merge size={12} />
            </button>
          )}
          <button
            type="button"
            onClick={() => onDelete(eventId)}
            className={`p-1 rounded text-xs transition-colors cursor-pointer border text-rose-500 ${
              'bg-[var(--kt-s2)] hover:bg-rose-950/40 border-[var(--kt-s4)]'
            }`}
            title="Delete this subtitle"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* ── Main Textarea Body ── */}
      <div className="p-2.5 relative">
        <textarea
          ref={textareaRef}
          value={localText}
          onChange={handleTextChange}
          onFocus={() => { isFocusedRef.current = true; }}
          onBlur={handleBlurText}
          placeholder="Type subtitle dialogue..."
          rows={2}
          className={`w-full p-2 rounded text-sm font-sans resize-none transition-colors border focus:outline-none leading-relaxed ${
            'bg-[var(--kt-s0)] border-[var(--kt-s4)] text-white focus:border-[var(--kt-accent)] focus:ring-1 focus:ring-[var(--kt-accent)]/30'
          }`}
          style={{ minHeight: '60px' }}
        />
      </div>

      {/* ── Bottom Metrics Footer: Line Counters & CPL Limit ── */}
      <div className={`px-3 py-1 border-t flex items-center justify-between text-[11px] font-mono ${
        'bg-[var(--kt-s1)] border-[var(--kt-s4)] text-slate-400'
      }`}>
        {/* Line 1 & Line 2 CPL Counters */}
        <div className="flex items-center gap-3">
          {lines.map((line, idx) => {
            const count = lineCpls[idx] || 0;
            const over = count > cplLimit;
            return (
              <span
                key={idx}
                className={`flex items-center gap-1 font-semibold ${over ? 'text-rose-400 font-bold' : ('text-slate-300')}`}
              >
                <span>L{idx + 1}:</span>
                <span className={`px-1 py-0.2 rounded border ${
                  over
                    ? 'bg-rose-950/60 border-rose-500 text-rose-300'
                    : ('bg-[var(--kt-s2)] border-[var(--kt-s4)]')
                }`}>
                  {count}/{cplLimit}
                </span>
              </span>
            );
          })}
        </div>

        {/* Total chars & words */}
        <div className="flex items-center gap-2 opacity-80">
          <span>{totalChars} Chars</span>
          <span>·</span>
          <span>{wordCount} Words</span>
        </div>
      </div>
    </div>
  );
}
