import React, { useState, useMemo } from 'react';
import {
  Play, Square, Plus, Trash2, Split, Merge, AlertCircle, AlertTriangle,
  Search, Sparkles, Volume2, Film, LayoutList, LayoutGrid
} from 'lucide-react';

export default function SegmentEditor({
  segments,
  setSegments,
  activeSegmentId,
  setActiveSegmentId,
  onPlaySegment,
  onStopSegment,
  onLintTrigger,
  onStartTranscribe,
  audioLoaded,
  onOpenSrtPreview
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterSpeaker, setFilterSpeaker] = useState('ALL');
  const [filterErrorsOnly, setFilterErrorsOnly] = useState(false);
  const [minConfidence, setMinConfidence] = useState(0);
  const [isCompactView, setIsCompactView] = useState(false);
  const [showHeatmapGuide, setShowHeatmapGuide] = useState(false);
  const [nudgeStep, setNudgeStep] = useState(0.05);

  const formatTimestampStr = (secs) => {
    const s = Math.max(0, secs);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    const ms = Math.round((s - Math.floor(s)) * 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
  };

  // UI-07: Keyboard navigation between segments with Alt+ArrowDown / Alt+ArrowUp
  React.useEffect(() => {
    const handleSegmentNav = (e) => {
      if (e.altKey && e.key === 'ArrowDown') {
        e.preventDefault();
        const currIdx = segments.findIndex((s) => s.segment_id === activeSegmentId);
        if (currIdx >= 0 && currIdx < segments.length - 1) {
          const nextSeg = segments[currIdx + 1];
          setActiveSegmentId(nextSeg.segment_id);
          onPlaySegment(nextSeg.start_time, nextSeg.end_time);
        }
      } else if (e.altKey && e.key === 'ArrowUp') {
        e.preventDefault();
        const currIdx = segments.findIndex((s) => s.segment_id === activeSegmentId);
        if (currIdx > 0) {
          const prevSeg = segments[currIdx - 1];
          setActiveSegmentId(prevSeg.segment_id);
          onPlaySegment(prevSeg.start_time, prevSeg.end_time);
        }
      }
    };
    window.addEventListener('keydown', handleSegmentNav);
    return () => window.removeEventListener('keydown', handleSegmentNav);
  }, [segments, activeSegmentId, onPlaySegment, setActiveSegmentId]);

  const updateSegmentField = (segmentId, field, value) => {
    const updated = segments.map((seg) => {
      if (seg.segment_id === segmentId) {
        const newSeg = { ...seg, [field]: value };
        if (field === 'start_time' || field === 'end_time') {
          newSeg.duration = Math.max(0, parseFloat((newSeg.end_time - newSeg.start_time).toFixed(3)));
          newSeg.start_time_str = formatTimestampStr(newSeg.start_time);
          newSeg.end_time_str = formatTimestampStr(newSeg.end_time);
        }
        return newSeg;
      }
      return seg;
    });
    setSegments(updated);
    if (onLintTrigger) onLintTrigger(updated);
  };

  const deleteSegment = (segmentId) => {
    const filtered = segments.filter((s) => s.segment_id !== segmentId);
    const reindexed = filtered.map((s, idx) => ({ ...s, segment_id: idx + 1 }));
    setSegments(reindexed);
    if (onLintTrigger) onLintTrigger(reindexed);
  };

  const splitSegment = (segment) => {
    const mid = parseFloat(((segment.start_time + segment.end_time) / 2).toFixed(3));
    const words = (segment.transcript || '').trim().split(/\s+/);
    const half = Math.ceil(words.length / 2);
    const text1 = words.slice(0, half).join(' ');
    const text2 = words.slice(half).join(' ');

    const newSegments = [];
    segments.forEach((s) => {
      if (s.segment_id === segment.segment_id) {
        newSegments.push({
          ...s,
          end_time: mid,
          duration: parseFloat((mid - s.start_time).toFixed(3)),
          transcript: text1,
          words: []
        });
        newSegments.push({
          ...s,
          segment_id: s.segment_id + 0.5,
          start_time: mid,
          end_time: s.end_time,
          duration: parseFloat((s.end_time - mid).toFixed(3)),
          transcript: text2,
          words: []
        });
      } else {
        newSegments.push(s);
      }
    });

    const reindexed = newSegments.map((s, idx) => ({ ...s, segment_id: idx + 1 }));
    setSegments(reindexed);
    if (onLintTrigger) onLintTrigger(reindexed);
  };

  const mergeWithNext = (index) => {
    if (index >= segments.length - 1) return;
    const current = segments[index];
    const next = segments[index + 1];

    const merged = {
      ...current,
      end_time: next.end_time,
      duration: parseFloat((next.end_time - current.start_time).toFixed(3)),
      transcript: `${current.transcript || ''} ${next.transcript || ''}`.trim(),
      words: [...(current.words || []), ...(next.words || [])]
    };

    const newSegments = [...segments];
    newSegments.splice(index, 2, merged);
    const reindexed = newSegments.map((s, idx) => ({ ...s, segment_id: idx + 1 }));
    setSegments(reindexed);
    if (onLintTrigger) onLintTrigger(reindexed);
  };

  const addNewSegmentAtEnd = () => {
    const lastSeg = segments[segments.length - 1];
    const startTime = lastSeg ? lastSeg.end_time : 0.0;
    const endTime = parseFloat((startTime + 3.5).toFixed(3));

    const newSeg = {
      segment_id: segments.length + 1,
      speaker: lastSeg && lastSeg.speaker === 'Speaker 1' ? 'Speaker 2' : 'Speaker 1',
      gender: 'Male',
      start_time: startTime,
      end_time: endTime,
      duration: 3.5,
      transcript: '',
      confidence: 1.0,
      words: [],
      qc_errors: [],
      is_valid: true
    };

    const updated = [...segments, newSeg];
    setSegments(updated);
    setActiveSegmentId(newSeg.segment_id);
    if (onLintTrigger) onLintTrigger(updated);
  };

  // Filtered segments
  const filteredSegments = useMemo(() => {
    return segments.filter((seg) => {
      if (filterSpeaker !== 'ALL' && seg.speaker !== filterSpeaker) return false;
      if (filterErrorsOnly && (!seg.qc_errors || seg.qc_errors.length === 0)) return false;
      if (minConfidence > 0) {
        const segConf = (seg.confidence !== undefined && seg.confidence !== null ? seg.confidence : 1.0) * 100;
        if (segConf < minConfidence) return false;
      }
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchText = (seg.transcript || '').toLowerCase().includes(q);
        const matchSpeaker = (seg.speaker || '').toLowerCase().includes(q);
        if (!matchText && !matchSpeaker) return false;
      }
      return true;
    });
  }, [segments, filterSpeaker, filterErrorsOnly, minConfidence, searchQuery]);

  const uniqueSpeakers = useMemo(() => {
    const names = new Set(segments.map((s) => s.speaker).filter(Boolean));
    return Array.from(names).sort();
  }, [segments]);

  return (
    <div className="bg-[var(--kt-s1)] border border-[var(--kt-s4)] rounded-lg p-2.5 shadow-sm flex flex-col flex-1 min-h-[500px]">
      {/* Sleek Sub-Header & Controls (Sticky while scrolling) */}
      <div className="sticky top-0 z-20 bg-[var(--kt-s1)]/95 backdrop-blur-xs flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[var(--kt-s4)] pt-0.5">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-bold text-slate-200 uppercase tracking-wider">Segments</h2>
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-[var(--kt-s2)] text-slate-300 font-bold border border-[var(--kt-s4)]">
            {filteredSegments.length} of {segments.length}
          </span>

          {/* Confidence Heatmap Legend Trigger */}
          <button
            onClick={() => setShowHeatmapGuide(!showHeatmapGuide)}
            className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-400 hover:text-[var(--kt-accent)] bg-[var(--kt-s2)] hover:bg-[var(--kt-s3)] px-2 py-0.5 rounded border border-[var(--kt-s4)] transition-colors cursor-pointer"
            title="Word Confidence Legend"
          >
            <Sparkles className="w-3 h-3 text-[var(--kt-accent)]" />
            <span>Heatmap</span>
          </button>
        </div>

        {/* Search & Filter Controls */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {/* Text Search */}
          <div className="relative">
            <Search className="w-3 h-3 text-slate-500 absolute left-2 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-6 pr-2.5 py-1 rounded bg-[var(--kt-s2)] border border-[var(--kt-s4)] focus:border-[var(--kt-accent)] focus:outline-none text-[11px] text-[var(--kt-text)] w-28 placeholder-slate-500 transition-all"
            />
          </div>

          {/* Speaker Filter */}
          <select
            value={filterSpeaker}
            onChange={(e) => setFilterSpeaker(e.target.value)}
            className="px-2 py-1 rounded bg-[var(--kt-s2)] border border-[var(--kt-s4)] text-[11px] font-semibold text-slate-200 cursor-pointer focus:border-[var(--kt-accent)] focus:outline-none"
          >
            <option value="ALL">All Speakers</option>
            {uniqueSpeakers.map((spk) => (
              <option key={spk} value={spk}>{spk}</option>
            ))}
          </select>

          {/* Errors Only Filter */}
          <button
            onClick={() => setFilterErrorsOnly(!filterErrorsOnly)}
            className={`px-2 py-1 rounded border text-[11px] font-semibold transition-colors cursor-pointer ${
              filterErrorsOnly
                ? 'bg-rose-500/15 text-rose-300 border-rose-500/40'
                : 'bg-[var(--kt-s2)] text-slate-400 border-[var(--kt-s4)] hover:bg-[var(--kt-s3)]'
            }`}
          >
            Issues Only
          </button>

          {/* Nudge Step Selector */}
          <select
            value={nudgeStep}
            onChange={(e) => setNudgeStep(parseFloat(e.target.value))}
            className="px-2 py-1 rounded bg-[var(--kt-s2)] border border-[var(--kt-s4)] text-[11px] font-semibold text-slate-200 cursor-pointer focus:border-[var(--kt-accent)] focus:outline-none"
            title="Timestamp nudge step precision"
          >
            <option value={0.01}>±10ms</option>
            <option value={0.05}>±50ms</option>
            <option value={0.1}>±100ms</option>
            <option value={0.5}>±500ms</option>
            <option value={1.0}>±1.0s</option>
          </select>

          {/* Confidence Filter Slider */}
          <div className="flex items-center gap-1.5 px-2 py-0.5 bg-[var(--kt-s2)] border border-[var(--kt-s4)] rounded text-[11px]">
            <span className="text-slate-400 font-semibold text-[10px]">Conf:</span>
            <input
              type="range"
              min="0"
              max="95"
              step="5"
              value={minConfidence}
              onChange={(e) => setMinConfidence(Number(e.target.value))}
              className="w-14 accent-[var(--kt-accent)] cursor-pointer h-1 bg-[var(--kt-s3)] rounded"
              title={`Filter segments with confidence ≥ ${minConfidence}%`}
            />
            <span className="font-mono text-[10px] font-bold text-slate-300 min-w-[28px]">
              {minConfidence > 0 ? `≥${minConfidence}%` : 'All'}
            </span>
          </div>

          {/* Compact / Expanded Toggle */}
          <button
            onClick={() => setIsCompactView(!isCompactView)}
            className={`p-1 rounded border text-[11px] font-semibold transition-colors cursor-pointer ${
              isCompactView
                ? 'bg-[var(--kt-accent)]/15 text-[var(--kt-accent)] border-[var(--kt-accent)]/40'
                : 'bg-[var(--kt-s2)] text-slate-400 border-[var(--kt-s4)] hover:bg-[var(--kt-s3)]'
            }`}
            title={isCompactView ? 'Switch to Expanded View' : 'Switch to Compact View'}
          >
            {isCompactView ? <LayoutGrid className="w-3.5 h-3.5" /> : <LayoutList className="w-3.5 h-3.5" />}
          </button>

          {/* SRT Live Preview Button */}
          {onOpenSrtPreview && (
            <button
              onClick={onOpenSrtPreview}
              className="flex items-center gap-1 px-2 py-1 bg-[var(--kt-s2)] hover:bg-[var(--kt-s3)] text-slate-300 hover:text-[var(--kt-accent)] border border-[var(--kt-s4)] rounded text-[11px] font-semibold transition-colors cursor-pointer"
              title="Open Live SRT Subtitle Preview & Quality Audit"
            >
              <Film className="w-3 h-3 text-[var(--kt-accent)]" />
              <span>SRT Preview</span>
            </button>
          )}

          {/* Add Segment Button */}
          <button
            onClick={addNewSegmentAtEnd}
            className="flex items-center gap-1 px-2.5 py-1 bg-[var(--kt-accent)]/15 hover:bg-[var(--kt-accent)]/25 text-[var(--kt-accent)] border border-[var(--kt-accent)]/40 rounded text-[11px] font-bold transition-colors cursor-pointer"
          >
            <Plus className="w-3 h-3" />
            <span>Add</span>
          </button>
        </div>
      </div>

      {/* Heatmap Legend Guide (Collapsible) */}
      {showHeatmapGuide && (
        <div className="mt-2 p-2 bg-[var(--kt-s2)] rounded border border-[var(--kt-s4)] text-[11px] flex flex-wrap items-center justify-between gap-2 animate-in fade-in">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-slate-200 flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-[var(--kt-accent)]" />
              Heatmap Filter:
            </span>
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-300 border border-rose-500/30 font-bold">
              🔴 Low (&lt; 50%)
            </span>
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 font-bold">
              🟡 Needs Review (50%–79%)
            </span>
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-medium">
              ✓ High (&ge; 80% - Auto Hidden)
            </span>
          </div>
          <span className="text-slate-400 text-[10px]">
            💡 Only words &lt; 80% appear as clickable chips to save reviewer time!
          </span>
        </div>
      )}

      {/* Scrollable Segments List (Full-Height with Generous pb-36 Bottom Spacer) */}
      <div className="flex-1 overflow-y-auto space-y-2 pt-2 pr-1 pb-36">
        {filteredSegments.length === 0 ? (
          <div className="text-center py-12 px-4">
            {audioLoaded ? (
              <div className="max-w-md mx-auto bg-[var(--kt-s2)] border border-dashed border-[var(--kt-s4)] rounded-xl p-6 shadow-sm">
                <Sparkles className="w-8 h-8 text-[var(--kt-accent)] mx-auto mb-2 animate-pulse" />
                <h3 className="text-sm font-bold text-slate-200">Audio Ready for AI Transcription</h3>
                <p className="text-xs text-slate-400 mt-1 mb-3">
                  Click the button below to auto-transcribe speakers, verbatim script, and millisecond timestamps.
                </p>
                <button
                  type="button"
                  onClick={onStartTranscribe}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-[var(--kt-accent)] hover:bg-[var(--kt-accent-strong)] active:bg-[var(--kt-accent-2)] text-black rounded text-xs font-bold shadow-[0_0_12px_rgba(var(--kt-accent-rgb),0.25)] transition-transform active:scale-95 cursor-pointer"
                >
                  <Sparkles className="w-4 h-4 fill-current" />
                  <span>Start Auto-Transcription Now</span>
                </button>
              </div>
            ) : (
              <div className="py-12 text-slate-500">
                <Volume2 className="w-8 h-8 mx-auto mb-2 text-slate-600" />
                <p className="text-xs font-semibold text-slate-400">No audio loaded</p>
                <p className="text-[11px] text-slate-500 mt-0.5">Import an audio file above to start transcription.</p>
              </div>
            )}
          </div>
        ) : (
          filteredSegments.map((seg, idx) => {
            const isActive = seg.segment_id === activeSegmentId;
            const isSpeaker1 = seg.speaker === 'Speaker 1';
            const hasErrors = seg.qc_errors && seg.qc_errors.some((e) => e.severity === 'error');
            const hasWarnings = seg.qc_errors && seg.qc_errors.some((e) => e.severity === 'warning');

            // Word-level confidence items
            const wordsList = (seg.words && seg.words.length > 0)
              ? seg.words
              : (seg.transcript || '').split(/\s+/).filter(Boolean).map((w, wIdx, arr) => {
                  const segDur = Math.max(0.1, seg.end_time - seg.start_time);
                  const wDur = segDur / Math.max(1, arr.length);
                  // No word scores from ElevenLabs Scribe for this segment: nothing is flagged as low confidence
                  const conf = 1.0;
                  return {
                    word: w,
                    confidence: conf,
                    start_time: parseFloat((seg.start_time + wIdx * wDur).toFixed(3)),
                    end_time: parseFloat((seg.start_time + (wIdx + 1) * wDur).toFixed(3))
                  };
                });

            const hasLowConfidenceWord = wordsList.some((w) => w.confidence < 0.50);

            return (
              <div
                key={seg.segment_id}
                onClick={() => setActiveSegmentId(seg.segment_id)}
                className={`${isCompactView ? 'p-2 rounded-lg' : 'p-3 rounded-lg'} border transition-all ${
                  isActive
                    ? 'bg-[var(--kt-s2)] border-[var(--kt-accent)] shadow-[0_0_15px_rgba(var(--kt-accent-rgb),0.12)] ring-1 ring-[var(--kt-accent)]/30'
                    : hasErrors
                    ? 'bg-[var(--kt-s2)] border-rose-500/40 hover:border-rose-500/60'
                    : hasWarnings
                    ? 'bg-[var(--kt-s2)] border-amber-500/40 hover:border-amber-500/60'
                    : 'bg-[var(--kt-s2)] border-[var(--kt-s4)] hover:border-[var(--kt-s5)]'
                }`}
              >
                {/* Segment Top Control Bar (Compact Single Row) */}
                <div className={`flex flex-wrap items-center justify-between gap-1.5 ${isCompactView ? 'mb-1' : 'mb-2'}`}>
                  {/* Left: Play/Loop & Stop Buttons, Segment #, Speaker & Gender */}
                  <div className="flex items-center gap-1.5">
                    {/* Play / Loop Segment Button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onPlaySegment(seg.start_time, seg.end_time);
                        setActiveSegmentId(seg.segment_id);
                      }}
                      className={`flex items-center justify-center h-6 w-6 rounded text-black font-bold shadow-xs transition-transform active:scale-95 cursor-pointer ${
                        isSpeaker1
                          ? 'bg-[var(--kt-accent)] hover:bg-[var(--kt-accent-strong)]'
                          : 'bg-[var(--kt-info)] hover:bg-[var(--kt-accent-2)]'
                      }`}
                      title="Play this segment in continuous loop"
                    >
                      <Play className="w-3 h-3 fill-current ml-0.5" />
                    </button>

                    {/* Stop Button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onStopSegment) {
                          onStopSegment(seg.start_time);
                        } else {
                          onPlaySegment(seg.start_time, seg.start_time);
                        }
                        setActiveSegmentId(seg.segment_id);
                      }}
                      className="flex items-center justify-center h-6 w-6 rounded bg-[var(--kt-s3)] hover:bg-[var(--kt-s4)] text-slate-300 hover:text-rose-400 border border-[var(--kt-s5)] transition-colors active:scale-95 cursor-pointer"
                      title="Stop & Reset Marker to Segment Start"
                    >
                      <Square className="w-2.5 h-2.5 fill-current" />
                    </button>

                    <span className="font-mono text-[11px] font-bold text-slate-400 px-1 py-0.2 bg-[var(--kt-s3)] rounded border border-[var(--kt-s5)]">
                      #{seg.segment_id}
                    </span>

                    {/* Speaker Selector */}
                    <select
                      value={seg.speaker}
                      onChange={(e) => updateSegmentField(seg.segment_id, 'speaker', e.target.value)}
                      className={`text-[11px] font-semibold px-2 py-0.5 rounded border cursor-pointer focus:outline-none ${
                        isSpeaker1
                          ? 'bg-[var(--kt-s3)] text-[var(--kt-accent)] border-[var(--kt-accent)]/40'
                          : 'bg-[var(--kt-s3)] text-[var(--kt-info)] border-[var(--kt-info)]/40'
                      }`}
                    >
                      {uniqueSpeakers.map((spk) => (
                        <option key={spk} value={spk}>{spk}</option>
                      ))}
                      {/* Always allow adding Speaker N+1 */}
                      {!uniqueSpeakers.includes(`Speaker ${uniqueSpeakers.length + 1}`) && (
                        <option value={`Speaker ${uniqueSpeakers.length + 1}`}>
                          + Speaker {uniqueSpeakers.length + 1}
                        </option>
                      )}
                    </select>

                    {/* Gender Selector */}
                    <select
                      value={seg.gender}
                      onChange={(e) => updateSegmentField(seg.segment_id, 'gender', e.target.value)}
                      className="text-[11px] font-medium px-2 py-0.5 rounded border border-[var(--kt-s5)] bg-[var(--kt-s3)] text-slate-200 cursor-pointer focus:outline-none"
                    >
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                      <option value="Unknown">Unknown</option>
                    </select>

                    {/* Low Confidence Indicator Flag */}
                    {hasLowConfidenceWord && (
                      <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-rose-500/15 text-rose-300 border border-rose-500/30">
                        ⚠️ Low Conf
                      </span>
                    )}
                  </div>

                  {/* Right: Millisecond Timestamps & Actions */}
                  <div className="flex items-center gap-1 font-mono text-[11px] text-slate-300">
                    {/* Start Time Input with Micro-Nudge */}
                    <div className={`flex items-center gap-0.5 bg-[var(--kt-s3)] px-1.5 py-0.5 rounded border ${
                      seg.start_time >= seg.end_time ? 'border-rose-500 bg-rose-500/15' : 'border-[var(--kt-s5)]'
                    }`}>
                      <span className="text-slate-500 text-[9px] font-bold">START</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          updateSegmentField(seg.segment_id, 'start_time', parseFloat(Math.max(0, seg.start_time - nudgeStep).toFixed(3)));
                        }}
                        className="px-0.5 text-[9px] text-slate-400 hover:text-[var(--kt-accent)] hover:bg-[var(--kt-s4)] rounded cursor-pointer"
                        title={`Nudge -${nudgeStep}s`}
                      >
                        ◀
                      </button>
                      <input
                        type="number"
                        step="0.001"
                        value={seg.start_time}
                        onChange={(e) => updateSegmentField(seg.segment_id, 'start_time', parseFloat(e.target.value) || 0)}
                        className="w-12 bg-transparent text-slate-200 font-bold focus:outline-none text-center font-mono text-[11px]"
                      />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          updateSegmentField(seg.segment_id, 'start_time', parseFloat((seg.start_time + nudgeStep).toFixed(3)));
                        }}
                        className="px-0.5 text-[9px] text-slate-400 hover:text-[var(--kt-accent)] hover:bg-[var(--kt-s4)] rounded cursor-pointer"
                        title={`Nudge +${nudgeStep}s`}
                      >
                        ▶
                      </button>
                      <span className="text-slate-500 text-[9px]">s</span>
                    </div>

                    <span className="text-slate-500">→</span>

                    {/* End Time Input with Micro-Nudge */}
                    <div className={`flex items-center gap-0.5 bg-[var(--kt-s3)] px-1.5 py-0.5 rounded border ${
                      seg.start_time >= seg.end_time ? 'border-rose-500 bg-rose-500/15' : 'border-[var(--kt-s5)]'
                    }`}>
                      <span className="text-slate-500 text-[9px] font-bold">END</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          updateSegmentField(seg.segment_id, 'end_time', parseFloat(Math.max(seg.start_time + 0.1, seg.end_time - nudgeStep).toFixed(3)));
                        }}
                        className="px-0.5 text-[9px] text-slate-400 hover:text-[var(--kt-accent)] hover:bg-[var(--kt-s4)] rounded cursor-pointer"
                        title={`Nudge -${nudgeStep}s`}
                      >
                        ◀
                      </button>
                      <input
                        type="number"
                        step="0.001"
                        value={seg.end_time}
                        onChange={(e) => updateSegmentField(seg.segment_id, 'end_time', parseFloat(e.target.value) || 0)}
                        className="w-12 bg-transparent text-slate-200 font-bold focus:outline-none text-center font-mono text-[11px]"
                      />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          updateSegmentField(seg.segment_id, 'end_time', parseFloat((seg.end_time + nudgeStep).toFixed(3)));
                        }}
                        className="px-0.5 text-[9px] text-slate-400 hover:text-[var(--kt-accent)] hover:bg-[var(--kt-s4)] rounded cursor-pointer"
                        title={`Nudge +${nudgeStep}s`}
                      >
                        ▶
                      </button>
                      <span className="text-slate-500 text-[9px]">s</span>
                    </div>

                    {/* Duration Badge */}
                    {(() => {
                      const isInvalid = seg.start_time >= seg.end_time;
                      const isOutOfRange = seg.duration > 20 || seg.duration < 0.5;
                      const isWarn = isInvalid || isOutOfRange;
                      return (
                        <span
                          className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${
                            isWarn
                              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                              : 'text-slate-400 bg-[var(--kt-s3)]'
                          }`}
                          title={isInvalid ? '⚠️ Start time must be less than end time!' : isOutOfRange ? '⚠️ Duration out of range (0.5s–20s)' : ''}
                        >
                          {isInvalid ? '⚠️ INVALID' : `${seg.duration.toFixed(2)}s`}
                        </span>
                      );
                    })()}

                    {/* Actions: Split / Merge / Delete */}
                    <div className="flex items-center gap-0.5 ml-1 border-l border-[var(--kt-s4)] pl-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          splitSegment(seg);
                        }}
                        title="Split segment"
                        className="p-1 hover:bg-[var(--kt-s3)] text-slate-400 hover:text-[var(--kt-accent)] rounded cursor-pointer"
                      >
                        <Split className="w-3 h-3" />
                      </button>

                      {idx < segments.length - 1 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            mergeWithNext(idx);
                          }}
                          title="Merge with next"
                          className="p-1 hover:bg-[var(--kt-s3)] text-slate-400 hover:text-emerald-400 rounded cursor-pointer"
                        >
                          <Merge className="w-3 h-3" />
                        </button>
                      )}

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteSegment(seg.segment_id);
                        }}
                        title="Delete segment"
                        className="p-1 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 rounded cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Visual Word-Level Confidence Heatmap Ribbon (Shows ONLY words < 80% confidence) */}
                {(() => {
                  const lowConfidenceWords = wordsList.filter((w) => w.confidence < 0.80);
                  if (lowConfidenceWords.length === 0) return null;

                  return (
                    <div className="mb-1.5 p-1.5 bg-[var(--kt-s3)] rounded border border-[var(--kt-s5)] flex flex-wrap items-center gap-1">
                      <span className="text-[9px] font-bold text-amber-400 uppercase tracking-wider mr-0.5 flex items-center gap-1">
                        <Sparkles className="w-2.5 h-2.5 text-amber-400" />
                        Needs Review (&lt; 80%):
                      </span>
                      {lowConfidenceWords.map((wObj, wIdx) => {
                        const conf = wObj.confidence;
                        const isVeryLow = conf < 0.50;

                        return (
                          <button
                            key={wIdx}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              const wStart = wObj.start_time !== undefined ? wObj.start_time : seg.start_time;
                              const wEnd = wObj.end_time !== undefined ? wObj.end_time : seg.end_time;
                              onPlaySegment(wStart, wEnd);
                              setActiveSegmentId(seg.segment_id);
                            }}
                            title={`"${wObj.word}" — Confidence: ${(conf * 100).toFixed(0)}% (Click to loop phrase)`}
                            className={`inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[11px] font-semibold transition-all active:scale-95 cursor-pointer ${
                              isVeryLow
                                ? 'bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 font-bold'
                                : 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40'
                            }`}
                          >
                            <span>{wObj.word}</span>
                            <span className={`text-[8px] font-mono font-bold ${
                              isVeryLow ? 'text-rose-400' : 'text-amber-400'
                            }`}>
                              {(conf * 100).toFixed(0)}%
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  );
                })()}

                {/* Verbatim Transcript Textarea */}
                <div className="mt-1">
                  <textarea
                    rows={isCompactView ? 1 : 2}
                    value={seg.transcript}
                    onChange={(e) => updateSegmentField(seg.segment_id, 'transcript', e.target.value)}
                    placeholder="Type full verbatim transcription exactly as spoken..."
                    spellCheck={false}
                    data-gramm="false"
                    data-gramm_editor="false"
                    data-enable-grammarly="false"
                    autoCorrect="off"
                    autoCapitalize="off"
                    className={`w-full bg-[var(--kt-s1)] border border-[var(--kt-s4)] rounded ${isCompactView ? 'p-1.5 text-xs' : 'p-2 text-sm'} text-[var(--kt-text)] placeholder-slate-600 focus:border-[var(--kt-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--kt-accent)]/20 resize-y leading-relaxed font-sans transition-all`}
                  />
                  {/* SRT-06: Character counter with broadcast SRT line-length warning */}
                  <div className="flex items-center justify-between mt-0.5 px-0.5 text-[10px] font-mono">
                    <span className="text-slate-500">
                      {seg.words && seg.words.length > 0 ? `${seg.words.length} words` : `${(seg.transcript || '').trim().split(/\s+/).filter(Boolean).length} words`}
                    </span>
                    <span className={`${
                      (seg.transcript || '').length > 42
                        ? 'text-rose-400 font-bold bg-rose-500/15 px-1.5 py-0.2 rounded border border-rose-500/30'
                        : 'text-slate-500'
                    }`}>
                      {(seg.transcript || '').length} chars
                      {(seg.transcript || '').length > 42 && ' ⚠️ >42 (SRT limit)'}
                    </span>
                  </div>
                </div>

                {/* QC Rule Violations Badges */}
                {seg.qc_errors && seg.qc_errors.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {seg.qc_errors.map((err, errIdx) => (
                      <div
                        key={errIdx}
                        className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium border ${
                          err.severity === 'error'
                            ? 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                            : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                        }`}
                      >
                        {err.severity === 'error' ? (
                          <AlertCircle className="w-3 h-3 text-rose-400 shrink-0" />
                        ) : (
                          <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
                        )}
                        <span>{err.message}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
