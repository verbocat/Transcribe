import React, { useRef, useState, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import { ZoomIn, ZoomOut, Volume2, Split, Plus, AlertCircle, CheckCircle2, GripVertical, FastForward, Sun, Moon, Play } from 'lucide-react';

// Helper formatting for timecode
function formatTime(seconds) {
  if (isNaN(seconds) || seconds == null) return "00:00.000";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

// ── Memoized Timeline Subtitle Box (Zero Re-render on Playhead Movement) ──
const TimelineSubtitleBlock = React.memo(function TimelineSubtitleBlock({
  event,
  zoomLevel,
  isActive,
  effectiveDuration,
  cplLimit,
  cpsLimit,
  setActiveEventId,
  onSeek,
  handleMouseDown,
  isInternalSeekRef,
  scrollRef
}) {
  const start = event.start_time !== undefined ? event.start_time : (event.start !== undefined ? event.start : 0);
  const end = event.end_time !== undefined ? event.end_time : (event.end !== undefined ? event.end : 0);
  const startX = start * zoomLevel;
  const width = Math.max((end - start) * zoomLevel, 14);
  const id = event.id ?? event.event_id;
  const errors = (event.qc_errors || event.errors || []).filter(err => {
    const rid = (err.rule_id || '').toUpperCase();
    const msg = (err.message || '').toLowerCase();
    return !rid.includes('PYRAMID') && !msg.includes('pyramid') && !msg.includes('bottom-heavy');
  });

  const text = event.text || '';
  const lines = text.split('\n');
  const lineCpl = lines.map(l => l.replace(/<[^>]+>/g, '').trim().length);
  const maxCpl = Math.max(...lineCpl, 0);
  const dur = Math.max(0.1, end - start);
  const calcCps = event.cps ? event.cps : (dur > 0 ? (text.replace(/<[^>]+>/g, '').trim().length / dur) : 0);

  const hasCplError = maxCpl > cplLimit || errors.some(e => (e.rule_id || '').includes('CPL'));
  const hasHardError = errors.some(e => (e.severity === 'error' || !e.severity) && !(e.rule_id || '').includes('CPS'));
  const isRed = hasHardError || hasCplError;
  const isYellow = !isRed && (calcCps > cpsLimit || errors.some(e => (e.rule_id || '').includes('CPS')));

  return (
    <div
      key={id}
      className={`absolute top-0.5 bottom-0.5 rounded-[4px] flex flex-col pointer-events-auto select-none transition-colors shadow-xs ${isActive
        ? 'border-2 border-[#00e5be] bg-[#00e5be]/15 text-white z-30 shadow-[0_0_12px_rgba(0,229,190,0.3)] ring-1 ring-[#00e5be]/40 backdrop-blur-[1px]'
        : 'z-20 hover:brightness-110'
        } ${isRed
          ? 'bg-rose-950/40 border-2 border-rose-500 text-rose-100 backdrop-blur-[1px]'
          : isYellow
            ? 'bg-amber-950/40 border-2 border-amber-400 text-amber-100 backdrop-blur-[1px]'
            : 'bg-[#181920]/85 border border-[#262734] text-slate-200 backdrop-blur-[1px]'
        }`}
      style={{ left: `${startX}px`, width: `${width}px` }}
      onClick={(e) => {
        e.stopPropagation();
        if (isInternalSeekRef) isInternalSeekRef.current = true;
        const rect = scrollRef.current?.getBoundingClientRect();
        if (rect) {
          const clickX = e.clientX - rect.left + scrollRef.current.scrollLeft;
          const clickedTime = Math.max(0, Math.min(effectiveDuration, clickX / zoomLevel));
          setActiveEventId(id);
          onSeek(clickedTime);
        } else {
          setActiveEventId(id);
          onSeek(start);
        }
      }}
    >
      {/* Active Top Glowing Accent Line */}
      {isActive && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-[#00e5be] shadow-[0_0_8px_rgba(0,229,190,1)] z-30" />
      )}

      {/* Left Trim Handle (In-Point) */}
      <div
        onMouseDown={(e) => handleMouseDown(e, id, 'resize-start')}
        className="absolute left-0 top-0 bottom-0 w-2.5 cursor-col-resize hover:bg-[#00e5be] flex items-center justify-center z-30 group/handle bg-black/30"
        title="Drag to trim In-Point"
      >
        <div className="w-0.5 h-7 bg-[#00e5be] group-hover/handle:bg-white transition-all" />
      </div>

      {/* Body Drag Area (Move Entire Subtitle) */}
      <div
        onMouseDown={(e) => handleMouseDown(e, id, 'move')}
        className="flex-1 px-2 py-0.5 flex flex-col justify-between cursor-grab active:cursor-grabbing overflow-hidden min-h-0"
        title="Click & drag to move subtitle block"
      >
        {/* Top Meta Bar */}
        <div className="flex items-center justify-between text-[9px] font-mono border-b border-[#262734] pb-0.5 shrink-0">
          <span className="font-bold px-1.5 py-0.2 rounded bg-[#00e5be] text-black font-mono shadow-2xs">
            #{id}
          </span>
          <div className="flex items-center gap-1">
            <span className="font-bold">{dur.toFixed(2)}s</span>
            {isRed ? (
              <span className="bg-rose-600 text-white text-[8px] font-bold px-1 rounded shadow-xs">
                {hasCplError ? `${maxCpl}L` : 'ERR'}
              </span>
            ) : isYellow ? (
              <span className="bg-amber-500 text-slate-950 text-[8px] font-bold px-1 rounded shadow-xs">
                {calcCps.toFixed(1)} CPS
              </span>
            ) : (
              <CheckCircle2 className="w-3 h-3 text-[#00e5be] shrink-0" />
            )}
          </div>
        </div>

        {/* Dialogue Line Text in center */}
        <div className="text-[11px] leading-tight line-clamp-2 font-sans font-bold whitespace-pre-wrap my-auto px-0.5 text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.95)] overflow-hidden">
          {event.text}
        </div>

        {/* Bottom Timecode Readout */}
        <div className="text-[8.5px] font-mono flex justify-between shrink-0 font-bold text-slate-300">
          <span>{formatTime(start)}</span>
          <span>{formatTime(end)}</span>
        </div>
      </div>

      {/* Right Trim Handle (Out-Point) */}
      <div
        onMouseDown={(e) => handleMouseDown(e, id, 'resize-end')}
        className="absolute right-0 top-0 bottom-0 w-2.5 cursor-col-resize hover:bg-[#00e5be] flex items-center justify-center z-30 group/handle bg-black/30"
        title="Drag to trim Out-Point"
      >
        <div className="w-0.5 h-7 bg-[#00e5be] group-hover/handle:bg-white transition-all" />
      </div>
    </div>
  );
});

export default function AudioWaveformTimeline({
  videoUrl = null,
  selectedFile = null,
  videoId = null,
  initialPeaks = [],
  API_BASE = '',
  events = [],
  shotChanges = [],
  activeEventId = null,
  setActiveEventId = () => { },
  currentTime = 0,
  duration = 0,
  onEventTimeChange = () => { },
  onSeek = () => { },
  onAddSubtitleAtTime = null,
  onShiftAllFollowing = null,
  onContinueFromTime = null,
  frameRate = 24.0,
  cpsLimit = 20,
  cplLimit = 42,
  theme = 'dark', // 'dark' | 'light'
}) {
  const [zoomLevel, setZoomLevel] = useState(70); // pixels per second (25 - 250)
  const [waveformPeaks, setWaveformPeaks] = useState(initialPeaks || []); // Array of float 0-1
  const [waveformPointsPerSec, setWaveformPointsPerSec] = useState(50);
  const [isAudioLoading, setIsAudioLoading] = useState(false);

  const containerRef = useRef(null);
  const scrollRef = useRef(null);
  const canvasRef = useRef(null);
  const lastActiveIdRef = useRef(activeEventId);
  const lastTimeRef = useRef(currentTime);

  // Instant reactive binding when initialPeaks arrive from upload response
  useEffect(() => {
    if (initialPeaks && initialPeaks.length > 0) {
      setWaveformPeaks(initialPeaks);
      setIsAudioLoading(false);
    }
  }, [initialPeaks]);

  // Center-oriented zoom tracking
  const zoomCenterTimeRef = useRef(null);
  const isZoomingRef = useRef(false);

  // Dragging State for Subtitle Blocks
  const [dragState, setDragState] = useState(null);
  const [dragTooltip, setDragTooltip] = useState(null); // { x, timeStr, durStr }
  const [viewportScroll, setViewportScroll] = useState({ scrollLeft: 0, clientWidth: 1000 });

  const isDark = theme === 'dark';

  // Normalized helpers (with pyramid errors purged)
  const getStart = (e) => (e.start_time !== undefined ? e.start_time : (e.start !== undefined ? e.start : 0));
  const getEnd = (e) => (e.end_time !== undefined ? e.end_time : (e.end !== undefined ? e.end : 0));
  const getErrors = (e) => (e.qc_errors || e.errors || []).filter(err => {
    const rid = (err.rule_id || '').toUpperCase();
    const msg = (err.message || '').toLowerCase();
    return !rid.includes('PYRAMID') && !msg.includes('pyramid') && !msg.includes('bottom-heavy');
  });

  const effectiveDuration = Math.max(
    duration || 0,
    events.length > 0 ? Math.max(...events.map(e => getEnd(e))) + 5 : 30
  );

  const timelineWidth = Math.max(effectiveDuration * zoomLevel, scrollRef.current?.clientWidth || 900);

  // Viewport subtitle filtering: only render events within [visibleStartTime, visibleEndTime] with a 15-second buffer
  const bufferSec = 15;
  const visibleStartTime = Math.max(0, (viewportScroll.scrollLeft / zoomLevel) - bufferSec);
  const visibleEndTime = ((viewportScroll.scrollLeft + viewportScroll.clientWidth) / zoomLevel) + bufferSec;

  const visibleTimelineEvents = useMemo(() => {
    return events.filter(e => {
      const st = e.start_time !== undefined ? e.start_time : (e.start !== undefined ? e.start : 0);
      const en = e.end_time !== undefined ? e.end_time : (e.end !== undefined ? e.end : 0);
      return en >= visibleStartTime && st <= visibleEndTime;
    });
  }, [events, visibleStartTime, visibleEndTime]);

  // ── 1. High-Precision Acoustic Waveform Extraction (Instant Loading & Fast Cache) ──
  useEffect(() => {
    let isCancelled = false;

    const loadWaveform = async () => {
      // Priority 0: Instant Initial Peaks or Fast Session Storage Cache (< 1ms)
      if (initialPeaks && initialPeaks.length > 0) {
        setWaveformPeaks(initialPeaks);
        setIsAudioLoading(false);
        return;
      }

      // Priority 1: Backend Acoustic Peaks Endpoint (Only if video has an assigned videoId from backend)
      if (videoId && (videoId.includes('_') || videoId.startsWith('up_') || videoId.length >= 10)) {
        try {
          const cached = sessionStorage.getItem(`karya_peaks_${videoId}`);
          if (cached) {
            const parsed = JSON.parse(cached);
            if (parsed && parsed.length > 0) {
              setWaveformPeaks(parsed);
              setIsAudioLoading(false);
              return;
            }
          }
        } catch (_) { }

        try {
          setIsAudioLoading(true);
          const base = API_BASE || '';
          const res = await fetch(`${base}/api/subtitle/waveform/${encodeURIComponent(videoId)}`);
          if (res.ok) {
            const data = await res.json();
            if (!isCancelled && data.peaks && data.peaks.length > 0) {
              setWaveformPeaks(data.peaks);
              setWaveformPointsPerSec(data.points_per_sec || 50);
              setIsAudioLoading(false);
              try {
                sessionStorage.setItem(`karya_peaks_${videoId}`, JSON.stringify(data.peaks));
              } catch (_) { }
              return;
            }
          }
        } catch (_) {
          // Graceful fallback to client audio decoding
        }
      }

      // Priority 2: Web Audio API decoding with Peak + RMS Envelope Dynamics (for files < 80MB)
      if ((selectedFile || videoUrl) && (!selectedFile || selectedFile.size < 80 * 1024 * 1024)) {
        try {
          setIsAudioLoading(true);
          let arrayBuffer;
          if (selectedFile) {
            arrayBuffer = await selectedFile.arrayBuffer();
          } else {
            const res = await fetch(videoUrl);
            arrayBuffer = await res.arrayBuffer();
          }

          if (isCancelled) return;

          const AudioContextClass = window.AudioContext || window.webkitAudioContext;
          const audioCtx = new AudioContextClass();
          const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

          if (isCancelled) return;

          const channelData = audioBuffer.getChannelData(0);
          const pps = 50; // 50 points per second
          const totalPoints = Math.floor(audioBuffer.duration * pps);
          const blockSize = Math.floor(channelData.length / totalPoints);
          const peaks = new Float32Array(totalPoints);

          for (let i = 0; i < totalPoints; i++) {
            const start = i * blockSize;
            let maxVal = 0;
            let sumSq = 0;
            const step = Math.max(1, Math.floor(blockSize / 32));
            let count = 0;
            for (let j = 0; j < blockSize; j += step) {
              const val = Math.abs(channelData[start + j]);
              if (val > maxVal) maxVal = val;
              sumSq += val * val;
              count++;
            }
            const rms = count > 0 ? Math.sqrt(sumSq / count) : 0;
            peaks[i] = 0.6 * maxVal + 0.4 * (rms * 2.5);
          }

          let maxObserved = 0.01;
          for (let i = 0; i < totalPoints; i++) {
            if (peaks[i] > maxObserved) maxObserved = peaks[i];
          }
          const norm = maxObserved > 1e-4 ? maxObserved : 1.0;
          const normalized = new Float32Array(totalPoints);
          for (let i = 0; i < totalPoints; i++) {
            normalized[i] = Math.max(0.02, Math.min(1.0, peaks[i] / norm));
          }

          if (!isCancelled) {
            setWaveformPeaks(Array.from(normalized));
            setWaveformPointsPerSec(pps);
          }
          audioCtx.close();
        } catch (err) {
          console.warn("Client audio decoding skipped, waiting for backend waveform:", err);
        } finally {
          if (!isCancelled) setIsAudioLoading(false);
        }
      }
    };

    loadWaveform();
    return () => { isCancelled = true; };
  }, [videoId, videoUrl, selectedFile, initialPeaks, API_BASE]);

  // ── 2. Viewport-Based Acoustic Waveform Renderer (Supports 40+ min media without canvas crashes) ──
  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    const scrollElem = scrollRef.current;
    if (!canvas || !scrollElem) return;

    const viewportWidth = Math.max(scrollElem.clientWidth || 900, 400);
    const scrollLeft = scrollElem.scrollLeft || 0;
    const clientH = scrollElem.clientHeight || 140;
    const height = Math.max(clientH, 50);

    if (canvas.width !== viewportWidth) {
      canvas.width = viewportWidth;
    }
    if (canvas.height !== height) {
      canvas.height = height;
    }

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, viewportWidth, height);

    const centerY = Math.floor(height / 2) + 4;
    const maxAmplitude = Math.max(10, (height - 28) * 0.38);

    // Center baseline
    ctx.strokeStyle = 'rgba(70, 85, 115, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(viewportWidth, centerY);
    ctx.stroke();

    if (!waveformPeaks || waveformPeaks.length === 0) return;

    const totalPoints = waveformPeaks.length;
    const pps = waveformPointsPerSec || 50;
    const stepX = zoomLevel / pps;

    // Viewport sample range: only draw samples visible in [scrollLeft - 20, scrollLeft + viewportWidth + 20]
    const startIdx = Math.max(0, Math.floor((scrollLeft - 20) / stepX));
    const endIdx = Math.min(totalPoints, Math.ceil((scrollLeft + viewportWidth + 20) / stepX));

    if (endIdx <= startIdx) return;

    // Upper envelope
    ctx.beginPath();
    const firstX = (startIdx * stepX) - scrollLeft;
    ctx.moveTo(firstX, centerY);

    for (let i = startIdx; i < endIdx; i++) {
      const x = (i * stepX) - scrollLeft;
      const amp = waveformPeaks[i] || 0.02;
      const y = centerY - (amp * maxAmplitude);
      ctx.lineTo(x, y);
    }
    const lastX = ((endIdx - 1) * stepX) - scrollLeft;
    ctx.lineTo(lastX, centerY);

    // Lower envelope (mirrored)
    for (let i = endIdx - 1; i >= startIdx; i--) {
      const x = (i * stepX) - scrollLeft;
      const amp = waveformPeaks[i] || 0.02;
      const y = centerY + (amp * maxAmplitude);
      ctx.lineTo(x, y);
    }
    ctx.closePath();

    // Clean gradient fill
    const fillGradient = ctx.createLinearGradient(0, centerY - maxAmplitude, 0, centerY + maxAmplitude);
    fillGradient.addColorStop(0, 'rgba(0, 229, 190, 0.35)');
    fillGradient.addColorStop(0.5, 'rgba(0, 229, 255, 0.50)');
    fillGradient.addColorStop(1, 'rgba(0, 229, 190, 0.35)');

    ctx.fillStyle = fillGradient;
    ctx.fill();

    // Crisp continuous outline stroke
    ctx.strokeStyle = 'rgba(0, 229, 190, 0.90)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }, [waveformPeaks, waveformPointsPerSec, zoomLevel]);

  // Redraw when peaks, pps, or zoom changes
  useEffect(() => {
    drawWaveform();
  }, [drawWaveform]);

  // Redraw on horizontal scroll or window/container resize (60FPS via requestAnimationFrame)
  useEffect(() => {
    const scrollElem = scrollRef.current;
    if (!scrollElem) return;

    let rafId = null;
    const handleScrollOrResize = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        drawWaveform();
        if (scrollElem) {
          setViewportScroll({
            scrollLeft: scrollElem.scrollLeft,
            clientWidth: scrollElem.clientWidth || 1000
          });
        }
      });
    };

    handleScrollOrResize();

    scrollElem.addEventListener('scroll', handleScrollOrResize, { passive: true });
    window.addEventListener('resize', handleScrollOrResize);

    const resizeObserver = new ResizeObserver(() => {
      handleScrollOrResize();
    });
    resizeObserver.observe(scrollElem);

    return () => {
      resizeObserver.disconnect();
      scrollElem.removeEventListener('scroll', handleScrollOrResize);
      window.removeEventListener('resize', handleScrollOrResize);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [drawWaveform]);

  // ── 3. Left-Oriented Zoom Controller (Left edge anchored, right edge expands/contracts) ──
  const handleZoomChange = useCallback((newZoom) => {
    const nextZoom = Math.max(25, Math.min(250, newZoom));
    const scrollElem = scrollRef.current;
    if (scrollElem) {
      // Left-anchored: time at the left edge of the visible screen stays fixed at the left edge
      const leftTime = scrollElem.scrollLeft / zoomLevel;
      zoomCenterTimeRef.current = leftTime;
      isZoomingRef.current = true;
    }
    setZoomLevel(nextZoom);
  }, [zoomLevel]);

  // Synchronous Re-Anchoring after Zoom Level Change
  useLayoutEffect(() => {
    if (!isZoomingRef.current || zoomCenterTimeRef.current === null) return;
    const scrollElem = scrollRef.current;
    if (scrollElem) {
      const leftTime = zoomCenterTimeRef.current;
      const targetScroll = leftTime * zoomLevel;
      scrollElem.scrollLeft = Math.max(0, targetScroll);
    }
    isZoomingRef.current = false;
    zoomCenterTimeRef.current = null;
  }, [zoomLevel]);

  // ── 4. Mouse Wheel: Inverted Scroll & Ctrl+Wheel Left-Anchored Zoom ──
  useEffect(() => {
    const scrollElem = scrollRef.current;
    if (!scrollElem) return;

    const handleWheel = (e) => {
      // Ctrl/Cmd + Wheel = Left-anchored zoom in/out
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const zoomDelta = e.deltaY < 0 ? 12 : -12;
        handleZoomChange(zoomLevel + zoomDelta);
        return;
      }

      if (Math.abs(e.deltaY) > 0 || Math.abs(e.deltaX) > 0) {
        e.preventDefault();
        const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        // Invert horizontal scroll as requested
        scrollElem.scrollLeft -= delta * 1.5;
      }
    };

    scrollElem.addEventListener('wheel', handleWheel, { passive: false });
    return () => scrollElem.removeEventListener('wheel', handleWheel);
  }, [zoomLevel, handleZoomChange]);

  // ── 5. Smart Viewport Tracking (Smooth playback auto-scroll, zero jumps on click or zoom) ──
  const isInternalSeekRef = useRef(false);

  useEffect(() => {
    const scrollElem = scrollRef.current;
    if (!scrollElem || dragState || isZoomingRef.current) return;

    // If the user clicked inside the timeline or subtitle, keep viewport steady exactly where user clicked!
    if (isInternalSeekRef.current) {
      isInternalSeekRef.current = false;
      lastTimeRef.current = currentTime;
      lastActiveIdRef.current = activeEventId;
      return;
    }

    const clientWidth = scrollElem.clientWidth || 900;
    const playheadX = currentTime * zoomLevel;
    const currentScroll = scrollElem.scrollLeft;
    const prevTime = lastTimeRef.current;
    const activeChanged = activeEventId !== lastActiveIdRef.current;

    lastTimeRef.current = currentTime;
    lastActiveIdRef.current = activeEventId;

    const minVisibleX = currentScroll;
    const maxVisibleX = currentScroll + clientWidth;
    const isInFrame = playheadX >= minVisibleX && playheadX <= maxVisibleX;

    // If active event was changed externally (e.g. from Spreadsheet) and is off-screen -> teleport to it
    if (activeChanged && !isInFrame) {
      scrollElem.scrollLeft = Math.max(0, playheadX - clientWidth * 0.2);
      return;
    }

    // Normal continuous playback: advance viewport when playhead reaches right screen edge
    if (playheadX > maxVisibleX - clientWidth * 0.05) {
      scrollElem.scrollLeft = Math.max(0, playheadX - clientWidth * 0.15);
    }
  }, [currentTime, activeEventId, zoomLevel, dragState]);

  // ── 5. Drag & Drop Handlers for Subtitle Blocks ──
  const handleMouseDown = (e, eventId, actionType) => {
    e.stopPropagation();
    e.preventDefault();

    const targetEvent = events.find(ev => (ev.id === eventId || ev.event_id === eventId));
    if (!targetEvent) return;

    setActiveEventId(eventId);

    const initialStart = getStart(targetEvent);
    const initialEnd = getEnd(targetEvent);
    const initialDuration = initialEnd - initialStart;

    setDragState({
      eventId,
      actionType,
      startX: e.clientX,
      initialStart,
      initialEnd,
      initialDuration,
      hasMoved: false
    });
  };

  const handleMouseMove = useCallback((e) => {
    if (!dragState) return;

    const deltaPx = e.clientX - dragState.startX;
    if (!dragState.hasMoved && Math.abs(deltaPx) < 4) {
      return; // Ignore jitter/small click movements so click-to-seek is snappy
    }
    dragState.hasMoved = true;

    const deltaTime = deltaPx / zoomLevel;

    let newStart = dragState.initialStart;
    let newEnd = dragState.initialEnd;

    if (dragState.actionType === 'move') {
      newStart = Math.max(0, dragState.initialStart + deltaTime);
      newEnd = newStart + dragState.initialDuration;
    } else if (dragState.actionType === 'resize-start') {
      newStart = Math.max(0, Math.min(dragState.initialEnd - 0.2, dragState.initialStart + deltaTime));
    } else if (dragState.actionType === 'resize-end') {
      newEnd = Math.max(dragState.initialStart + 0.2, dragState.initialEnd + deltaTime);
    }

    // Quantize to 1 millisecond
    newStart = Math.round(newStart * 1000) / 1000;
    newEnd = Math.round(newEnd * 1000) / 1000;

    onEventTimeChange(dragState.eventId, newStart, newEnd);

    // Live tooltip
    setDragTooltip({
      x: e.clientX,
      y: e.clientY - 40,
      timeStr: `${formatTime(newStart)} → ${formatTime(newEnd)}`,
      durStr: `${(newEnd - newStart).toFixed(2)}s`
    });
  }, [dragState, zoomLevel, onEventTimeChange]);

  const handleMouseUp = useCallback(() => {
    if (dragState) {
      setDragState(null);
      setDragTooltip(null);
    }
  }, [dragState]);

  useEffect(() => {
    if (dragState) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [dragState, handleMouseMove, handleMouseUp]);

  // ── Shift + Click & Drag on Waveform to Create New Subtitle ──
  const [selectionState, setSelectionState] = useState(null);
  const isShiftSelectingRef = useRef(false);

  const handleTrackMouseDown = (e) => {
    if (e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      const rect = scrollRef.current?.getBoundingClientRect();
      if (!rect) return;
      const clickX = e.clientX - rect.left + scrollRef.current.scrollLeft;
      const t = Math.max(0, Math.min(effectiveDuration, clickX / zoomLevel));
      isShiftSelectingRef.current = true;
      setSelectionState({
        startX: clickX,
        currentX: clickX,
        startTime: t,
        currentTime: t
      });
    }
  };

  useEffect(() => {
    if (!selectionState) return;

    const handleSelectMouseMove = (e) => {
      const rect = scrollRef.current?.getBoundingClientRect();
      if (!rect) return;
      const curX = e.clientX - rect.left + scrollRef.current.scrollLeft;
      const curTime = Math.max(0, Math.min(effectiveDuration, curX / zoomLevel));
      setSelectionState(prev => prev ? { ...prev, currentX: curX, currentTime: curTime } : null);
    };

    const handleSelectMouseUp = () => {
      if (selectionState) {
        const startT = Math.min(selectionState.startTime, selectionState.currentTime);
        const endT = Math.max(selectionState.startTime, selectionState.currentTime);
        const dur = endT - startT;
        if (dur >= 0.2) {
          if (onAddSubtitleAtTime) {
            onAddSubtitleAtTime(Math.round(startT * 1000) / 1000, Math.round(endT * 1000) / 1000);
          }
        }
        setSelectionState(null);
        setTimeout(() => {
          isShiftSelectingRef.current = false;
        }, 50);
      }
    };

    window.addEventListener('mousemove', handleSelectMouseMove);
    window.addEventListener('mouseup', handleSelectMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleSelectMouseMove);
      window.removeEventListener('mouseup', handleSelectMouseUp);
    };
  }, [selectionState, effectiveDuration, zoomLevel, onAddSubtitleAtTime]);

  // Click on Timeline Track to Pause and Seek
  const handleTrackClick = (e) => {
    if (dragState || isShiftSelectingRef.current || e.shiftKey) return;
    isInternalSeekRef.current = true;
    const rect = scrollRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left + scrollRef.current.scrollLeft;
    const clickedTime = Math.max(0, Math.min(effectiveDuration, clickX / zoomLevel));
    onSeek(clickedTime);
  };

  // Helper formatting for timecode
  const formatTime = (seconds) => {
    if (isNaN(seconds) || seconds == null) return "00:00.000";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
  };

  // Adaptive time ruler step (keeps DOM lightweight and fast for any duration up to hours)
  let rulerStep = 1;
  if (zoomLevel >= 150) {
    rulerStep = 1;
  } else if (zoomLevel >= 80) {
    rulerStep = effectiveDuration > 600 ? 5 : (effectiveDuration > 180 ? 2 : 1);
  } else if (zoomLevel >= 40) {
    rulerStep = effectiveDuration > 1800 ? 30 : (effectiveDuration > 600 ? 10 : 5);
  } else {
    rulerStep = effectiveDuration > 1800 ? 60 : (effectiveDuration > 600 ? 30 : 10);
  }
  const marks = [];
  for (let t = 0; t <= effectiveDuration; t += rulerStep) {
    marks.push(t);
  }

  return (
    <div
      ref={containerRef}
      className="rounded-xl border border-[#262734] bg-[#0e0f12] flex flex-col w-full h-full overflow-hidden select-none transition-colors shadow-xs"
    >
      {/* ── Timeline Ribbon Header ── */}
      <div className="px-3 py-1.5 border-b border-[#262734] bg-[#14151a] text-slate-300 flex items-center justify-between text-xs shrink-0 transition-colors">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 font-bold font-mono text-[11px]">
            <Volume2 className="w-3.5 h-3.5 text-[#00e5be]" />
            <span className="text-slate-200 uppercase tracking-wider">AUDIO WAVEFORM TIMELINE</span>
            {isAudioLoading && (
              <span className="text-[10px] text-amber-400 animate-pulse font-sans font-normal">(Extracting Audio...)</span>
            )}
          </div>

          {/* Left-Oriented Zoom Slider & Buttons */}
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg border border-[#262734] bg-[#181920]">
            <ZoomOut
              className="w-3.5 h-3.5 cursor-pointer transition-colors text-slate-400 hover:text-white"
              onClick={() => handleZoomChange(zoomLevel - 15)}
              title="Zoom Out (Ctrl+Wheel Down)"
            />
            <input
              type="range"
              min="25"
              max="220"
              value={zoomLevel}
              onChange={(e) => handleZoomChange(Number(e.target.value))}
              className="w-24 h-1 bg-slate-600 rounded-full appearance-none cursor-pointer accent-[#00e5be]"
            />
            <ZoomIn
              className="w-3.5 h-3.5 cursor-pointer transition-colors text-slate-400 hover:text-white"
              onClick={() => handleZoomChange(zoomLevel + 15)}
              title="Zoom In (Ctrl+Wheel Up)"
            />
            <span className="text-[10px] font-mono font-semibold opacity-80 pl-1 text-slate-300">{zoomLevel} px/s</span>
          </div>

          {/* Subtitle Shift & Add Buttons */}
          <div className="flex items-center gap-1.5">
            {onShiftAllFollowing && (
              <button
                onClick={() => onShiftAllFollowing(activeEventId, currentTime)}
                className="px-2.5 py-1 text-xs rounded-lg font-bold transition-colors cursor-pointer border border-[#262734] bg-[#181920] hover:bg-[#22232c] text-cyan-400 flex items-center gap-1.5"
                title="Move active & all following subtitles to playhead preserving relative spacing (Ctrl+Space or Ctrl+Enter)"
              >
                <FastForward size={12} />
                <span>Shift Next (Ctrl+Space)</span>
              </button>
            )}

            {onAddSubtitleAtTime && (
              <button
                onClick={() => onAddSubtitleAtTime(currentTime)}
                className="px-2.5 py-1 text-xs bg-[#00e5be] hover:bg-[#00c9a7] text-black rounded-lg font-bold transition-transform active:scale-95 cursor-pointer flex items-center gap-1 shadow-[0_0_12px_rgba(0,229,190,0.25)]"
                title="Add Subtitle at current playhead"
              >
                <Plus size={12} />
                <span>Sub at Playhead</span>
              </button>
            )}

            {onContinueFromTime && (
              <button
                onClick={() => onContinueFromTime(currentTime)}
                className="px-2.5 py-1 text-xs rounded-lg font-bold transition-all cursor-pointer border border-amber-500/60 bg-amber-500/20 hover:bg-amber-500/35 text-amber-300 flex items-center gap-1.5 shadow-[0_0_10px_rgba(245,158,11,0.25)]"
                title={`Continue generating subtitles starting from ${formatTime(currentTime)} on timeline`}
              >
                <Play size={11} className="fill-amber-300" />
                <span>Continue from {formatTime(currentTime).slice(0, 5)}</span>
              </button>
            )}

            <span className="text-[10px] text-slate-400 font-mono hidden xl:inline-block px-2 py-0.5 rounded border border-[#262734] bg-[#181920]/60">
              Shift + Drag on waveform to create sub
            </span>
          </div>
        </div>

        {/* Timecode Readout */}
        <div className="text-xs font-mono px-3 py-1 rounded-lg border border-[#262734] bg-[#181920] flex items-center gap-2">
          <span className="font-bold text-[#00e5be]">{formatTime(currentTime)}</span>
          <span className="opacity-40 text-slate-500">/</span>
          <span className="opacity-70 text-slate-400">{formatTime(effectiveDuration)}</span>
        </div>
      </div>

      {/* ── Continuous Waveform & Precise Subtitle Boxes ── */}
      <div
        ref={scrollRef}
        className="relative flex-1 overflow-x-auto overflow-y-hidden cursor-crosshair custom-scrollbar min-h-0 bg-[#0e0f12]"
        onClick={handleTrackClick}
        onMouseDown={handleTrackMouseDown}
      >
        <div
          className="relative h-full timeline-track"
          style={{ width: `${timelineWidth}px` }}
        >
          {/* Timecode Ruler Bar */}
          <div className="absolute top-0 left-0 w-full h-6 border-b border-[#262734] bg-[#14151a]/95 pointer-events-none z-10">
            {marks.map((time) => (
              <div
                key={time}
                className="absolute top-0 h-full border-l border-[#262734] pl-1 flex items-center"
                style={{ left: `${time * zoomLevel}px` }}
              >
                <span className="text-[10px] font-mono font-semibold text-slate-400">
                  {formatTime(time)}
                </span>
              </div>
            ))}
          </div>

          {/* Viewport-Sized Sticky Audio Waveform Canvas (Never crashes on 40+ min media) */}
          <canvas
            ref={canvasRef}
            className="sticky left-0 top-0 pointer-events-none z-0 block"
          />

          {/* Shift + Drag Subtitle Creation Selection Overlay */}
          {selectionState && (
            <div
              className="absolute top-6 bottom-0 z-30 pointer-events-none border-2 border-[#00e5be] bg-[#00e5be]/20 rounded-[4px] shadow-[0_0_15px_rgba(0,229,190,0.4)] flex flex-col justify-between p-1.5 backdrop-blur-[1px]"
              style={{
                left: `${Math.min(selectionState.startX, selectionState.currentX)}px`,
                width: `${Math.max(Math.abs(selectionState.currentX - selectionState.startX), 4)}px`
              }}
            >
              <div className="text-[10px] font-mono font-black bg-[#00e5be] text-black px-1.5 py-0.5 rounded w-fit shadow-xs">
                + New Subtitle
              </div>
              <div className="text-[10px] font-mono font-bold text-white bg-black/80 px-1.5 py-0.5 rounded w-fit self-end border border-[#00e5be]/40">
                {formatTime(Math.min(selectionState.startTime, selectionState.currentTime))} → {formatTime(Math.max(selectionState.startTime, selectionState.currentTime))} ({(Math.abs(selectionState.currentTime - selectionState.startTime)).toFixed(2)}s)
              </div>
            </div>
          )}

          {/* Audio Waveform Extraction Loading HUD */}
          {(!waveformPeaks || waveformPeaks.length === 0) && isAudioLoading && (
            <div className="sticky left-0 top-12 flex items-center justify-center gap-2 pointer-events-none z-10 w-full py-4 text-xs font-mono text-[#00e5be]">
              <div className="w-2 h-2 rounded-full bg-[#00e5be] animate-ping" />
              <span>Extracting acoustic waveform peaks...</span>
            </div>
          )}

          {/* ── Subtitle Boxes (CapCut Dark Studio Blocks - Viewport Virtualized) ── */}
          <div className="absolute top-6 bottom-0 w-full pointer-events-none z-20">
            {visibleTimelineEvents.map((event) => {
              const id = event.id ?? event.event_id;
              return (
                <TimelineSubtitleBlock
                  key={id}
                  event={event}
                  zoomLevel={zoomLevel}
                  isActive={activeEventId === id}
                  effectiveDuration={effectiveDuration}
                  cplLimit={cplLimit}
                  cpsLimit={cpsLimit}
                  setActiveEventId={setActiveEventId}
                  onSeek={onSeek}
                  handleMouseDown={handleMouseDown}
                  isInternalSeekRef={isInternalSeekRef}
                  scrollRef={scrollRef}
                />
              );
            })}
          </div>

          {/* ── Playhead Scrub Needle (Hardware-Accelerated 60FPS Pivot Motion) ── */}
          <div
            className="absolute top-0 bottom-0 left-0 w-0.5 bg-[#00e5be] z-40 pointer-events-none shadow-[0_0_8px_rgba(0,229,190,0.9)] will-change-transform"
            style={{
              transform: `translate3d(${currentTime * zoomLevel}px, 0, 0)`,
              transition: 'none'
            }}
          >
            {/* Playhead Diamond Head */}
            <div className="w-3 h-3 bg-[#00e5be] transform -translate-x-1.5 -translate-y-1 rotate-45 border border-[#00e5ff] shadow-md" />
            <div className="bg-[#00e5be] text-black text-[9px] font-mono font-bold px-1 rounded-xs absolute top-2.5 -left-4 shadow-sm">
              {formatTime(currentTime)}
            </div>
          </div>
        </div>
      </div>

      {/* Live Dragging Tooltip HUD */}
      {dragTooltip && (
        <div
          className="fixed bg-[#181920]/95 border border-[#00e5be] text-white text-[11px] font-mono px-3 py-1.5 rounded-lg shadow-2xl pointer-events-none z-50 flex items-center gap-2"
          style={{ left: `${dragTooltip.x + 12}px`, top: `${dragTooltip.y}px` }}
        >
          <span className="text-[#00e5be] font-bold">{dragTooltip.timeStr}</span>
          <span className="text-slate-400">({dragTooltip.durStr})</span>
        </div>
      )}
    </div>
  );
}
