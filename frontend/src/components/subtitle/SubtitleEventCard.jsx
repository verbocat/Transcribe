import React, { useState, useRef, useMemo, useEffect } from 'react';
import {
  Play, Trash2, Scissors, Merge,
  Italic, Clock, Sparkles, CornerDownLeft,
  Minus, Plus, ChevronUp, ChevronDown, AlertTriangle,
  User, Edit2, Check, X
} from 'lucide-react';

/**
 * Format seconds to SMPTE timecode (HH:MM:SS.mmm)
 */
function formatTime(secs) {
  if (secs == null || isNaN(secs)) return '00:00:00.000';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  const ms = Math.round((secs % 1) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

export function getSpeakerBadgeClasses(speaker = '') {
  const s = String(speaker).toLowerCase();
  if (s.includes('1') || s.includes('first')) {
    return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/25';
  }
  if (s.includes('2') || s.includes('second')) {
    return 'bg-purple-500/15 text-purple-400 border-purple-500/30 hover:bg-purple-500/25';
  }
  if (s.includes('3') || s.includes('third')) {
    return 'bg-amber-500/15 text-amber-400 border-amber-500/30 hover:bg-amber-500/25';
  }
  if (s.includes('4') || s.includes('fourth')) {
    return 'bg-rose-500/15 text-rose-400 border-rose-500/30 hover:bg-rose-500/25';
  }
  if (s.includes('dual')) {
    return 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30 hover:bg-indigo-500/25';
  }
  return 'bg-blue-500/15 text-blue-400 border-blue-500/30 hover:bg-blue-500/25';
}

export function getSpeakerDotClasses(speaker = '') {
  const s = String(speaker).toLowerCase();
  if (s.includes('1')) return 'bg-emerald-400';
  if (s.includes('2')) return 'bg-purple-400';
  if (s.includes('3')) return 'bg-amber-400';
  if (s.includes('4')) return 'bg-rose-400';
  return 'bg-blue-400';
}

function SubtitleEventCard({
  event,
  isActive = false,
  onActivate = () => {},
  onUpdate = () => {},
  onPlay = () => {},
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
  showMerge = true,
  onSeek = null,
  theme = 'dark'
}) {
  const isDark = true;
  const [localText, setLocalText] = useState(event.text || '');
  const textareaRef = useRef(null);
  const cardRef = useRef(null);
  const debounceTimerRef = useRef(null);
  const isFocusedRef = useRef(false);
  const nudgeStep = 1 / frameRate; // 1 frame (~0.042s)

  // Speaker Tag State
  const [isSpeakerMenuOpen, setIsSpeakerMenuOpen] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [newSpeakerName, setNewSpeakerName] = useState('');
  const [renameAllEvents, setRenameAllEvents] = useState(true);

  const currentSpeaker = event.speaker || (event.speakers && event.speakers[0]) || 'Speaker 1';

  const speakerOptions = useMemo(() => {
    const list = ['Speaker 1', 'Speaker 2', 'Speaker 3', 'Speaker 4'];
    (availableSpeakers || []).forEach(s => {
      if (s && !list.includes(s)) list.push(s);
    });
    if (event.speaker && !list.includes(event.speaker)) {
      list.push(event.speaker);
    }
    return list;
  }, [availableSpeakers, event.speaker]);

  const handleSelectSpeaker = (spk) => {
    onUpdate(event.id, 'speaker', spk);
    onUpdate(event.id, 'speakers', [spk]);
  };

  const handleSaveRename = () => {
    const clean = (newSpeakerName || '').trim();
    if (!clean) {
      setIsRenaming(false);
      return;
    }
    if (onRenameSpeaker) {
      onRenameSpeaker(event.id, currentSpeaker, clean, renameAllEvents);
    } else {
      handleSelectSpeaker(clean);
    }
    setIsRenaming(false);
    setIsSpeakerMenuOpen(false);
  };

  useEffect(() => {
    if (!isSpeakerMenuOpen) return;
    const handleOutsideClick = () => {
      setIsSpeakerMenuOpen(false);
      setIsRenaming(false);
    };
    window.addEventListener('click', handleOutsideClick);
    return () => window.removeEventListener('click', handleOutsideClick);
  }, [isSpeakerMenuOpen]);

  // Auto-scroll active card into view and auto-highlight textarea if newly created
  useEffect(() => {
    if (isActive && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    if (isActive && event.autoFocusText && textareaRef.current) {
      const timer = setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.select();
          try { event.autoFocusText = false; } catch (_) {}
        }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isActive, event.autoFocusText]);

  // Sync localText with incoming event updates when not actively typing
  useEffect(() => {
    if (!isFocusedRef.current) {
      setLocalText(event.text || '');
    }
  }, [event.text]);

  // Clean up debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const start = event.start_time !== undefined ? event.start_time : (event.start !== undefined ? event.start : 0);
  const end = event.end_time !== undefined ? event.end_time : (event.end !== undefined ? event.end : 0);
  const duration = Math.max(0.01, end - start);

  // Compute live character metrics
  const metrics = useMemo(() => {
    const text = localText || '';
    const lines = text.split('\n');
    let clean = text.replace(/<[^>]+>/g, '').replace(/♪/g, '').trim();
    const cleanLines = clean.split('\n').map(l => {
      let s = l.trim();
      if (s.startsWith('-')) s = s.slice(1).trim();
      return s;
    });
    clean = cleanLines.join(' ').replace(/\s+/g, ' ').trim();
    const charCount = clean.length;
    const cps = duration > 0 ? charCount / duration : 0;

    const lineCpl = lines.map(l => {
      let c = l.replace(/<[^>]+>/g, '').trim();
      if (c.startsWith('-')) c = c.slice(1).trim();
      return c.length;
    });

    const maxCpl = Math.max(...lineCpl, 0);
    const lineCount = lines.length;

    return {
      cps: Math.round(cps * 10) / 10,
      lineCpl,
      maxCpl,
      lineCount,
      charCount,
      duration: Math.round(duration * 100) / 100
    };
  }, [localText, duration]);

  const isOverCpl = metrics.maxCpl > cplLimit;
  const isOverCps = metrics.cps > cpsLimit;
  const isTooManyLines = metrics.lineCount > 2;
  const isShortDuration = duration < 0.833;
  const isLongDuration = duration > 7.0;

  // Filter out any cosmetic pyramid errors for Netflix compliance
  const qcErrors = useMemo(() => {
    return (event.qc_errors || event.errors || []).filter(err => {
      const rid = (err.rule_id || '').toUpperCase();
      const msg = (err.message || '').toLowerCase();
      return !rid.includes('PYRAMID') && !msg.includes('pyramid') && !msg.includes('bottom-heavy');
    });
  }, [event.qc_errors, event.errors]);

  // Handle immediate text typing with debounce to parent
  const handleTextChange = (e) => {
    const newText = e.target.value;
    setLocalText(newText);
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      onUpdate(event.id, 'text', newText);
      debounceTimerRef.current = null;
    }, 300);
  };

  // Immediate flush on blur so text is never lost
  const handleTextareaBlur = () => {
    isFocusedRef.current = false;
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (localText !== (event.text || '')) {
      onUpdate(event.id, 'text', localText);
    }
  };

  const handleTextareaFocus = () => {
    isFocusedRef.current = true;
    onActivate(event.id);
  };

  // Nudge timing
  const handleTimeNudge = (field, delta) => {
    const currentVal = field === 'start_time' ? start : end;
    const newVal = Math.max(0, Math.round((currentVal + delta) * 1000) / 1000);
    if (field === 'start_time' && newVal >= end - 0.1) return;
    if (field === 'end_time' && newVal <= start + 0.1) return;
    onUpdate(event.id, field, newVal);
  };

  // Toggle italics
  const toggleItalics = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const selStart = textarea.selectionStart;
    const selEnd = textarea.selectionEnd;
    const val = localText;

    let updated = val;
    if (selStart !== selEnd) {
      const selected = val.substring(selStart, selEnd);
      if (selected.startsWith('<i>') && selected.endsWith('</i>')) {
        updated = val.substring(0, selStart) + selected.slice(3, -4) + val.substring(selEnd);
      } else {
        updated = val.substring(0, selStart) + `<i>${selected}</i>` + val.substring(selEnd);
      }
    } else {
      if (val.includes('<i>') && val.includes('</i>')) {
        updated = val.replace(/<\/?i>/g, '');
      } else {
        updated = `<i>${val}</i>`;
      }
    }
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    setLocalText(updated);
    onUpdate(event.id, 'text', updated);
  };

  // Keydown handler (Ctrl+I for Italics)
  const handleTextareaKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') {
      e.preventDefault();
      toggleItalics();
    }
  };

  return (
    <div
      ref={cardRef}
      onClick={() => onActivate(event.id)}
      onDoubleClick={(e) => {
        const tag = e.target?.tagName?.toLowerCase();
        if (tag === 'textarea' || tag === 'input' || tag === 'button') return;
        e.stopPropagation();
        onActivate(event.id);
        const st = event.start_time !== undefined ? event.start_time : (event.start !== undefined ? event.start : 0);
        if (onSeek) {
          onSeek(st);
        } else {
          onPlay(event.id);
        }
      }}
      title="Double click to seek playhead to this subtitle"
      className={`group relative rounded-xl border transition-all duration-150 p-2.5 flex flex-col gap-2 cursor-pointer ${
        isActive 
          ? 'bg-[var(--kt-s2)] border-[var(--kt-accent)] shadow-[0_0_15px_rgba(var(--kt-accent-rgb),0.15)] ring-1 ring-[var(--kt-accent)]/50' 
          : 'bg-[var(--kt-s1)] border-[var(--kt-s4)] hover:border-[#383a4c] hover:bg-[var(--kt-s2)]'
      }`}
    >
      {/* Active Left Indicator Bar */}
      {isActive && (
        <div className="absolute left-0 top-3 bottom-3 w-1 bg-[var(--kt-accent)] rounded-r" />
      )}

      {/* Top Header Row: ID, Timecode Controls, Duration, QC Badges */}
      <div className="flex items-center justify-between gap-1.5 flex-wrap">
        
        {/* Left: ID + Timecode In/Out + Play */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Badge ID & Jumpers */}
          <div className="flex items-center gap-0.5">
            <span className={`px-2 py-0.5 rounded font-mono text-[11px] font-black ${
              isActive ? 'bg-[var(--kt-accent)] text-black shadow-xs' : 'bg-[var(--kt-s2)] border border-[var(--kt-s4)] text-slate-300'
            }`}>
              #{event.id}
            </span>
            {isActive && (
              <div className="flex items-center gap-0.5 ml-0.5">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onNavigatePrev();
                  }}
                  className="p-0.5 rounded border border-[var(--kt-s4)] bg-[var(--kt-s0)] text-slate-400 hover:text-white hover:border-[var(--kt-accent)] cursor-pointer transition-colors"
                  title="Previous Subtitle (Up Arrow)"
                >
                  <ChevronUp size={11} />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onNavigateNext();
                  }}
                  className="p-0.5 rounded border border-[var(--kt-s4)] bg-[var(--kt-s0)] text-slate-400 hover:text-white hover:border-[var(--kt-accent)] cursor-pointer transition-colors"
                  title="Next Subtitle (Down Arrow)"
                >
                  <ChevronDown size={11} />
                </button>
              </div>
            )}
          </div>

          {/* Speaker Badge with Quick Switch & Rename */}
          <div className="relative">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsSpeakerMenuOpen(!isSpeakerMenuOpen);
              }}
              className={`px-2 py-0.5 rounded font-medium text-[10.5px] border flex items-center gap-1 transition-all cursor-pointer ${getSpeakerBadgeClasses(currentSpeaker)}`}
              title="Click to change or rename speaker"
            >
              <User size={10} />
              <span className="font-bold">{currentSpeaker}</span>
            </button>

            {isSpeakerMenuOpen && (
              <div 
                onClick={(e) => e.stopPropagation()}
                className="absolute left-0 top-full mt-1 z-40 p-2 rounded-xl border shadow-2xl bg-[var(--kt-s1)] border-[var(--kt-s4)] text-slate-200 min-w-[190px] text-xs space-y-1.5 animate-in fade-in zoom-in-95 duration-100"
              >
                <div className="font-bold text-[10px] text-slate-400 uppercase tracking-wider px-1">
                  Assign Speaker
                </div>
                <div className="flex flex-col gap-0.5 max-h-40 overflow-y-auto">
                  {speakerOptions.map((spk) => (
                    <button
                      key={spk}
                      type="button"
                      onClick={() => {
                        handleSelectSpeaker(spk);
                        setIsSpeakerMenuOpen(false);
                      }}
                      className={`px-2 py-1 rounded-lg text-left text-xs font-medium flex items-center justify-between cursor-pointer transition-colors ${
                        spk === currentSpeaker 
                          ? 'bg-[var(--kt-accent)]/20 text-[var(--kt-accent)] font-bold' 
                          : 'hover:bg-[var(--kt-s3)] text-slate-300'
                      }`}
                    >
                      <span className="flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full ${getSpeakerDotClasses(spk)}`} />
                        {spk}
                      </span>
                      {spk === currentSpeaker && <Check size={12} />}
                    </button>
                  ))}
                </div>

                <div className="border-t border-[var(--kt-s4)] pt-1.5 mt-1">
                  {!isRenaming ? (
                    <button
                      type="button"
                      onClick={() => {
                        setNewSpeakerName(currentSpeaker);
                        setIsRenaming(true);
                      }}
                      className="w-full px-2 py-1 rounded-lg text-left text-[11px] text-slate-400 hover:text-white hover:bg-[var(--kt-s3)] flex items-center gap-1.5 cursor-pointer"
                    >
                      <Edit2 size={11} />
                      <span>Rename "{currentSpeaker}"...</span>
                    </button>
                  ) : (
                    <div className="space-y-1.5 p-1">
                      <input
                        type="text"
                        value={newSpeakerName}
                        onChange={(e) => setNewSpeakerName(e.target.value)}
                        placeholder="Enter speaker name"
                        className="w-full px-2 py-1 rounded bg-[var(--kt-s0)] border border-[var(--kt-s4)] text-xs text-white focus:outline-none focus:border-[var(--kt-accent)]"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveRename();
                          if (e.key === 'Escape') setIsRenaming(false);
                        }}
                      />
                      <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                        <input
                          type="checkbox"
                          id={`rename-all-${event.id}`}
                          checked={renameAllEvents}
                          onChange={(e) => setRenameAllEvents(e.target.checked)}
                          className="rounded accent-[var(--kt-accent)] w-3 h-3 cursor-pointer"
                        />
                        <label htmlFor={`rename-all-${event.id}`} className="cursor-pointer select-none">
                          Apply to all #{currentSpeaker}
                        </label>
                      </div>
                      <div className="flex items-center gap-1 justify-end pt-1">
                        <button
                          type="button"
                          onClick={() => setIsRenaming(false)}
                          className="px-2 py-0.5 rounded text-[10px] text-slate-400 hover:text-white cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={handleSaveRename}
                          className="px-2 py-0.5 rounded text-[10px] bg-[var(--kt-accent)] text-black font-bold hover:bg-[var(--kt-accent-strong)] cursor-pointer"
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Play / Seek Button */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPlay(event.id);
            }}
            className="p-1 rounded bg-[var(--kt-s2)] border border-[var(--kt-s4)] hover:bg-[var(--kt-accent)] hover:text-black text-slate-400 transition-colors cursor-pointer"
            title="Preview subtitle in player"
          >
            <Play className="w-3 h-3 fill-current" />
          </button>

          {/* Start Timecode with Frame Nudge */}
          <div className="flex items-center bg-[var(--kt-s0)] border border-[var(--kt-s4)] rounded px-1 py-0.5 text-[10px] font-mono text-[var(--kt-accent)]">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); handleTimeNudge('start_time', -nudgeStep); }}
              className="p-0.5 hover:text-white transition-colors cursor-pointer"
              title="-1 frame"
            >
              <Minus className="w-2.5 h-2.5" />
            </button>
            <span className="px-1">{formatTime(start)}</span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); handleTimeNudge('start_time', nudgeStep); }}
              className="p-0.5 hover:text-white transition-colors cursor-pointer"
              title="+1 frame"
            >
              <Plus className="w-2.5 h-2.5" />
            </button>
          </div>

          <span className="text-slate-500 text-[10px]">→</span>

          {/* End Timecode with Frame Nudge */}
          <div className="flex items-center bg-[var(--kt-s0)] border border-[var(--kt-s4)] rounded px-1 py-0.5 text-[10px] font-mono text-[var(--kt-accent)]">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); handleTimeNudge('end_time', -nudgeStep); }}
              className="p-0.5 hover:text-white transition-colors cursor-pointer"
              title="-1 frame"
            >
              <Minus className="w-2.5 h-2.5" />
            </button>
            <span className="px-1">{formatTime(end)}</span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); handleTimeNudge('end_time', nudgeStep); }}
              className="p-0.5 hover:text-white transition-colors cursor-pointer"
              title="+1 frame"
            >
              <Plus className="w-2.5 h-2.5" />
            </button>
          </div>

          {/* Duration Pill */}
          <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
            isShortDuration || isLongDuration 
              ? 'bg-rose-950/60 border-rose-800 text-rose-300' 
              : 'bg-[var(--kt-s0)] border-[var(--kt-s4)] text-slate-300'
          }`} title={isShortDuration ? "Duration below 0.833s" : isLongDuration ? "Duration exceeds 7.0s" : "Duration"}>
            {duration.toFixed(2)}s
          </span>
        </div>

        {/* Right: QC Metrics & Action Tools */}
        <div className="flex items-center gap-1.5">
          {/* CPL Pill */}
          <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${
            isOverCpl 
              ? 'bg-rose-950/80 border-rose-700 text-rose-300 animate-pulse' 
              : 'bg-[var(--kt-s0)] border-[var(--kt-s4)] text-slate-400'
          }`} title={`Max Characters Per Line: ${metrics.maxCpl}/${cplLimit}`}>
            {metrics.maxCpl} CPL
          </span>

          {/* CPS Pill */}
          <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${
            isOverCps 
              ? 'bg-rose-950/80 border-rose-700 text-rose-300' 
              : metrics.cps > cpsLimit - 2.5 
              ? 'bg-amber-950/80 border-amber-700 text-amber-300' 
              : 'bg-[var(--kt-s0)] border-[var(--kt-s4)] text-[var(--kt-accent)]'
          }`} title={`Reading Speed: ${metrics.cps} Characters Per Second (Limit: ${cpsLimit})`}>
            {metrics.cps} CPS
          </span>

          {/* Action Buttons Toolbar */}
          <div className="flex items-center gap-0.5 pl-1 border-l border-[var(--kt-s4)]">
            {/* Auto Rebreak Lines */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRebreak(event.id);
              }}
              className="p-1 rounded text-slate-400 hover:text-[var(--kt-accent)] hover:bg-[var(--kt-s2)] transition-colors cursor-pointer"
              title="Auto-balance lines (syntax rules)"
            >
              <CornerDownLeft className="w-3 h-3" />
            </button>

            {/* Split Subtitle */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSplit(event.id);
              }}
              className="p-1 rounded text-slate-400 hover:text-amber-400 hover:bg-[var(--kt-s2)] transition-colors cursor-pointer"
              title="Split subtitle into two events"
            >
              <Scissors className="w-3 h-3" />
            </button>

            {/* Merge with Next */}
            {showMerge && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onMerge(event.id);
                }}
                className="p-1 rounded text-slate-400 hover:text-blue-400 hover:bg-[var(--kt-s2)] transition-colors cursor-pointer"
                title="Merge with next subtitle"
              >
                <Merge className="w-3 h-3" />
              </button>
            )}

            {/* Italic */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleItalics();
              }}
              className={`p-1 rounded text-slate-400 hover:text-white hover:bg-[var(--kt-s2)] transition-colors cursor-pointer ${
                localText.includes('<i>') ? 'text-[var(--kt-accent)] bg-[var(--kt-accent)]/10' : ''
              }`}
              title="Toggle italics (<i>...</i>)"
            >
              <Italic className="w-3 h-3" />
            </button>

            {/* Delete */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(event.id);
              }}
              className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-rose-950/30 transition-colors cursor-pointer"
              title="Delete subtitle"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>

      {/* Inline Direct Editable Textarea */}
      <div className="relative">
        <textarea
          ref={textareaRef}
          value={localText}
          onChange={handleTextChange}
          onBlur={handleTextareaBlur}
          onFocus={handleTextareaFocus}
          onKeyDown={handleTextareaKeyDown}
          placeholder="Enter dialogue text (Ctrl+I for italics)..."
          rows={Math.max(2, metrics.lineCount)}
          className={`w-full bg-[var(--kt-s0)] border rounded-lg px-2.5 py-1.5 text-[13px] font-sans leading-relaxed resize-none focus:outline-none transition-all ${
            isActive 
              ? 'border-[var(--kt-accent)]/60 text-white focus:border-[var(--kt-accent)] focus:ring-1 focus:ring-[var(--kt-accent)]/30' 
              : 'border-[var(--kt-s4)] text-slate-200 hover:border-[#383a4c]'
          }`}
        />
        
        {/* Line metrics footer */}
        <div className="flex items-center justify-between text-[10px] text-slate-400 px-1 pt-0.5">
          <div className="flex items-center gap-2">
            {metrics.lineCpl.map((len, idx) => (
              <span key={idx} className={len > cplLimit ? 'text-rose-400 font-bold' : ''}>
                Line {idx + 1}: {len}/{cplLimit}
              </span>
            ))}
          </div>

          {/* Quick Auto-Fix Pill if violation */}
          {(isOverCpl || isOverCps || isTooManyLines || qcErrors.length > 0) && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRebreak(event.id);
              }}
              className="flex items-center gap-1 text-[10px] font-bold text-amber-400 hover:text-amber-300 bg-amber-950/60 border border-amber-700/60 rounded px-1.5 py-0.2 cursor-pointer transition-colors"
            >
              <Sparkles className="w-2.5 h-2.5" />
              <span>Auto-Fix</span>
            </button>
          )}
        </div>

        {/* Detailed QC Audit Flags Breakdown (Full Inspector parity) */}
        {isActive && qcErrors.length > 0 && (
          <div className="mt-2 p-2 rounded-lg bg-rose-950/40 border border-rose-800/60 text-rose-300 space-y-1">
            <div className="flex items-center justify-between text-[11px] font-bold">
              <span className="flex items-center gap-1 text-rose-300">
                <AlertTriangle size={12} className="text-rose-400" />
                <span>Guideline QC Violations ({qcErrors.length}):</span>
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRebreak(event.id);
                }}
                className="flex items-center gap-1 text-[10px] font-bold text-amber-300 hover:text-white bg-amber-950/80 border border-amber-600/50 rounded px-1.5 py-0.5 cursor-pointer transition-colors"
              >
                <Sparkles size={10} />
                <span>Auto-Fix</span>
              </button>
            </div>
            <div className="space-y-0.5 max-h-24 overflow-y-auto custom-scrollbar">
              {qcErrors.map((err, idx) => (
                <div key={idx} className="text-[10px] leading-tight text-rose-200">
                  • <span className="font-mono text-rose-400 font-semibold">{err.rule_id || 'QC'}:</span> {err.message}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Non-active warning summary */}
        {!isActive && qcErrors.length > 0 && (
          <div className="flex items-center gap-1 text-[10px] text-rose-400 font-medium px-1 mt-1 truncate">
            <AlertTriangle size={11} className="shrink-0 text-rose-400" />
            <span className="truncate">{qcErrors[0].message}</span>
            {qcErrors.length > 1 && <span className="text-slate-500 shrink-0">+{qcErrors.length - 1} more</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function arePropsEqual(prevProps, nextProps) {
  if (prevProps.isActive !== nextProps.isActive) return false;
  if (prevProps.cplLimit !== nextProps.cplLimit) return false;
  if (prevProps.cpsLimit !== nextProps.cpsLimit) return false;
  if (prevProps.frameRate !== nextProps.frameRate) return false;
  if (prevProps.showMerge !== nextProps.showMerge) return false;
  if (prevProps.theme !== nextProps.theme) return false;

  const pEv = prevProps.event;
  const nEv = nextProps.event;
  if (pEv === nEv) return true;
  if (pEv.id !== nEv.id) return false;
  if (pEv.text !== nEv.text) return false;
  if (pEv.start_time !== nEv.start_time || pEv.end_time !== nEv.end_time) return false;
  if (pEv.start !== nEv.start || pEv.end !== nEv.end) return false;

  const pErrors = pEv.qc_errors || pEv.errors || [];
  const nErrors = nEv.qc_errors || nEv.errors || [];
  if (pErrors.length !== nErrors.length) return false;

  return true;
}

export default React.memo(SubtitleEventCard, arePropsEqual);
