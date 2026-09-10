import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { 
  Trash2, Plus, Sparkles, CheckSquare, Square, MinusSquare,
  Search, X, Filter, SlidersHorizontal, ArrowUpDown, AlertTriangle
} from 'lucide-react';
import SubtitleEventCard from './SubtitleEventCard';

function SubtitleGridView({
  events = [],
  activeEventId = null,
  setActiveEventId = () => {},
  onPlayEvent = () => {},
  onBulkDelete = () => {},
  onUpdateEvent = () => {},
  onSplitEvent = () => {},
  onMergeEvent = () => {},
  onDeleteEvent = () => {},
  onRebreakEvent = () => {},
  onAddSubtitle = () => {},
  onJumpNextIssue = null,
  cplLimit = 42,
  cpsLimit = 20,
  frameRate = 24.0,
  theme = 'dark',
}) {
  const isDark = theme === 'dark';
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [filterMode, setFilterMode] = useState('all'); // 'all' | 'errors' | 'warnings'
  const [searchQuery, setSearchQuery] = useState('');

  // ── High-Performance Viewport Virtualization (Smooth 60-120 FPS on 1,500+ cards) ──
  const containerRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);
  const ITEM_HEIGHT = 145; // average card height + gap
  const OVERSCAN = 5;

  const handleScroll = useCallback((e) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setViewportHeight(el.clientHeight || 600);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.height) {
          setViewportHeight(entry.contentRect.height);
        }
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Filter events based on search and mode
  const filteredEvents = useMemo(() => {
    return events.filter(ev => {
      // Search text match
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const textMatch = (ev.text || '').toLowerCase().includes(q);
        const idMatch = String(ev.id).includes(q);
        if (!textMatch && !idMatch) return false;
      }

      // Filter modes
      if (filterMode === 'all') return true;
      
      const text = ev.text || '';
      const lines = text.split('\n');
      const maxCpl = Math.max(...lines.map(l => l.replace(/<[^>]+>/g, '').trim().length), 0);
      const start = ev.start_time ?? ev.start ?? 0;
      const end = ev.end_time ?? ev.end ?? 0;
      const dur = Math.max(0.01, end - start);
      const cps = text.replace(/<[^>]+>/g, '').trim().length / dur;
      const isOverCpl = maxCpl > cplLimit;
      const isOverCps = cps > cpsLimit;
      const hasErrors = (ev.qc_errors || []).some(e => e.severity === 'error');
      const hasWarnings = (ev.qc_errors || []).some(e => e.severity === 'warning');

      if (filterMode === 'errors') return isOverCpl || hasErrors || dur < 0.833 || dur > 7.0;
      if (filterMode === 'warnings') return isOverCps || hasWarnings;
      return true;
    });
  }, [events, searchQuery, filterMode, cplLimit, cpsLimit]);

  // Smooth auto-scroll when activeEventId changes externally
  useEffect(() => {
    if (!activeEventId || !containerRef.current) return;
    const activeIdx = filteredEvents.findIndex(e => (e.id === activeEventId || e.event_id === activeEventId));
    if (activeIdx !== -1) {
      const itemTop = activeIdx * ITEM_HEIGHT;
      const curScroll = containerRef.current.scrollTop;
      const vHeight = containerRef.current.clientHeight || 600;
      if (itemTop < curScroll || itemTop > curScroll + vHeight - ITEM_HEIGHT) {
        containerRef.current.scrollTo({
          top: Math.max(0, itemTop - vHeight / 3),
          behavior: 'smooth'
        });
      }
    }
  }, [activeEventId, filteredEvents]);

  const totalCount = filteredEvents.length;
  const totalHeight = totalCount * ITEM_HEIGHT;
  const startIndex = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(totalCount, Math.ceil((scrollTop + viewportHeight) / ITEM_HEIGHT) + OVERSCAN);
  const visibleEvents = filteredEvents.slice(startIndex, endIndex);
  const topPadding = startIndex * ITEM_HEIGHT;

  // Toggle single selection
  const handleToggleSelect = (id, e) => {
    if (e) e.stopPropagation();
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Toggle Select All
  const handleToggleSelectAll = useCallback(() => {
    if (selectedIds.size === filteredEvents.length && filteredEvents.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredEvents.map(e => e.id ?? e.event_id)));
    }
  }, [filteredEvents, selectedIds]);

  // Bulk Delete Selected
  const handleDeleteSelected = useCallback(() => {
    if (selectedIds.size === 0) return;
    onBulkDelete(Array.from(selectedIds));
    setSelectedIds(new Set());
  }, [selectedIds, onBulkDelete]);

  // Keyboard shortcut for Ctrl+A (Select All) and Delete (Bulk Delete)
  useEffect(() => {
    const handleKeyDown = (e) => {
      const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
      if (activeTag === 'input' || activeTag === 'textarea') return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelectedIds(new Set(filteredEvents.map(ev => ev.id ?? ev.event_id)));
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.size > 0) {
        e.preventDefault();
        handleDeleteSelected();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [filteredEvents, selectedIds, handleDeleteSelected]);

  const allSelected = filteredEvents.length > 0 && selectedIds.size === filteredEvents.length;
  const someSelected = selectedIds.size > 0 && selectedIds.size < filteredEvents.length;

  return (
    <div className="flex flex-col w-full h-full overflow-hidden bg-[#0e0f12] select-none">
      
      {/* ── Top Bar: Search, Filters & Stats (CapCut Style) ── */}
      <div className="px-3 py-2 border-b border-[#262734] flex flex-col gap-2 shrink-0 bg-[#14151a]">
        
        {/* Row 1: Search & + Add Button */}
        <div className="flex items-center gap-2">
          {/* Search Box */}
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search dialogue words or #ID..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-7 py-1 rounded-lg text-xs bg-[#0e0f12] border border-[#262734] text-white placeholder-slate-500 focus:outline-none focus:border-[#00e5be] focus:ring-1 focus:ring-[#00e5be]/30 transition-all"
            />
            {searchQuery && (
              <button 
                type="button" 
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* Quick Add Subtitle Button */}
          {onAddSubtitle && (
            <button
              type="button"
              onClick={onAddSubtitle}
              className="px-2.5 py-1 rounded-lg text-xs font-bold bg-[#181920] hover:bg-[#00e5be] hover:text-black text-slate-200 border border-[#262734] flex items-center gap-1 transition-all cursor-pointer shadow-xs shrink-0"
              title="Add new subtitle at current time"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>+ Sub</span>
            </button>
          )}
        </div>

        {/* Row 2: Filter Tabs & Count */}
        <div className="flex items-center justify-between text-xs">
          {/* Filter Pills */}
          <div className="flex items-center gap-1 bg-[#0e0f12] p-0.5 rounded-lg border border-[#262734]">
            <button
              type="button"
              onClick={() => setFilterMode('all')}
              className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-all cursor-pointer ${
                filterMode === 'all' 
                  ? 'bg-[#181920] text-[#00e5be] shadow-xs' 
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All ({events.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('errors')}
              className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-all cursor-pointer ${
                filterMode === 'errors' 
                  ? 'bg-rose-950/80 text-rose-300 border border-rose-800' 
                  : 'text-slate-400 hover:text-rose-400'
              }`}
            >
              Errors
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('warnings')}
              className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-all cursor-pointer ${
                filterMode === 'warnings' 
                  ? 'bg-amber-950/80 text-amber-300 border border-amber-800' 
                  : 'text-slate-400 hover:text-amber-400'
              }`}
            >
              Warnings
            </button>
          </div>

          {/* Quick Issue jumper (F8 parity) */}
          {onJumpNextIssue && (
            <button
              type="button"
              onClick={onJumpNextIssue}
              className="px-2 py-0.5 rounded text-[10px] font-bold border border-amber-700/50 bg-amber-950/40 text-amber-300 hover:bg-amber-900/60 hover:text-amber-100 flex items-center gap-1 cursor-pointer transition-colors shadow-xs"
              title="Jump to Next QC Issue (F8)"
            >
              <AlertTriangle size={10} />
              <span>Next Issue</span>
            </button>
          )}

          {/* Bulk Select / Delete Tools */}
          <div className="flex items-center gap-2">
            {selectedIds.size > 0 ? (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleDeleteSelected}
                  className="px-2 py-0.5 rounded bg-rose-600 hover:bg-rose-500 text-white font-bold text-[10px] flex items-center gap-1 cursor-pointer transition-colors shadow-xs"
                >
                  <Trash2 size={11} />
                  <span>Delete ({selectedIds.size})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedIds(new Set())}
                  className="px-1.5 py-0.5 rounded text-[10px] font-semibold text-slate-400 hover:text-white border border-[#262734] bg-[#181920] cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleToggleSelectAll}
                className="text-[10px] text-slate-400 hover:text-slate-200 flex items-center gap-1 cursor-pointer transition-colors"
                title="Select All (Ctrl+A)"
              >
                <CheckSquare size={12} />
                <span>Select All</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Subtitle Cards Container (High-Performance Virtualized Viewport) ── */}
      <div 
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-2 custom-scrollbar relative"
      >
        {filteredEvents.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-center p-6 text-slate-400">
            <Sparkles className="w-8 h-8 mb-2 opacity-40 animate-pulse text-[#00e5be]" />
            <p className="text-xs font-bold text-slate-300">No Subtitles in View</p>
            <p className="text-[11px] opacity-70 mt-1 max-w-[220px]">
              {searchQuery ? "No matches found for your search." : "Click '+ Sub' or 'Auto Captions (AI)' to generate subtitles."}
            </p>
          </div>
        ) : (
          <div style={{ height: `${totalHeight}px`, position: 'relative', width: '100%' }}>
            <div 
              style={{ 
                transform: `translate3d(0, ${topPadding}px, 0)`,
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                width: '100%'
              }}
            >
              {visibleEvents.map((event, relIdx) => {
                const idx = startIndex + relIdx;
                const curId = event.id ?? event.event_id;
                return (
                  <SubtitleEventCard
                    key={curId ?? idx}
                    event={event}
                    isActive={activeEventId === curId}
                    onActivate={setActiveEventId}
                    onUpdate={onUpdateEvent}
                    onPlay={onPlayEvent}
                    onSplit={onSplitEvent}
                    onMerge={onMergeEvent}
                    onDelete={onDeleteEvent}
                    onRebreak={onRebreakEvent}
                    onNavigatePrev={() => {
                      const curIdx = events.findIndex(e => (e.id === curId || e.event_id === curId));
                      if (curIdx > 0) {
                        const prevId = events[curIdx - 1].id ?? events[curIdx - 1].event_id;
                        setActiveEventId(prevId);
                        onPlayEvent(prevId);
                      }
                    }}
                    onNavigateNext={() => {
                      const curIdx = events.findIndex(e => (e.id === curId || e.event_id === curId));
                      if (curIdx < events.length - 1) {
                        const nextId = events[curIdx + 1].id ?? events[curIdx + 1].event_id;
                        setActiveEventId(nextId);
                        onPlayEvent(nextId);
                      }
                    }}
                    cplLimit={cplLimit}
                    cpsLimit={cpsLimit}
                    frameRate={frameRate}
                    showMerge={idx < filteredEvents.length - 1}
                    theme={theme}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default React.memo(SubtitleGridView);
