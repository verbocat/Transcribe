import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Trash2, Plus, Sparkles, CheckSquare, Square, Search, X, Filter,
  AlertTriangle, ChevronUp, ChevronDown, Replace, Play, Table,
  Scissors, Merge, CornerDownLeft, Check, AlertCircle, ArrowUpDown,
  Clock, Bold, Italic, Underline, ChevronLeft, ChevronRight, Maximize2,
  Minimize2, Volume2, User, HelpCircle, GripHorizontal
} from 'lucide-react';

/**
 * Format seconds to SMPTE timecode (HH:MM:SS:FF)
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
 * Parse SMPTE timecode string to seconds
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

const ROW_HEIGHT = 34;
const OVERSCAN = 12;

function SubtitleGridView({
  events = [],
  activeEventId = null,
  setActiveEventId = () => {},
  onPlayEvent = () => {},
  onSeek = () => {},
  onBulkDelete = () => {},
  onUpdateEvent = () => {},
  onGlobalReplace = null,
  onSplitEvent = () => {},
  onMergeEvent = () => {},
  onDeleteEvent = () => {},
  onRebreakEvent = () => {},
  onAddSubtitle = () => {},
  onJumpNextIssue = null,
  onRenameSpeaker = null,
  availableSpeakers = [],
  cplLimit = 42,
  cpsLimit = 20,
  frameRate = 24.0,
  theme = 'dark',
}) {
  const isDark = true;

  // ── OOONA Workspace Layout State ──
  const [editorHeight, setEditorHeight] = useState(200); // Height of Active Subtitle Box
  const [isEditorCollapsed, setIsEditorCollapsed] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [filterMode, setFilterMode] = useState('all'); // 'all' | 'errors' | 'warnings'
  const [searchQuery, setSearchQuery] = useState('');

  // ── Global Find & Replace State ──
  const [isFindOpen, setIsFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [replaceQuery, setReplaceQuery] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [currentMatchIdx, setCurrentMatchIdx] = useState(0);
  const findInputRef = useRef(null);

  // ── Active Subtitle Editor State ──
  const textareaRef = useRef(null);
  const [localText, setLocalText] = useState('');
  const [editingInTime, setEditingInTime] = useState(false);
  const [inTimeInput, setInTimeInput] = useState('');
  const [editingOutTime, setEditingOutTime] = useState(false);
  const [outTimeInput, setOutTimeInput] = useState('');
  const [isSpeakerMenuOpen, setIsSpeakerMenuOpen] = useState(false);

  // Active event object lookup
  const activeIndex = useMemo(() => {
    if (!activeEventId || !events) return -1;
    return events.findIndex(e => (e.id === activeEventId || e.event_id === activeEventId));
  }, [activeEventId, events]);

  const activeEvent = useMemo(() => {
    if (activeIndex === -1) return events[0] || null;
    return events[activeIndex] || null;
  }, [activeIndex, events]);

  // Sync local text when activeEvent changes
  useEffect(() => {
    if (activeEvent) {
      setLocalText(activeEvent.text || '');
      const s = activeEvent.start_time ?? activeEvent.start ?? 0;
      const e = activeEvent.end_time ?? activeEvent.end ?? 0;
      setInTimeInput(toSMPTE(s, frameRate));
      setOutTimeInput(toSMPTE(e, frameRate));
    } else {
      setLocalText('');
      setInTimeInput('00:00:00:00');
      setOutTimeInput('00:00:00:00');
    }
  }, [activeEvent?.id, activeEvent?.event_id, activeEvent?.text, activeEvent?.start_time, activeEvent?.end_time, frameRate]);

  // Debounced text commit to parent
  const debounceTimerRef = useRef(null);
  const handleTextChange = (e) => {
    const newText = e.target.value;
    setLocalText(newText);
    if (!activeEvent) return;
    const curId = activeEvent.id ?? activeEvent.event_id;
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      onUpdateEvent(curId, 'text', newText);
    }, 200);
  };

  // Immediate blur commit
  const handleTextBlur = () => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    if (activeEvent) {
      const curId = activeEvent.id ?? activeEvent.event_id;
      onUpdateEvent(curId, 'text', localText);
    }
  };

  // Timing Calculations for Active Subtitle
  const activeStart = activeEvent ? (activeEvent.start_time ?? activeEvent.start ?? 0) : 0;
  const activeEnd = activeEvent ? (activeEvent.end_time ?? activeEvent.end ?? 0) : 0;
  const activeDur = Math.max(0.01, activeEnd - activeStart);
  const activeTextClean = (localText || '').replace(/<[^>]+>/g, '').trim();
  const activeCps = activeDur > 0 ? (activeTextClean.length / activeDur) : 0;

  // Active Subtitle Line lengths & CPL
  const activeLines = (localText || '').split('\n');
  const activeLineStats = useMemo(() => {
    return activeLines.map((line, idx) => {
      const cleanLine = line.replace(/<[^>]+>/g, '').trim();
      const count = cleanLine.length;
      const isOver = count > cplLimit;
      return { lineIdx: idx + 1, count, isOver, text: line };
    });
  }, [activeLines, cplLimit]);

  // Active Subtitle Errors & Warnings
  const activeErrors = useMemo(() => {
    if (!activeEvent) return [];
    return (activeEvent.qc_errors || activeEvent.errors || []).filter(err => {
      const rid = (err.rule_id || '').toUpperCase();
      const msg = (err.message || '').toLowerCase();
      return !rid.includes('PYRAMID') && !msg.includes('pyramid');
    });
  }, [activeEvent]);

  // Frame Nudgers for In / Out
  const handleNudgeIn = (deltaFrames) => {
    if (!activeEvent) return;
    const curId = activeEvent.id ?? activeEvent.event_id;
    const newStart = Math.max(0, activeStart + (deltaFrames / frameRate));
    if (newStart < activeEnd - 0.05) {
      onUpdateEvent(curId, 'start_time', newStart);
    }
  };

  const handleNudgeOut = (deltaFrames) => {
    if (!activeEvent) return;
    const curId = activeEvent.id ?? activeEvent.event_id;
    const newEnd = Math.max(activeStart + 0.05, activeEnd + (deltaFrames / frameRate));
    onUpdateEvent(curId, 'end_time', newEnd);
  };

  // Commit direct timecode text entry
  const commitInTimeInput = () => {
    setEditingInTime(false);
    if (!activeEvent) return;
    const sec = fromSMPTE(inTimeInput, frameRate);
    if (!isNaN(sec) && sec >= 0 && sec < activeEnd) {
      onUpdateEvent(activeEvent.id ?? activeEvent.event_id, 'start_time', sec);
    } else {
      setInTimeInput(toSMPTE(activeStart, frameRate));
    }
  };

  const commitOutTimeInput = () => {
    setEditingOutTime(false);
    if (!activeEvent) return;
    const sec = fromSMPTE(outTimeInput, frameRate);
    if (!isNaN(sec) && sec > activeStart) {
      onUpdateEvent(activeEvent.id ?? activeEvent.event_id, 'end_time', sec);
    } else {
      setOutTimeInput(toSMPTE(activeEnd, frameRate));
    }
  };

  // Text formatting insertion (B, I, U, Dash, Music)
  const applyTagToSelection = (openTag, closeTag) => {
    const el = textareaRef.current;
    if (!el || !activeEvent) return;
    const selStart = el.selectionStart;
    const selEnd = el.selectionEnd;
    const current = localText;

    let updatedText;
    if (selStart !== selEnd) {
      const selected = current.substring(selStart, selEnd);
      updatedText = current.substring(0, selStart) + openTag + selected + closeTag + current.substring(selEnd);
    } else {
      updatedText = current.substring(0, selStart) + openTag + closeTag + current.substring(selEnd);
    }
    setLocalText(updatedText);
    onUpdateEvent(activeEvent.id ?? activeEvent.event_id, 'text', updatedText);
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(selStart + openTag.length, selEnd + openTag.length);
    }, 20);
  };

  const insertChar = (char) => {
    const el = textareaRef.current;
    if (!el || !activeEvent) return;
    const selStart = el.selectionStart;
    const selEnd = el.selectionEnd;
    const current = localText;
    const updatedText = current.substring(0, selStart) + char + current.substring(selEnd);
    setLocalText(updatedText);
    onUpdateEvent(activeEvent.id ?? activeEvent.event_id, 'text', updatedText);
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(selStart + char.length, selStart + char.length);
    }, 20);
  };

  // Navigation: Previous & Next Subtitle
  const handleNavigatePrev = () => {
    if (activeIndex > 0) {
      const prevEv = events[activeIndex - 1];
      const prevId = prevEv.id ?? prevEv.event_id;
      setActiveEventId(prevId);
      onSeek(prevEv.start_time ?? prevEv.start ?? 0);
    }
  };

  const handleNavigateNext = () => {
    if (activeIndex >= 0 && activeIndex < events.length - 1) {
      const nextEv = events[activeIndex + 1];
      const nextId = nextEv.id ?? nextEv.event_id;
      setActiveEventId(nextId);
      onSeek(nextEv.start_time ?? nextEv.start ?? 0);
    }
  };

  // Match Calculation across all events for Find & Replace
  const matches = useMemo(() => {
    if (!findQuery.trim()) return [];
    let flags = matchCase ? 'g' : 'gi';
    let pattern = findQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (wholeWord) pattern = `\\b${pattern}\\b`;
    let regex;
    try {
      regex = new RegExp(pattern, flags);
    } catch {
      return [];
    }
    const list = [];
    events.forEach(ev => {
      if (!ev.text) return;
      const evId = ev.id ?? ev.event_id;
      let m;
      while ((m = regex.exec(ev.text)) !== null) {
        list.push({
          eventId: evId,
          start: ev.start_time ?? ev.start ?? 0,
          index: m.index,
          matchText: m[0]
        });
        if (!regex.global) break;
      }
    });
    return list;
  }, [events, findQuery, matchCase, wholeWord]);

  // Keep match index within bounds
  useEffect(() => {
    if (currentMatchIdx >= matches.length) {
      setCurrentMatchIdx(Math.max(0, matches.length - 1));
    }
  }, [matches.length, currentMatchIdx]);

  const handleNextMatch = useCallback(() => {
    if (matches.length === 0) return;
    const nextIdx = (currentMatchIdx + 1) % matches.length;
    setCurrentMatchIdx(nextIdx);
    const target = matches[nextIdx];
    if (target) {
      setActiveEventId(target.eventId);
      if (onSeek) onSeek(target.start);
    }
  }, [matches, currentMatchIdx, setActiveEventId, onSeek]);

  const handlePrevMatch = useCallback(() => {
    if (matches.length === 0) return;
    const prevIdx = (currentMatchIdx - 1 + matches.length) % matches.length;
    setCurrentMatchIdx(prevIdx);
    const target = matches[prevIdx];
    if (target) {
      setActiveEventId(target.eventId);
      if (onSeek) onSeek(target.start);
    }
  }, [matches, currentMatchIdx, setActiveEventId, onSeek]);

  const handleReplaceCurrent = useCallback(() => {
    if (matches.length === 0 || !findQuery) return;
    const target = matches[currentMatchIdx];
    if (!target) return;
    if (onGlobalReplace) {
      onGlobalReplace(findQuery, replaceQuery, { matchCase, wholeWord, replaceAll: false, targetId: target.eventId });
    } else {
      const ev = events.find(e => (e.id === target.eventId || e.event_id === target.eventId));
      if (ev && ev.text) {
        let flags = matchCase ? '' : 'i';
        let pattern = findQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (wholeWord) pattern = `\\b${pattern}\\b`;
        const regex = new RegExp(pattern, flags);
        const newText = ev.text.replace(regex, replaceQuery);
        onUpdateEvent(target.eventId, 'text', newText);
      }
    }
  }, [matches, currentMatchIdx, findQuery, replaceQuery, matchCase, wholeWord, onGlobalReplace, onUpdateEvent, events]);

  const handleReplaceAll = useCallback(() => {
    if (!findQuery || matches.length === 0) return;
    if (onGlobalReplace) {
      onGlobalReplace(findQuery, replaceQuery, { matchCase, wholeWord, replaceAll: true });
    } else {
      let flags = matchCase ? 'g' : 'gi';
      let pattern = findQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (wholeWord) pattern = `\\b${pattern}\\b`;
      const regex = new RegExp(pattern, flags);
      events.forEach(ev => {
        if (ev.text && regex.test(ev.text)) {
          const newText = ev.text.replaceAll(regex, replaceQuery);
          onUpdateEvent(ev.id ?? ev.event_id, 'text', newText);
        }
      });
    }
  }, [findQuery, replaceQuery, matches.length, matchCase, wholeWord, onGlobalReplace, events, onUpdateEvent]);

  // Global Keyboard Shortcuts (Ctrl+F for Find, Arrow navigation, Alt+Up/Down)
  useEffect(() => {
    const handleGlobalKey = (e) => {
      const tag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setIsFindOpen(true);
        setTimeout(() => findInputRef.current?.select(), 50);
      } else if (e.key === 'Escape' && isFindOpen) {
        setIsFindOpen(false);
      } else if (e.altKey && e.key === 'ArrowUp') {
        e.preventDefault();
        handleNavigatePrev();
      } else if (e.altKey && e.key === 'ArrowDown') {
        e.preventDefault();
        handleNavigateNext();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && activeEvent) {
        e.preventDefault();
        onSplitEvent(activeEvent.id ?? activeEvent.event_id);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'm' && activeEvent) {
        e.preventDefault();
        onMergeEvent(activeEvent.id ?? activeEvent.event_id);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b' && activeEvent) {
        e.preventDefault();
        onRebreakEvent(activeEvent.id ?? activeEvent.event_id);
      }
    };

    window.addEventListener('keydown', handleGlobalKey);
    return () => window.removeEventListener('keydown', handleGlobalKey);
  }, [isFindOpen, activeIndex, events, activeEvent, onSplitEvent, onMergeEvent, onRebreakEvent]);

  // Filter events based on search and mode
  const filteredEvents = useMemo(() => {
    return events.filter(ev => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const textMatch = (ev.text || '').toLowerCase().includes(q);
        const idMatch = String(ev.id ?? ev.event_id).includes(q);
        if (!textMatch && !idMatch) return false;
      }

      if (filterMode === 'errors') {
        const errs = ev.qc_errors || ev.errors || [];
        const hasErr = errs.some(e => e.severity === 'error' || !e.severity);
        const text = ev.text || '';
        const lines = text.split('\n');
        const maxCpl = Math.max(...lines.map(l => l.replace(/<[^>]+>/g, '').trim().length), 0);
        return hasErr || maxCpl > cplLimit;
      }
      if (filterMode === 'warnings') {
        const dur = Math.max(0.01, (ev.end_time ?? ev.end ?? 0) - (ev.start_time ?? ev.start ?? 0));
        const cps = dur > 0 ? (ev.text || '').replace(/<[^>]+>/g, '').trim().length / dur : 0;
        return cps > cpsLimit;
      }
      return true;
    });
  }, [events, searchQuery, filterMode, cplLimit, cpsLimit]);

  // Statistics for Filter Tabs
  const errorCount = useMemo(() => {
    return events.filter(ev => {
      const errs = ev.qc_errors || ev.errors || [];
      const hasErr = errs.some(e => e.severity === 'error' || !e.severity);
      const text = ev.text || '';
      const lines = text.split('\n');
      const maxCpl = Math.max(...lines.map(l => l.replace(/<[^>]+>/g, '').trim().length), 0);
      return hasErr || maxCpl > cplLimit;
    }).length;
  }, [events, cplLimit]);

  const warningCount = useMemo(() => {
    return events.filter(ev => {
      const dur = Math.max(0.01, (ev.end_time ?? ev.end ?? 0) - (ev.start_time ?? ev.start ?? 0));
      const cps = dur > 0 ? (ev.text || '').replace(/<[^>]+>/g, '').trim().length / dur : 0;
      return cps > cpsLimit;
    }).length;
  }, [events, cpsLimit]);

  // Virtualized Scroll for Master Table
  const containerRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(500);

  const handleScroll = useCallback(() => {
    if (containerRef.current) {
      setScrollTop(containerRef.current.scrollTop);
    }
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        setViewportHeight(entry.contentRect.height);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const totalCount = filteredEvents.length;
  const totalHeight = totalCount * ROW_HEIGHT;
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const visibleCount = Math.ceil(viewportHeight / ROW_HEIGHT) + 2 * OVERSCAN;
  const endIndex = Math.min(totalCount, startIndex + visibleCount);
  const visibleEvents = filteredEvents.slice(startIndex, endIndex);
  const topPadding = startIndex * ROW_HEIGHT;

  // Auto-scroll table row into view when activeEventId changes
  useEffect(() => {
    if (!activeEventId || !containerRef.current) return;
    const idx = filteredEvents.findIndex(ev => (ev.id === activeEventId || ev.event_id === activeEventId));
    if (idx === -1) return;
    const targetTop = idx * ROW_HEIGHT;
    const currentScroll = containerRef.current.scrollTop;
    if (targetTop < currentScroll || targetTop > currentScroll + viewportHeight - ROW_HEIGHT * 2) {
      containerRef.current.scrollTo({
        top: Math.max(0, targetTop - viewportHeight / 2),
        behavior: 'smooth'
      });
    }
  }, [activeEventId, filteredEvents, viewportHeight]);

  // Multi-Select Handling
  const handleToggleSelect = (id, e) => {
    e.stopPropagation();
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleToggleSelectAll = () => {
    if (selectedIds.size === filteredEvents.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredEvents.map(e => e.id ?? e.event_id)));
    }
  };

  const handleDeleteSelected = () => {
    if (selectedIds.size === 0) return;
    onBulkDelete(Array.from(selectedIds));
    setSelectedIds(new Set());
  };

  // Resizer Splitter between Active Editor Box and Table
  const isResizingRef = useRef(false);
  const handleSplitterDown = (e) => {
    e.preventDefault();
    isResizingRef.current = true;
    const startY = e.clientY;
    const startH = editorHeight;

    const onMove = (moveEv) => {
      if (!isResizingRef.current) return;
      const delta = moveEv.clientY - startY;
      const newH = Math.min(380, Math.max(130, startH + delta));
      setEditorHeight(newH);
    };

    const onUp = () => {
      isResizingRef.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const allSelected = filteredEvents.length > 0 && selectedIds.size === filteredEvents.length;
  const someSelected = selectedIds.size > 0 && selectedIds.size < filteredEvents.length;

  return (
    <div className={`flex flex-col w-full h-full overflow-hidden select-none transition-colors ${
      'bg-[var(--kt-s0)] text-slate-200'
    }`}>

      {/* ── TOP REGION: OOONA Active Subtitle Spotting & Editing Box (Square, High-Contrast) ── */}
      {!isEditorCollapsed && (
        <div 
          style={{ height: `${editorHeight}px` }} 
          className="flex flex-col shrink-0 border-b border-[var(--kt-s4)] relative z-20 transition-all bg-[var(--kt-s1)] text-slate-100"
        >
          {/* Active Box Header Bar: Sub #, Navigation, Timing Steppers, Speed & Length Telemetry */}
          <div className="px-3 py-1.5 border-b border-[var(--kt-s4)] flex items-center justify-between gap-2 shrink-0 text-xs bg-[var(--kt-s2)] text-slate-200">
            {/* Left: Active ID, Jump Prev/Next, Play */}
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="font-mono text-[11px] font-black px-2.5 py-0.5 rounded-none bg-indigo-600 text-white shadow-xs">
                #{activeEvent ? (activeEvent.id ?? activeEvent.event_id) : '--'}
              </span>

              <span className="text-[11px] font-mono text-slate-400 font-bold">
                ({activeIndex >= 0 ? activeIndex + 1 : 0}/{events.length})
              </span>

              <div className="flex items-center border border-[var(--kt-s5)] rounded-none overflow-hidden bg-[var(--kt-s2)] ml-1">
                <button
                  type="button"
                  onClick={handleNavigatePrev}
                  disabled={activeIndex <= 0}
                  className="p-1 px-1.5 hover:bg-[var(--kt-s4)] text-slate-200 disabled:opacity-30 cursor-pointer transition-colors"
                  title="Previous Subtitle (Alt+Up)"
                >
                  <ChevronLeft size={13} />
                </button>
                <div className="w-px h-3 bg-[var(--kt-s5)]" />
                <button
                  type="button"
                  onClick={handleNavigateNext}
                  disabled={activeIndex >= events.length - 1}
                  className="p-1 px-1.5 hover:bg-[var(--kt-s4)] text-slate-200 disabled:opacity-30 cursor-pointer transition-colors"
                  title="Next Subtitle (Alt+Down)"
                >
                  <ChevronRight size={13} />
                </button>
              </div>

              <button
                type="button"
                onClick={() => activeEvent && onPlayEvent(activeEvent.id ?? activeEvent.event_id)}
                className="p-1 px-2.5 rounded-none bg-indigo-600/30 hover:bg-indigo-600 text-white border border-indigo-500/50 text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-colors ml-1"
                title="Play Active Subtitle"
              >
                <Play size={10} className="fill-current text-indigo-400 hover:text-white" />
                <span>Play</span>
              </button>

              {/* Speaker Tag Pill - Square */}
              <div className="relative ml-1">
                <button
                  type="button"
                  onClick={() => setIsSpeakerMenuOpen(!isSpeakerMenuOpen)}
                  className="px-2 py-0.5 rounded-none text-[11px] font-bold border border-[var(--kt-s5)] bg-[var(--kt-s2)] text-emerald-300 hover:bg-[var(--kt-s4)] hover:border-emerald-500/60 flex items-center gap-1 cursor-pointer transition-colors"
                  title="Click to change or rename speaker"
                >
                  <User size={11} className="text-emerald-400" />
                  <span className="truncate max-w-[85px]">{activeEvent?.speaker || 'Speaker 1'}</span>
                  <ChevronDown size={10} className="opacity-60" />
                </button>

                {isSpeakerMenuOpen && (
                  <div className="absolute top-full left-0 mt-1 w-44 rounded-none shadow-xl border border-[var(--kt-s5)] p-1 z-50 bg-[var(--kt-s2)] text-slate-200">
                    {['Speaker 1', 'Speaker 2', 'Speaker 3', 'Speaker 4', 'Narrator', 'Dual Speakers'].map(spk => (
                      <button
                        key={spk}
                        type="button"
                        onClick={() => {
                          if (activeEvent) onUpdateEvent(activeEvent.id ?? activeEvent.event_id, 'speaker', spk);
                          setIsSpeakerMenuOpen(false);
                        }}
                        className="w-full text-left px-2 py-1 rounded-none text-xs hover:bg-indigo-600 hover:text-white cursor-pointer transition-colors flex items-center justify-between font-bold"
                      >
                        <span>{spk}</span>
                        {activeEvent?.speaker === spk && <Check size={11} />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Center: In / Out Timing Steppers - Square High-Contrast */}
            <div className="flex items-center gap-2 font-mono text-[11px] shrink-0">
              {/* In Point */}
              <div className="flex items-center rounded-none border border-[var(--kt-s4)] bg-[var(--kt-s1)] px-2 py-0.5">
                <span className="text-[9px] uppercase font-black text-slate-400 mr-1.5">IN:</span>
                <button
                  type="button"
                  onClick={() => handleNudgeIn(-1)}
                  className="px-1 text-[10px] font-black text-slate-400 hover:text-blue-300 cursor-pointer"
                  title="Nudge In -1 Frame"
                >
                  -1f
                </button>
                {editingInTime ? (
                  <input
                    type="text"
                    value={inTimeInput}
                    onChange={(e) => setInTimeInput(e.target.value)}
                    onBlur={commitInTimeInput}
                    onKeyDown={(e) => e.key === 'Enter' && commitInTimeInput()}
                    autoFocus
                    className="w-20 bg-transparent text-emerald-400 font-bold focus:outline-none text-center"
                  />
                ) : (
                  <span
                    onClick={() => setEditingInTime(true)}
                    className="text-emerald-400 font-black px-1.5 cursor-pointer hover:underline tracking-wider"
                    title="Click to edit In timecode"
                  >
                    {toSMPTE(activeStart, frameRate)}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => handleNudgeIn(1)}
                  className="px-1 text-[10px] font-black text-slate-400 hover:text-blue-300 cursor-pointer"
                  title="Nudge In +1 Frame"
                >
                  +1f
                </button>
              </div>

              {/* Out Point */}
              <div className="flex items-center rounded-none border border-[var(--kt-s4)] bg-[var(--kt-s1)] px-2 py-0.5">
                <span className="text-[9px] uppercase font-black text-slate-400 mr-1.5">OUT:</span>
                <button
                  type="button"
                  onClick={() => handleNudgeOut(-1)}
                  className="px-1 text-[10px] font-black text-slate-400 hover:text-blue-300 cursor-pointer"
                  title="Nudge Out -1 Frame"
                >
                  -1f
                </button>
                {editingOutTime ? (
                  <input
                    type="text"
                    value={outTimeInput}
                    onChange={(e) => setOutTimeInput(e.target.value)}
                    onBlur={commitOutTimeInput}
                    onKeyDown={(e) => e.key === 'Enter' && commitOutTimeInput()}
                    autoFocus
                    className="w-20 bg-transparent text-rose-400 font-bold focus:outline-none text-center"
                  />
                ) : (
                  <span
                    onClick={() => setEditingOutTime(true)}
                    className="text-rose-400 font-black px-1.5 cursor-pointer hover:underline tracking-wider"
                    title="Click to edit Out timecode"
                  >
                    {toSMPTE(activeEnd, frameRate)}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => handleNudgeOut(1)}
                  className="px-1 text-[10px] font-black text-slate-400 hover:text-blue-300 cursor-pointer"
                  title="Nudge Out +1 Frame"
                >
                  +1f
                </button>
              </div>

              {/* Duration */}
              <span className={`px-2 py-0.5 rounded-none font-mono font-bold text-[10px] border ${
                activeDur < 0.833 || activeDur > 7.0
                  ? 'bg-rose-950/60 border-rose-500 text-rose-300'
                  : 'bg-[var(--kt-s2)] border-[var(--kt-s4)] text-slate-200'
              }`}>
                {activeDur.toFixed(2)}s ({Math.round(activeDur * frameRate)}f)
              </span>

              {/* CPS Speed Badge */}
              <span className={`px-2 py-0.5 rounded-none font-mono font-bold text-[10px] border ${
                activeCps > cpsLimit
                  ? 'bg-rose-950/70 border-rose-500 text-rose-200 shadow-xs'
                  : activeCps > cpsLimit * 0.85
                    ? 'bg-amber-950/60 border-amber-500 text-amber-200'
                    : 'bg-emerald-950/60 border-emerald-500/80 text-emerald-200'
              }`}>
                {activeCps.toFixed(1)} CPS
              </span>
            </div>

            {/* Right: Collapse Editor Toggle */}
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setIsEditorCollapsed(true)}
                className="p-1 rounded-none text-slate-400 hover:text-white hover:bg-white/10 cursor-pointer transition-colors"
                title="Collapse Editor to expand Grid Table"
              >
                <ChevronUp size={13} />
              </button>
            </div>
          </div>

          {/* Active Subtitle Main Editing Area: Large Textarea + Line Length Telemetry */}
          <div className="flex-1 min-h-0 flex px-3 py-2 gap-3 bg-[var(--kt-s0)]">
            {/* Left: Line Numbers & CPL Progress Meters */}
            <div className="flex flex-col gap-1.5 shrink-0 pt-1 font-mono text-[10px]">
              {activeLineStats.map((stat) => (
                <div key={stat.lineIdx} className="flex items-center gap-1.5 h-6">
                  <span className="text-slate-400 font-bold">L{stat.lineIdx}:</span>
                  <span className={`px-2 py-0.5 rounded-none font-black ${
                    stat.isOver 
                      ? 'bg-rose-950/80 text-rose-200 border border-rose-500' 
                      : 'bg-[var(--kt-s2)] border border-[var(--kt-s4)] text-slate-200'
                  }`}>
                    {stat.count}/{cplLimit}
                  </span>
                </div>
              ))}
            </div>

            {/* Center: High-Contrast Multiline Subtitle Text Editor */}
            <div className="flex-1 h-full flex flex-col relative">
              <textarea
                ref={textareaRef}
                value={localText}
                onChange={handleTextChange}
                onBlur={handleTextBlur}
                placeholder="Type or edit active subtitle dialogue here..."
                className="w-full flex-1 p-2.5 rounded-none text-sm font-sans leading-relaxed resize-none border border-[var(--kt-s4)] focus:border-indigo-400 bg-[var(--kt-s0)] text-white focus:outline-none transition-colors shadow-inner"
                style={{ fontFamily: 'Netflix Sans, Inter, Roboto, sans-serif' }}
              />
            </div>
          </div>

          {/* Active Box Bottom Action Ribbon: Formatting + Spotting Operations - Square */}
          <div className="px-3 py-1.5 border-t border-[var(--kt-s3)] flex items-center justify-between gap-2 shrink-0 text-xs bg-[var(--kt-s1)] text-slate-200">
            {/* Formatting Tools */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => applyTagToSelection('<b>', '</b>')}
                className="w-6 h-6 rounded-none border border-[var(--kt-s4)] bg-[var(--kt-s2)] hover:bg-[var(--kt-s4)] flex items-center justify-center font-bold text-xs text-white cursor-pointer transition-colors"
                title="Bold (<b>...</b>)"
              >
                <Bold size={11} />
              </button>
              <button
                type="button"
                onClick={() => applyTagToSelection('<i>', '</i>')}
                className="w-6 h-6 rounded-none border border-[var(--kt-s4)] bg-[var(--kt-s2)] hover:bg-[var(--kt-s4)] flex items-center justify-center italic text-xs text-white cursor-pointer transition-colors"
                title="Italic (<i>...</i>)"
              >
                <Italic size={11} />
              </button>
              <button
                type="button"
                onClick={() => applyTagToSelection('<u>', '</u>')}
                className="w-6 h-6 rounded-none border border-[var(--kt-s4)] bg-[var(--kt-s2)] hover:bg-[var(--kt-s4)] flex items-center justify-center underline text-xs text-white cursor-pointer transition-colors"
                title="Underline (<u>...</u>)"
              >
                <Underline size={11} />
              </button>
              <div className="w-px h-3.5 bg-[var(--kt-s4)] mx-0.5" />
              <button
                type="button"
                onClick={() => insertChar('- ')}
                className="px-2 h-6 rounded-none border border-[var(--kt-s4)] bg-[var(--kt-s2)] hover:bg-[var(--kt-s4)] flex items-center justify-center font-mono text-xs text-slate-200 hover:text-white cursor-pointer transition-colors"
                title="Insert Dual-Speaker Dialogue Dash (- )"
              >
                - Dash
              </button>
              <button
                type="button"
                onClick={() => insertChar('♪ ')}
                className="px-2 h-6 rounded-none border border-[var(--kt-s4)] bg-[var(--kt-s2)] hover:bg-[var(--kt-s4)] flex items-center justify-center text-xs text-slate-200 hover:text-white cursor-pointer transition-colors"
                title="Insert Music Note (♪ )"
              >
                ♪ Music
              </button>
            </div>

            {/* Quick Operations: Split, Merge, Re-break, Delete */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => activeEvent && onSplitEvent(activeEvent.id ?? activeEvent.event_id)}
                className="px-2 py-1 rounded-none text-[11px] font-bold border border-[var(--kt-s5)] bg-[var(--kt-s2)] hover:bg-[var(--kt-s4)] text-slate-200 hover:text-white cursor-pointer transition-colors flex items-center gap-1"
                title="Split subtitle at playhead position (Ctrl+K)"
              >
                <Scissors size={11} className="text-indigo-400" />
                <span>Split (Ctrl+K)</span>
              </button>

              <button
                type="button"
                onClick={() => activeEvent && onMergeEvent(activeEvent.id ?? activeEvent.event_id)}
                className="px-2 py-1 rounded-none text-[11px] font-bold border border-[var(--kt-s5)] bg-[var(--kt-s2)] hover:bg-[var(--kt-s4)] text-slate-200 hover:text-white cursor-pointer transition-colors flex items-center gap-1"
                title="Merge with following subtitle (Ctrl+M)"
              >
                <Merge size={11} className="text-indigo-400" />
                <span>Merge (Ctrl+M)</span>
              </button>

              <button
                type="button"
                onClick={() => activeEvent && onRebreakEvent(activeEvent.id ?? activeEvent.event_id)}
                className="px-2 py-1 rounded-none text-[11px] font-bold border border-indigo-500/50 bg-indigo-950/40 text-indigo-300 hover:bg-indigo-900/60 cursor-pointer transition-colors flex items-center gap-1"
                title="Auto-rebreak subtitle lines conforming to Netflix grammar (Ctrl+B)"
              >
                <Sparkles size={11} />
                <span>Auto-Break</span>
              </button>

              <button
                type="button"
                onClick={() => activeEvent && onDeleteEvent(activeEvent.id ?? activeEvent.event_id)}
                className="p-1 px-1.5 rounded-none text-rose-400 hover:bg-rose-950/40 border border-transparent hover:border-rose-500/40 cursor-pointer transition-colors"
                title="Delete this subtitle"
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>

          {/* Compact QC Warning Banner (Only if active subtitle has violations) */}
          {activeErrors.length > 0 && (
            <div className="px-3 py-1 bg-amber-950/80 border-t border-amber-600/40 flex items-center justify-between text-[11px] text-amber-200 shrink-0">
              <div className="flex items-center gap-1.5 truncate">
                <AlertTriangle size={12} className="text-amber-400 shrink-0" />
                <span className="font-semibold truncate">
                  {activeErrors[0].message || 'Subtitle exceeds Netflix reading speed limit.'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => activeEvent && onRebreakEvent(activeEvent.id ?? activeEvent.event_id)}
                className="px-2 py-0.5 rounded-none bg-amber-500 hover:bg-amber-400 text-black font-bold text-[10px] cursor-pointer shrink-0 transition-colors ml-2"
              >
                Auto-Fix
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── RESIZABLE SPLITTER (Between Active Editor Box and Master Table) ── */}
      {!isEditorCollapsed && (
        <div
          onMouseDown={handleSplitterDown}
          className="h-2 hover:h-2.5 hover:bg-indigo-500/40 bg-black/40 cursor-row-resize flex items-center justify-center transition-all group z-30 shrink-0 border-y border-white/5"
          title="Drag up/down to resize Active Editor vs Table"
        >
          <div className="w-12 h-0.5 bg-slate-600 group-hover:bg-indigo-400 transition-colors" />
        </div>
      )}

      {/* ── BOTTOM REGION: OOONA Master Subtitle Grid Table ── */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden relative">

        {/* Master Table Header Controls: Search, Filter Tabs, Add, and Find/Replace */}
        <div className={`px-3 py-1.5 border-b flex items-center justify-between gap-2 shrink-0 text-xs ${
          'bg-[var(--kt-s0)] border-[var(--kt-s4)]'
        }`}>
          {/* Left: Filter Tabs (All, Errors, Warnings) */}
          <div className="flex items-center gap-1">
            {isEditorCollapsed && (
              <button
                type="button"
                onClick={() => setIsEditorCollapsed(false)}
                className="px-2 py-1 rounded-none bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[10px] flex items-center gap-1 mr-1 cursor-pointer transition-colors shadow-xs"
                title="Restore Active Subtitle Editor Box"
              >
                <ChevronDown size={11} />
                <span>Show Editor</span>
              </button>
            )}

            <div className={`flex items-center rounded-none border p-0.5 ${
              'bg-[var(--kt-s0)] border-[var(--kt-s4)]'
            }`}>
              <button
                type="button"
                onClick={() => setFilterMode('all')}
                className={`px-2 py-0.5 rounded-none text-[11px] font-bold cursor-pointer transition-all ${
                  filterMode === 'all'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                All ({events.length})
              </button>
              <button
                type="button"
                onClick={() => setFilterMode('errors')}
                className={`px-2 py-0.5 rounded-none text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-all ${
                  filterMode === 'errors'
                    ? 'bg-rose-600 text-white shadow-xs'
                    : errorCount > 0 ? 'text-rose-400 hover:text-rose-300' : 'text-slate-400 hover:text-white'
                }`}
              >
                Errors ({errorCount})
              </button>
              <button
                type="button"
                onClick={() => setFilterMode('warnings')}
                className={`px-2 py-0.5 rounded-none text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-all ${
                  filterMode === 'warnings'
                    ? 'bg-amber-600 text-white shadow-xs'
                    : warningCount > 0 ? 'text-amber-400 hover:text-amber-300' : 'text-slate-400 hover:text-white'
                }`}
              >
                Warnings ({warningCount})
              </button>
            </div>
          </div>

          {/* Center: Search input */}
          <div className="flex items-center gap-1.5 flex-1 max-w-xs">
            <div className="relative flex-1">
              <Search className="w-3 h-3 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search dialogue or #ID..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className={`w-full pl-8 pr-6 py-0.5 rounded-none text-[11px] border focus:outline-none transition-colors ${
                  'bg-[var(--kt-s0)] border-[var(--kt-s4)] text-white focus:border-indigo-500 placeholder:text-slate-500'
                }`}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
                >
                  <X size={11} />
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                setIsFindOpen(prev => !prev);
                if (!isFindOpen) setTimeout(() => findInputRef.current?.focus(), 50);
              }}
              className={`px-2 py-1 rounded-none text-[10px] font-bold border transition-colors cursor-pointer flex items-center gap-1 ${
                isFindOpen
                  ? 'bg-indigo-600 text-white border-indigo-500'
                  : ('bg-[var(--kt-s2)] border-[var(--kt-s4)] text-slate-300 hover:text-white')
              }`}
              title="Find & Replace (Ctrl+F)"
            >
              <Replace size={11} />
              <span>Find</span>
            </button>
          </div>

          {/* Right: Add Sub & Bulk Delete */}
          <div className="flex items-center gap-1.5">
            {selectedIds.size > 0 ? (
              <button
                type="button"
                onClick={handleDeleteSelected}
                className="px-2 py-1 rounded-none bg-rose-600 hover:bg-rose-500 text-white font-bold text-[10px] flex items-center gap-1 cursor-pointer shadow-xs transition-colors"
              >
                <Trash2 size={11} />
                <span>Delete Selected ({selectedIds.size})</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onAddSubtitle}
                className={`px-2.5 py-1 rounded-none text-[11px] font-bold border flex items-center gap-1 cursor-pointer transition-colors ${
                  'bg-[var(--kt-s2)] hover:bg-[var(--kt-s4)] border-indigo-500/40 text-indigo-300 hover:text-white'
                }`}
                title="Add new subtitle at current video playhead"
              >
                <Plus size={11} className="text-indigo-400" />
                <span>+ Subtitle</span>
              </button>
            )}
          </div>
        </div>

        {/* Global Find & Replace Pop-down Bar */}
        {isFindOpen && (
          <div className={`p-2 border-b flex flex-col gap-1.5 shrink-0 z-30 ${
            'bg-[var(--kt-s2)] border-indigo-500/40 text-slate-200'
          }`}>
            <div className="flex items-center gap-1.5">
              <input
                ref={findInputRef}
                type="text"
                placeholder="Find in all subtitles..."
                value={findQuery}
                onChange={(e) => setFindQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (e.shiftKey) handlePrevMatch();
                    else handleNextMatch();
                  }
                }}
                className={`flex-1 px-2 py-1 rounded-none text-xs border focus:outline-none ${
                  'bg-[var(--kt-s0)] border-[var(--kt-s4)] text-white focus:border-indigo-400'
                }`}
              />
              <button
                type="button"
                onClick={() => setMatchCase(prev => !prev)}
                className={`px-2 py-0.5 rounded-none text-[10px] font-mono font-bold border cursor-pointer ${
                  matchCase ? 'bg-indigo-600 text-white border-indigo-500' : ('bg-[var(--kt-s0)] text-slate-400 border-[var(--kt-s4)]')
                }`}
                title="Match Case"
              >
                Aa
              </button>
              <button
                type="button"
                onClick={() => setWholeWord(prev => !prev)}
                className={`px-2 py-0.5 rounded-none text-[10px] font-mono font-bold border cursor-pointer ${
                  wholeWord ? 'bg-indigo-600 text-white border-indigo-500' : ('bg-[var(--kt-s0)] text-slate-400 border-[var(--kt-s4)]')
                }`}
                title="Match Whole Word"
              >
                [ab]
              </button>
              <span className="text-[10px] font-mono font-bold px-1 min-w-[50px] text-center opacity-80">
                {matches.length > 0 ? `${currentMatchIdx + 1}/${matches.length}` : (findQuery ? '0 found' : '')}
              </span>
              <button
                type="button"
                onClick={handlePrevMatch}
                disabled={matches.length === 0}
                className="p-1 rounded-none border text-xs cursor-pointer disabled:opacity-30"
                title="Previous Match"
              >
                <ChevronUp size={12} />
              </button>
              <button
                type="button"
                onClick={handleNextMatch}
                disabled={matches.length === 0}
                className="p-1 rounded-none border text-xs cursor-pointer disabled:opacity-30"
                title="Next Match"
              >
                <ChevronDown size={12} />
              </button>
              <button
                type="button"
                onClick={() => setIsFindOpen(false)}
                className="p-1 rounded-none text-slate-400 hover:text-white"
              >
                <X size={12} />
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              <input
                type="text"
                placeholder="Replace with..."
                value={replaceQuery}
                onChange={(e) => setReplaceQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleReplaceCurrent()}
                className={`flex-1 px-2 py-1 rounded-none text-xs border focus:outline-none ${
                  'bg-[var(--kt-s0)] border-[var(--kt-s4)] text-white focus:border-indigo-400'
                }`}
              />
              <button
                type="button"
                onClick={handleReplaceCurrent}
                disabled={matches.length === 0}
                className="px-2.5 py-1 rounded-none text-[11px] font-bold border border-white/10 hover:bg-white/10 cursor-pointer disabled:opacity-40"
              >
                Replace
              </button>
              <button
                type="button"
                onClick={handleReplaceAll}
                disabled={matches.length === 0}
                className="px-2.5 py-1 rounded-none text-[11px] font-bold bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer disabled:opacity-40"
              >
                Replace All
              </button>
            </div>
          </div>
        )}

        {/* Master Table Column Headers (OOONA Standard Grid) */}
        <div className={`grid grid-cols-[34px_86px_86px_58px_50px_54px_82px_1fr_48px_48px] items-center px-2 py-1.5 text-[10px] font-mono font-bold uppercase tracking-wider border-b shrink-0 z-10 ${
          'bg-[var(--kt-s0)] border-[var(--kt-s4)] text-slate-300'
        }`}>
          <div className="flex items-center justify-center">
            <input
              type="checkbox"
              checked={allSelected}
              ref={el => { if (el) el.indeterminate = someSelected; }}
              onChange={handleToggleSelectAll}
              className="cursor-pointer"
              title="Select All"
            />
          </div>
          <div>Time In</div>
          <div>Time Out</div>
          <div>Dur</div>
          <div>CPL</div>
          <div>CPS</div>
          <div>Speaker</div>
          <div>Dialogue Text</div>
          <div>QC</div>
          <div className="text-right pr-1">Action</div>
        </div>

        {/* Virtualized Master Table Body */}
        <div
          ref={containerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto custom-scrollbar relative"
        >
          {filteredEvents.length === 0 ? (
            <div className="h-48 flex flex-col items-center justify-center text-center p-6 text-slate-400">
              <Sparkles className="w-8 h-8 mb-2 opacity-40 animate-pulse text-indigo-400" />
              <span className="text-xs font-bold text-slate-300">No Subtitles in Table</span>
              <span className="text-[11px] opacity-70 mt-0.5">Click '+ Subtitle' or 'Auto-Generate (AI)' to create subtitles.</span>
            </div>
          ) : (
            <div style={{ height: `${totalHeight}px`, position: 'relative', width: '100%' }}>
              <div
                style={{
                  transform: `translate3d(0, ${topPadding}px, 0)`,
                  display: 'flex',
                  flexDirection: 'column',
                  width: '100%'
                }}
              >
                {visibleEvents.map((ev, relIdx) => {
                  const idx = startIndex + relIdx;
                  const id = ev.id ?? ev.event_id;
                  const isActive = activeEventId === id;
                  const isSelected = selectedIds.has(id);

                  const start = ev.start_time !== undefined ? ev.start_time : (ev.start !== undefined ? ev.start : 0);
                  const end = ev.end_time !== undefined ? ev.end_time : (ev.end !== undefined ? ev.end : 0);
                  const dur = Math.max(0.01, end - start);

                  const text = ev.text || '';
                  const lines = text.split('\n');
                  const lineCpls = lines.map(l => l.replace(/<[^>]+>/g, '').trim().length);
                  const maxLineCpl = Math.max(...lineCpls, 0);
                  const cps = dur > 0 ? text.replace(/<[^>]+>/g, '').trim().length / dur : 0;

                  const hasCplErr = maxLineCpl > cplLimit;
                  const hasCpsErr = cps > cpsLimit;
                  const hasDurErr = dur < 0.833 || dur > 7.0;

                  return (
                    <div
                      key={id ?? idx}
                      onClick={() => {
                        setActiveEventId(id);
                        onSeek(start);
                      }}
                      className={`grid grid-cols-[34px_86px_86px_58px_50px_54px_82px_1fr_48px_48px] items-center px-2 border-b cursor-pointer transition-colors text-xs font-mono group ${
                        isActive
                          ? ('bg-indigo-600/30 border-l-4 border-indigo-400 text-white font-medium border-b-[var(--kt-s4)]'
                            )
                          : (isSelected
                              ? ('bg-blue-950/40 border-b-[var(--kt-s3)]')
                              : (isDark
                                  ? (idx % 2 === 0 ? 'bg-[var(--kt-s1)] hover:bg-[var(--kt-s2)] border-b-[var(--kt-s3)]' : 'bg-[var(--kt-s0)] hover:bg-[var(--kt-s2)] border-b-[var(--kt-s3)]')
                                  : (idx % 2 === 0 ? 'bg-white hover:bg-slate-100 border-b-slate-200' : 'bg-slate-50/70 hover:bg-slate-100 border-b-slate-200')
                                )
                            )
                      }`}
                      style={{ height: `${ROW_HEIGHT}px` }}
                    >
                      {/* 1. Checkbox / ID */}
                      <div className="flex items-center justify-center gap-1" onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => handleToggleSelect(id, e)}
                          className="cursor-pointer"
                        />
                        <span className={`text-[10px] font-bold ${isActive ? 'text-indigo-300 font-extrabold' : 'text-slate-400'}`}>
                          {id}
                        </span>
                      </div>

                      {/* 2. Time In */}
                      <div className={`truncate font-semibold text-emerald-400`}>
                        {toSMPTE(start, frameRate)}
                      </div>

                      {/* 3. Time Out */}
                      <div className={`truncate font-semibold text-rose-400`}>
                        {toSMPTE(end, frameRate)}
                      </div>

                      {/* 4. Duration */}
                      <div className={`truncate font-medium ${hasDurErr ? 'text-rose-400 font-bold' : ('text-slate-300')}`}>
                        {dur.toFixed(2)}s
                      </div>

                      {/* 5. CPL */}
                      <div>
                        <span className={`px-1 py-0.5 rounded-none text-[10px] font-bold ${
                          hasCplErr
                            ? 'bg-rose-950/80 border border-rose-500 text-rose-300'
                            : ('text-slate-400')
                        }`}>
                          {maxLineCpl}/{cplLimit}
                        </span>
                      </div>

                      {/* 6. CPS */}
                      <div>
                        <span className={`px-1 py-0.5 rounded-none text-[10px] font-bold ${
                          hasCpsErr
                            ? 'bg-rose-950/80 border border-rose-500 text-rose-300'
                            : cps > (cpsLimit * 0.85)
                              ? 'text-amber-400 font-semibold'
                              : ('text-slate-400')
                        }`}>
                          {cps.toFixed(1)}
                        </span>
                      </div>

                      {/* 7. Speaker */}
                      <div className="truncate pr-1 text-[11px] font-sans">
                        <span className={`px-1.5 py-0.5 rounded-none border text-[10px] font-bold truncate inline-block max-w-[76px] ${
                          'bg-[var(--kt-s2)] border-[var(--kt-s4)] text-blue-300'
                        }`}>
                          {ev.speaker || 'Spk 1'}
                        </span>
                      </div>

                      {/* 8. Dialogue Text */}
                      <div className="truncate font-sans text-xs pr-2 flex items-center gap-1">
                        {lines.map((l, lIdx) => (
                          <React.Fragment key={lIdx}>
                            {lIdx > 0 && (
                              <span className={`text-[9px] px-1 rounded-none font-mono font-bold text-slate-400 bg-black/60 border border-white/10`}>
                                ⏎
                              </span>
                            )}
                            <span className={`truncate font-medium ${isActive ? 'text-white font-semibold' : ('text-slate-100')}`}>{l}</span>
                          </React.Fragment>
                        ))}
                      </div>

                      {/* 9. QC Status */}
                      <div>
                        {hasCplErr || hasCpsErr || hasDurErr ? (
                          <span className="text-[10px] font-bold text-rose-400 flex items-center gap-0.5">
                            <AlertTriangle size={11} />
                            <span>ERR</span>
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold text-emerald-400 flex items-center gap-0.5">
                            <Check size={11} />
                            <span>OK</span>
                          </span>
                        )}
                      </div>

                      {/* 10. Actions */}
                      <div className="flex items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => onPlayEvent(id)}
                          className="p-1 rounded-none hover:bg-white/10 text-slate-400 hover:text-white cursor-pointer"
                          title="Play"
                        >
                          <Play size={10} className="fill-current" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteEvent(id)}
                          className="p-1 rounded-none hover:bg-rose-950/40 text-slate-400 hover:text-rose-400 cursor-pointer"
                          title="Delete"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default React.memo(SubtitleGridView);
