import React, { useEffect, useRef, useState, useCallback } from 'react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';
import TimelinePlugin from 'wavesurfer.js/dist/plugins/timeline.esm.js';
import HoverPlugin from 'wavesurfer.js/dist/plugins/hover.esm.js';
import {
  Play, Pause, Square, RotateCcw, RotateCw, Volume2, VolumeX, ZoomIn, ZoomOut, Repeat,
  Scissors, GitMerge, ChevronLeft, ChevronRight, CornerDownRight, ArrowLeftToLine, ArrowRightToLine, Plus
} from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { themeColor, withAlpha, getSpeakerPalette, subscribeTheme } from '../theme/themeEngine';

export default function AudioWaveform({
  audioUrl,
  segments,
  currentSegmentId,
  setActiveSegmentId,
  onSegmentClick,
  onSegmentTimeChange,
  onSplitSegment,
  onMergeSegment,
  onAddSegmentAtTime,
  onTimeUpdate,
  onPlayStateChange,
  playTargetTime
}) {
  const containerRef = useRef(null);
  const timelineRef = useRef(null);
  const scrollWrapperRef = useRef(null);
  const wavesurferRef = useRef(null);
  const regionsPluginRef = useRef(null);
  const activeLoopRef = useRef(null);
  const isUpdatingRegionsFromProps = useRef(false);
  const { isDark } = useTheme();

  // Stale closure guards for external event listeners
  const onSegmentTimeChangeRef = useRef(onSegmentTimeChange);
  onSegmentTimeChangeRef.current = onSegmentTimeChange;

  const onTimeUpdateRef = useRef(onTimeUpdate);
  onTimeUpdateRef.current = onTimeUpdate;

  const onPlayStateChangeRef = useRef(onPlayStateChange);
  onPlayStateChangeRef.current = onPlayStateChange;

  const onSegmentClickRef = useRef(onSegmentClick);
  onSegmentClickRef.current = onSegmentClick;

  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;

  const currentSegmentIdRef = useRef(currentSegmentId);
  currentSegmentIdRef.current = currentSegmentId;

  const onSplitSegmentRef = useRef(onSplitSegment);
  onSplitSegmentRef.current = onSplitSegment;

  const onMergeSegmentRef = useRef(onMergeSegment);
  onMergeSegmentRef.current = onMergeSegment;

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [zoomLevel, setZoomLevel] = useState(35); // px per second
  const [isLoopingSegment, setIsLoopingSegment] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [activeLoopDisplay, setActiveLoopDisplay] = useState(null);
  const [draggedRegionInfo, setDraggedRegionInfo] = useState(null);

  // Current active segment lookup
  const activeSegment = (segments || []).find((s) => s.segment_id === currentSegmentId);

  // Core loop enforcer function
  const enforceLoop = useCallback((time) => {
    const loop = activeLoopRef.current;
    if (!loop || !loop.isLooping || !wavesurferRef.current) return;
    
    if (time >= loop.end - 0.02 || time < loop.start - 0.2) {
      try {
        wavesurferRef.current.setTime(loop.start);
        if (!wavesurferRef.current.isPlaying()) {
          wavesurferRef.current.play();
        }
      } catch (e) {
        console.error("Loop seek error:", e);
      }
    }
  }, []);

  // Handle external play/stop requests
  useEffect(() => {
    if (!playTargetTime || !isReady || !wavesurferRef.current) return;

    try {
      const startTime = parseFloat(playTargetTime.time) || 0;
      const endTime = playTargetTime.endTime !== undefined ? parseFloat(playTargetTime.endTime) : (startTime + 3.0);

      if (playTargetTime.pause) {
        activeLoopRef.current = null;
        setActiveLoopDisplay(null);
        setIsLoopingSegment(false);
        wavesurferRef.current.pause();
        wavesurferRef.current.setTime(startTime);
        setCurrentTime(startTime);
        setIsPlaying(false);
        return;
      }

      if (playTargetTime.loop) {
        activeLoopRef.current = {
          start: startTime,
          end: endTime,
          isLooping: true,
          segId: playTargetTime.segId
        };
        setActiveLoopDisplay({
          start: startTime,
          end: endTime,
          segId: playTargetTime.segId
        });
        setIsLoopingSegment(true);
      } else {
        activeLoopRef.current = null;
        setActiveLoopDisplay(null);
        setIsLoopingSegment(false);
      }

      wavesurferRef.current.setTime(startTime);
      wavesurferRef.current.play();
      setIsPlaying(true);
    } catch (e) {
      console.error("WaveSurfer play error:", e);
    }
  }, [playTargetTime, isReady]);

  // Initialize WaveSurfer with Timeline & Regions
  useEffect(() => {
    if (!containerRef.current || !audioUrl) return;

    setIsReady(false);
    if (wavesurferRef.current) {
      try {
        wavesurferRef.current.destroy();
      } catch (e) {}
    }

    const wsRegions = RegionsPlugin.create();
    regionsPluginRef.current = wsRegions;

    const wsTimeline = TimelinePlugin.create({
      height: 18,
      timeInterval: 0.5,
      primaryLabelInterval: 5,
      secondaryLabelInterval: 1,
      style: {
        fontSize: '9px',
        color: themeColor('faint'),
        fontWeight: '600'
      }
    });

    const wsHover = HoverPlugin.create({
      lineColor: themeColor('accent'),
      lineWidth: 2,
      labelBackground: themeColor('panel'),
      labelColor: themeColor('accent'),
      labelSize: '10px'
    });

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: withAlpha(themeColor('faint'), 0.45),
      progressColor: themeColor('accent'),
      cursorColor: themeColor('info'),
      cursorWidth: 2,
      height: 80,
      normalize: true,
      autoScroll: true,
      autoCenter: true,
      minPxPerSec: zoomLevel,
      url: audioUrl,
      plugins: [wsRegions, wsTimeline, wsHover]
    });

    // Handle Region drag & resize events (Subtitle Edit style direct timeline editing)
    const handleRegionUpdate = (region) => {
      if (isUpdatingRegionsFromProps.current) return;
      const segId = parseInt(region.id, 10);
      if (isNaN(segId)) return;

      const newStart = Math.max(0, Math.round(region.start * 1000) / 1000);
      const newEnd = Math.max(newStart + 0.1, Math.round(region.end * 1000) / 1000);

      setDraggedRegionInfo({
        segId: segId,
        start: newStart,
        end: newEnd,
        duration: Math.round((newEnd - newStart) * 1000) / 1000
      });

      if (onSegmentTimeChangeRef.current) {
        onSegmentTimeChangeRef.current(segId, newStart, newEnd);
      }
    };

    wsRegions.on('region-updated', handleRegionUpdate);

    wsRegions.on('region-update-end', (region) => {
      handleRegionUpdate(region);
      setTimeout(() => setDraggedRegionInfo(null), 1500);
    });

    wsRegions.on('region-clicked', (region, e) => {
      e.stopPropagation();
      const segId = parseInt(region.id, 10);
      if (onSegmentClickRef.current && segmentsRef.current) {
        const seg = segmentsRef.current.find((s) => s.segment_id === segId);
        if (seg) onSegmentClickRef.current(seg);
      }
    });

    ws.on('ready', () => {
      setIsReady(true);
      setDuration(ws.getDuration());
      setIsPlaying(false);
      try {
        ws.zoom(zoomLevel);
        ws.setPlaybackRate(playbackRate);
      } catch (e) {}
    });

    ws.on('play', () => { setIsPlaying(true); onPlayStateChangeRef.current?.(true); });
    ws.on('pause', () => { setIsPlaying(false); onPlayStateChangeRef.current?.(false); });
    
    ws.on('timeupdate', (time) => {
      setCurrentTime(time);
      onTimeUpdateRef.current?.(time);
      enforceLoop(time);
    });

    ws.on('audioprocess', (time) => {
      enforceLoop(time);
    });

    ws.on('finish', () => {
      if (activeLoopRef.current && activeLoopRef.current.isLooping) {
        try {
          ws.setTime(activeLoopRef.current.start);
          ws.play();
        } catch (e) {
          setIsPlaying(false);
        }
      } else {
        setIsPlaying(false);
      }
    });

    wavesurferRef.current = ws;
    const stopThemeWatch = subscribeTheme(() => {
      try {
        ws.setOptions({
          waveColor: withAlpha(themeColor('faint'), 0.45),
          progressColor: themeColor('accent'),
          cursorColor: themeColor('info'),
        });
      } catch { /* waveform already torn down */ }
    });

    return () => {
      // BUG-W7: Clear loop state on unmount/audio change to prevent stale loop refs
      stopThemeWatch();
      activeLoopRef.current = null;
      setIsLoopingSegment(false);
      setActiveLoopDisplay(null);
      try {
        ws.destroy();
      } catch (e) {}
      wavesurferRef.current = null;
      regionsPluginRef.current = null;
    };
  }, [audioUrl, enforceLoop, isDark]);

  // Synchronize on-waveform shaded regions with latest segments data
  useEffect(() => {
    const wsRegions = regionsPluginRef.current;
    if (!isReady || !wsRegions || !segments || segments.length === 0) return;

    isUpdatingRegionsFromProps.current = true;
    try {
      const existingRegions = wsRegions.getRegions() || [];
      const existingMap = new Map();
      existingRegions.forEach((r) => existingMap.set(String(r.id), r));

      const getSpeakerColor = (speakerName, isCurrent, hasErrors) => {
        if (hasErrors) return withAlpha(themeColor('danger'), 0.35); // QC errors
        if (isCurrent) return withAlpha(themeColor('accent'), 0.35); // active segment
        
        const palette = getSpeakerPalette().map((hex) => withAlpha(hex, 0.2));
        
        let hash = 0;
        const str = speakerName || 'Speaker 1';
        for (let i = 0; i < str.length; i++) {
          hash = str.charCodeAt(i) + ((hash << 5) - hash);
        }
        const index = Math.abs(hash) % palette.length;
        return palette[index];
      };

      segments.forEach((seg) => {
        const segIdStr = String(seg.segment_id);
        const isCurrent = seg.segment_id === currentSegmentId;
        const hasErrors = seg.qc_errors && seg.qc_errors.some(e => e.severity === 'error');

        const shadowColor = getSpeakerColor(seg.speaker, isCurrent, hasErrors);

        const snippet = (seg.transcript || '').trim();
        const shortSnippet = snippet.length > 28 ? snippet.slice(0, 28) + '...' : snippet;
        const contentStr = `#${seg.segment_id} ${seg.speaker || ''} ${shortSnippet ? `• "${shortSnippet}"` : ''}`;

        const existing = existingMap.get(segIdStr);

        if (existing) {
          if (Math.abs(existing.start - seg.start_time) > 0.005) {
            existing.start = seg.start_time;
          }
          if (Math.abs(existing.end - seg.end_time) > 0.005) {
            existing.end = seg.end_time;
          }
          existing.setOptions({
            color: shadowColor,
            content: contentStr,
            drag: true,
            resize: true
          });
          existingMap.delete(segIdStr);
        } else {
          wsRegions.addRegion({
            id: segIdStr,
            start: Math.max(0, seg.start_time),
            end: Math.max(seg.start_time + 0.1, seg.end_time),
            content: contentStr,
            color: shadowColor,
            drag: true,
            resize: true,
          });
        }
      });

      // Remove deleted regions
      existingMap.forEach((r) => r.remove());
    } catch (err) {
      console.error("Failed to sync shaded regions:", err);
    } finally {
      setTimeout(() => {
        isUpdatingRegionsFromProps.current = false;
      }, 50);
    }
  }, [segments, currentSegmentId, isReady]);

  // Zoom control
  useEffect(() => {
    if (isReady && wavesurferRef.current) {
      try {
        wavesurferRef.current.zoom(zoomLevel);
      } catch (e) {}
    }
  }, [zoomLevel, isReady]);

  // Playback rate
  useEffect(() => {
    if (isReady && wavesurferRef.current) {
      try {
        wavesurferRef.current.setPlaybackRate(playbackRate);
      } catch (e) {}
    }
  }, [playbackRate, isReady]);

  // Mute control
  useEffect(() => {
    if (isReady && wavesurferRef.current) {
      try {
        wavesurferRef.current.setMuted(isMuted);
      } catch (e) {}
    }
  }, [isMuted, isReady]);

  // Subtitle Edit Quick Actions
  const handleSetStartToCursor = () => {
    if (!activeSegment || !onSegmentTimeChangeRef.current) return;
    const newStart = Math.min(activeSegment.end_time - 0.1, Math.max(0, Math.round(currentTime * 1000) / 1000));
    onSegmentTimeChangeRef.current(activeSegment.segment_id, newStart, activeSegment.end_time);
  };

  const handleSetEndToCursor = () => {
    if (!activeSegment || !onSegmentTimeChangeRef.current) return;
    const newEnd = Math.max(activeSegment.start_time + 0.1, Math.min(duration || 9999, Math.round(currentTime * 1000) / 1000));
    onSegmentTimeChangeRef.current(activeSegment.segment_id, activeSegment.start_time, newEnd);
  };

  const handleNudgeStart = (delta) => {
    if (!activeSegment || !onSegmentTimeChangeRef.current) return;
    const newStart = Math.max(0, Math.min(activeSegment.end_time - 0.1, Math.round((activeSegment.start_time + delta) * 1000) / 1000));
    onSegmentTimeChangeRef.current(activeSegment.segment_id, newStart, activeSegment.end_time);
  };

  const handleNudgeEnd = (delta) => {
    if (!activeSegment || !onSegmentTimeChangeRef.current) return;
    const newEnd = Math.max(activeSegment.start_time + 0.1, Math.round((activeSegment.end_time + delta) * 1000) / 1000);
    onSegmentTimeChangeRef.current(activeSegment.segment_id, activeSegment.start_time, newEnd);
  };

  const handlePrevSegment = () => {
    if (!segments || segments.length === 0) return;
    const idx = segments.findIndex((s) => s.segment_id === currentSegmentId);
    if (idx > 0) {
      const prev = segments[idx - 1];
      if (setActiveSegmentId) setActiveSegmentId(prev.segment_id);
      if (wavesurferRef.current) wavesurferRef.current.setTime(prev.start_time);
    }
  };

  const handleNextSegment = () => {
    if (!segments || segments.length === 0) return;
    const idx = segments.findIndex((s) => s.segment_id === currentSegmentId);
    if (idx !== -1 && idx < segments.length - 1) {
      const next = segments[idx + 1];
      if (setActiveSegmentId) setActiveSegmentId(next.segment_id);
      if (wavesurferRef.current) wavesurferRef.current.setTime(next.start_time);
    }
  };

  // Global Keyboard Shortcuts (Subtitle Edit style: Space, Esc, [, ], S, M, L)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      
      if (e.code === 'Space') {
        e.preventDefault();
        toggleGlobalPlay();
      } else if (e.code === 'Escape') {
        e.preventDefault();
        stopAndReset();
      } else if (e.key === '[') {
        e.preventDefault();
        handleSetStartToCursor();
      } else if (e.key === ']') {
        e.preventDefault();
        handleSetEndToCursor();
      } else if (e.key === 's' || e.key === 'S') {
        if (onSplitSegmentRef.current && currentSegmentIdRef.current) {
          e.preventDefault();
          onSplitSegmentRef.current(currentSegmentIdRef.current, currentTime);
        }
      } else if (e.key === 'm' || e.key === 'M') {
        if (onMergeSegmentRef.current && currentSegmentIdRef.current) {
          e.preventDefault();
          onMergeSegmentRef.current(currentSegmentIdRef.current);
        }
      } else if (e.key === 'l' || e.key === 'L') {
        if (activeSegment) {
          e.preventDefault();
          playSegmentLoop(activeSegment.start_time, activeSegment.end_time, activeSegment.segment_id);
        }
      } else if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        handlePrevSegment();
      } else if (e.key === 'd' || e.key === 'D') {
        e.preventDefault();
        handleNextSegment();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isReady, currentTime, activeSegment]);

  // 1. PLAY BUTTON: Plays the ENTIRE audio continuously
  const toggleGlobalPlay = () => {
    if (isReady && wavesurferRef.current) {
      activeLoopRef.current = null;
      setActiveLoopDisplay(null);
      setIsLoopingSegment(false);

      try {
        wavesurferRef.current.playPause();
      } catch (e) {}
    }
  };

  // 2. SEGMENT LOOP PLAY: Plays only this specific segment in continuous loop
  const playSegmentLoop = (start, end, segId) => {
    if (isReady && wavesurferRef.current) {
      try {
        const s = parseFloat(start);
        const e = parseFloat(end);
        activeLoopRef.current = {
          start: s,
          end: e,
          isLooping: true,
          segId: segId
        };
        setActiveLoopDisplay({
          start: s,
          end: e,
          segId: segId
        });
        setIsLoopingSegment(true);
        wavesurferRef.current.setTime(s);
        wavesurferRef.current.play();
        setIsPlaying(true);
      } catch (err) {}
    }
  };

  // Dedicated Stop Button: Pauses and teleports marker to 00:00.000 (Start of entire audio)
  const stopAndReset = () => {
    if (isReady && wavesurferRef.current) {
      try {
        wavesurferRef.current.pause();
        setIsPlaying(false);
        activeLoopRef.current = null;
        setActiveLoopDisplay(null);
        setIsLoopingSegment(false);

        // Teleport marker to beginning of entire audio (0.0s)
        wavesurferRef.current.setTime(0);
        setCurrentTime(0);
      } catch (e) {}
    }
  };

  const clearLoopAndPlayFull = () => {
    activeLoopRef.current = null;
    setActiveLoopDisplay(null);
    setIsLoopingSegment(false);
  };

  const skip = (seconds) => {
    if (isReady && wavesurferRef.current) {
      try {
        const newTime = Math.max(0, Math.min(duration, currentTime + seconds));
        wavesurferRef.current.setTime(newTime);
      } catch (e) {}
    }
  };

  const formatTime = (secs) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    const ms = Math.floor((secs % 1) * 1000);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
  };

  const handleWaveformWheel = (e) => {
    if (scrollWrapperRef.current) {
      scrollWrapperRef.current.scrollLeft += e.deltaY;
    }
  };

  return (
    <div className="bg-[var(--kt-s1)] border border-[var(--kt-s4)] rounded-lg p-2.5 shadow-sm transition-all space-y-2">
      {/* Waveform Canvas with Integrated Millisecond Timeline Ruler & Hover Cursor */}
      <div 
        ref={scrollWrapperRef}
        onWheel={handleWaveformWheel}
        className="relative bg-[var(--kt-s0)] rounded-lg p-2 border border-[var(--kt-s4)] overflow-x-auto shadow-inner select-none"
      >
        {/* Live Drag & Edit Tooltip */}
        {draggedRegionInfo && (
          <div className="absolute top-2 right-3 z-50 bg-[var(--kt-s2)]/95 text-white text-[11px] font-mono font-bold px-3 py-1 rounded-md shadow-xl border border-[var(--kt-accent)]/50 flex items-center gap-2 pointer-events-none animate-in fade-in">
            <span className="text-[var(--kt-accent)] font-black">#{draggedRegionInfo.segId}</span>
            <span className="text-emerald-400 font-bold">{formatTime(draggedRegionInfo.start)}</span>
            <span className="text-slate-500">➔</span>
            <span className="text-rose-400 font-bold">{formatTime(draggedRegionInfo.end)}</span>
            <span className="bg-[var(--kt-accent)]/15 text-[var(--kt-accent)] border border-[var(--kt-accent)]/30 px-1.5 py-0.2 rounded text-[10px]">
              {draggedRegionInfo.duration.toFixed(3)}s
            </span>
          </div>
        )}

        <div ref={containerRef} className="cursor-pointer min-w-full" />
      </div>

      {/* Subtitle Edit Studio Action Bar for Active Segment */}
      {activeSegment && (
        <div className="bg-[var(--kt-s2)] border border-[var(--kt-s4)] rounded-md px-3 py-1.5 flex flex-wrap items-center justify-between gap-2 text-xs">
          {/* Active Segment Badge & Speaker Info */}
          <div className="flex items-center gap-2 font-mono">
            <span className="bg-[var(--kt-accent)] text-black font-bold px-2 py-0.5 rounded text-[11px] shadow-xs">
              Segment #{activeSegment.segment_id}
            </span>
            <span className="font-bold text-slate-200">{activeSegment.speaker}</span>
            <span className="text-[11px] text-slate-400 font-medium">
              ({formatTime(activeSegment.start_time)} - {formatTime(activeSegment.end_time)} | {activeSegment.duration.toFixed(3)}s)
            </span>
          </div>

          {/* Quick Subtitle Edit Buttons */}
          <div className="flex flex-wrap items-center gap-1">
            {/* Set Start / End to Current Cursor */}
            <button
              onClick={handleSetStartToCursor}
              title="Set Start to Current Playhead Cursor (Hotkey: [ )"
              className="inline-flex items-center gap-1 px-2 py-1 bg-[var(--kt-s3)] hover:bg-[var(--kt-s4)] text-slate-200 border border-[var(--kt-s5)] rounded text-[11px] font-semibold shadow-xs transition-all active:scale-95 cursor-pointer"
            >
              <ArrowLeftToLine className="w-3 h-3 text-[var(--kt-accent)]" />
              <span>Set Start [</span>
            </button>

            <button
              onClick={handleSetEndToCursor}
              title="Set End to Current Playhead Cursor (Hotkey: ] )"
              className="inline-flex items-center gap-1 px-2 py-1 bg-[var(--kt-s3)] hover:bg-[var(--kt-s4)] text-slate-200 border border-[var(--kt-s5)] rounded text-[11px] font-semibold shadow-xs transition-all active:scale-95 cursor-pointer"
            >
              <ArrowRightToLine className="w-3 h-3 text-[var(--kt-accent)]" />
              <span>Set End ]</span>
            </button>

            {/* Split at Cursor */}
            <button
              onClick={() => onSplitSegmentRef.current && onSplitSegmentRef.current(activeSegment.segment_id, currentTime)}
              title="Split Dialogue at Current Playhead Cursor (Hotkey: S )"
              className="inline-flex items-center gap-1 px-2 py-1 bg-[var(--kt-s3)] hover:bg-[var(--kt-s4)] text-amber-300 border border-amber-500/30 rounded text-[11px] font-semibold shadow-xs transition-all active:scale-95 cursor-pointer"
            >
              <Scissors className="w-3 h-3 text-amber-400" />
              <span>Split (S)</span>
            </button>

            {/* Merge with Next */}
            <button
              onClick={() => onMergeSegmentRef.current && onMergeSegmentRef.current(activeSegment.segment_id)}
              title="Merge with Next Dialogue (Hotkey: M )"
              className="inline-flex items-center gap-1 px-2 py-1 bg-[var(--kt-s3)] hover:bg-[var(--kt-s4)] text-slate-200 border border-[var(--kt-s5)] rounded text-[11px] font-semibold shadow-xs transition-all active:scale-95 cursor-pointer"
            >
              <GitMerge className="w-3 h-3 text-slate-400" />
              <span>Merge (M)</span>
            </button>

            {/* Add New Segment at Current Playhead (FEAT-11) */}
            {onAddSegmentAtTime && (
              <button
                onClick={() => onAddSegmentAtTime(currentTime)}
                title="Add New Blank Segment at Playhead"
                className="inline-flex items-center gap-1 px-2 py-1 bg-[var(--kt-s3)] hover:bg-[var(--kt-s4)] text-[var(--kt-accent)] border border-[var(--kt-accent)]/30 rounded text-[11px] font-semibold shadow-xs transition-all active:scale-95 cursor-pointer"
              >
                <Plus className="w-3 h-3" />
                <span>Add at Cursor</span>
              </button>
            )}

            {/* Micro Nudges */}
            <div className="flex items-center bg-[var(--kt-s3)] border border-[var(--kt-s5)] rounded p-0.5 text-[10px] font-mono text-slate-300">
              <button 
                onClick={() => handleNudgeStart(-0.05)} 
                title="Start -50ms" 
                className="px-1 hover:bg-[var(--kt-s4)] rounded text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                ◀-50ms
              </button>
              <span className="text-slate-600">|</span>
              <button 
                onClick={() => handleNudgeStart(0.05)} 
                title="Start +50ms" 
                className="px-1 hover:bg-[var(--kt-s4)] rounded text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                +50ms▶
              </button>
            </div>

            {/* Dialogue Jumpers */}
            <div className="flex items-center gap-0.5 pl-1">
              <button
                onClick={handlePrevSegment}
                title="Jump to Previous Dialogue (Hotkey: A)"
                className="p-1 text-slate-300 hover:text-white bg-[var(--kt-s3)] hover:bg-[var(--kt-s4)] border border-[var(--kt-s5)] rounded cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handleNextSegment}
                title="Jump to Next Dialogue (Hotkey: D)"
                className="p-1 text-slate-300 hover:text-white bg-[var(--kt-s3)] hover:bg-[var(--kt-s4)] border border-[var(--kt-s5)] rounded cursor-pointer"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transport Controls Bar (Sleek Studio Single Line) */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        {/* Left: Global Play (Entire Audio), Loop Segment, Stop & Timecode */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => skip(-2)}
            title="Rewind 2s"
            className="p-1.5 text-slate-300 hover:text-white bg-[var(--kt-s2)] hover:bg-[var(--kt-s3)] border border-[var(--kt-s4)] rounded transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          {/* 1. MAIN PLAY BUTTON: Plays the ENTIRE audio continuously */}
          <button
            onClick={toggleGlobalPlay}
            title={isPlaying && !isLoopingSegment ? "Pause (Spacebar)" : "Play Entire Audio (Spacebar)"}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--kt-accent)] hover:bg-[var(--kt-accent-strong)] text-black rounded font-bold shadow-[0_0_12px_rgba(var(--kt-accent-rgb),0.25)] transition-transform active:scale-95 cursor-pointer"
          >
            {isPlaying && !isLoopingSegment ? (
              <>
                <Pause className="w-3.5 h-3.5 fill-current" />
                <span>Pause</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                <span>Play All</span>
              </>
            )}
          </button>

          {/* Dedicated Stop Button */}
          <button
            onClick={stopAndReset}
            title="Stop & Reset to Start of Audio 00:00.000 (Escape)"
            className="flex items-center justify-center p-2 bg-[#ff4757] hover:bg-[#ff3848] text-white rounded shadow-xs transition-transform active:scale-95 cursor-pointer"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
          </button>

          <button
            onClick={() => skip(2)}
            title="Forward 2s"
            className="p-1.5 text-slate-300 hover:text-white bg-[var(--kt-s2)] hover:bg-[var(--kt-s3)] border border-[var(--kt-s4)] rounded transition-colors cursor-pointer"
          >
            <RotateCw className="w-3.5 h-3.5" />
          </button>

          {/* Compact Timecode */}
          <div className="font-mono text-[11px] text-slate-300 bg-[var(--kt-s2)] px-2.5 py-1 rounded border border-[var(--kt-s4)] flex items-center gap-1.5 shadow-xs">
            <span className="text-[var(--kt-accent)] font-bold">{formatTime(currentTime)}</span>
            <span className="text-slate-600">/</span>
            <span className="text-slate-400 font-medium">{formatTime(duration)}</span>
          </div>

          {/* Segment Loop Active Banner */}
          {activeLoopDisplay && isLoopingSegment && (
            <div className="inline-flex items-center gap-1.5 bg-[var(--kt-s2)] text-amber-300 border border-amber-500/40 px-2 py-0.5 rounded text-[11px] font-bold animate-in fade-in">
              <Repeat className="w-3 h-3 text-amber-400 animate-spin" />
              <span>
                Looping #{activeLoopDisplay.segId || ''} ({formatTime(activeLoopDisplay.start)} - {formatTime(activeLoopDisplay.end)})
              </span>
              <button
                onClick={clearLoopAndPlayFull}
                className="hover:text-rose-400 ml-1 p-0.5 bg-amber-950/40 border border-amber-500/30 rounded text-[10px] px-1 font-semibold cursor-pointer"
                title="Switch to playing entire audio"
              >
                Exit Loop (Play All)
              </button>
            </div>
          )}
        </div>

        {/* Center: Playback Speed */}
        <div className="flex items-center gap-1 bg-[var(--kt-s2)] p-0.5 rounded border border-[var(--kt-s4)] text-[11px]">
          {[0.8, 1.0, 1.25, 1.5].map((rate) => (
            <button
              key={rate}
              onClick={() => setPlaybackRate(rate)}
              className={`px-2 py-0.5 rounded font-medium transition-all cursor-pointer ${
                playbackRate === rate
                  ? 'bg-[var(--kt-accent)] text-black font-bold shadow-xs'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {rate}x
            </button>
          ))}
        </div>

        {/* Right: Zoom & Volume */}
        <div className="flex items-center gap-2">
          {/* Scroll / Zoom Controls */}
          <div className="flex items-center gap-1 text-[11px] text-slate-400 bg-[var(--kt-s2)] px-2 py-1 rounded border border-[var(--kt-s4)]">
            <button 
              onClick={() => setZoomLevel(Math.max(10, zoomLevel - 10))}
              title="Zoom Out (Scroll wider)"
              className="hover:text-white cursor-pointer"
            >
              <ZoomOut className="w-3 h-3" />
            </button>
            <input
              type="range"
              min="10"
              max="150"
              value={zoomLevel}
              onChange={(e) => setZoomLevel(Number(e.target.value))}
              className="w-16 accent-[var(--kt-accent)] cursor-pointer h-1 bg-[var(--kt-s3)] rounded"
              title={`Zoom: ${zoomLevel}px/s (Scroll with mouse wheel)`}
            />
            <button 
              onClick={() => setZoomLevel(Math.min(150, zoomLevel + 10))}
              title="Zoom In (Scroll closer)"
              className="hover:text-white cursor-pointer"
            >
              <ZoomIn className="w-3 h-3" />
            </button>
            <span className="font-mono text-[10px] text-slate-500 pl-0.5">{zoomLevel}x</span>
          </div>

          <button
            onClick={() => setIsMuted(!isMuted)}
            title={isMuted ? 'Unmute' : 'Mute'}
            className="p-1.5 text-slate-300 hover:text-white bg-[var(--kt-s2)] hover:bg-[var(--kt-s3)] border border-[var(--kt-s4)] rounded transition-colors cursor-pointer"
          >
            {isMuted ? <VolumeX className="w-3.5 h-3.5 text-rose-500" /> : <Volume2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
    </div>
  );
}
