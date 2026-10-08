import { subscribePlayhead, publishPlayhead, getPlayhead } from '../../utils/playheadBus';
import { usePlayheadSelector } from '../../utils/usePlayheadSelector';
import { themeColor, withAlpha } from '../../theme/themeEngine';
import { stripFormatting } from './formatTags';
import React, { useRef, useState, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import {
  ZoomIn, ZoomOut, Volume2, Split, AlertCircle,
  RotateCcw, RotateCw, Scissors, Copy, Trash2, Wand2, Clock,
  SlidersHorizontal, Search, Maximize2, Eye, EyeOff, Users, Film,
  AlignLeft, AlignRight, MoveHorizontal, Play, MessageSquare, Merge, LogIn, LogOut
} from 'lucide-react';

function formatTime(s) {
  if (isNaN(s) || s == null) return '00:00.000';
  const m = Math.floor(s / 60), sec = Math.floor(s % 60), ms = Math.floor((s % 1) * 1000);
  return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}.${String(ms).padStart(3,'0')}`;
}

// Track lane heights matching OOONA reference
const RULER_H     = 24;
const FILM_H      = 46;
const SUBTITLE_H  = 48;
const WAVEFORM_H  = 54;
const SPEAKER_H   = 36;
const HIDDEN_TRACK_H = 22; // Collapsed row for a hidden track (keeps its eye button)
const LABEL_W     = 54; // Compact width for Eye Button + Track Icon side by side

// Distinct Speaker Colors Palette for Multi-speaker Diarization
const SPK_PRESETS = [
  { bg: 'bg-[#10b981]', border: 'border-[#059669]', text: 'text-white' }, // S1 emerald
  { bg: 'bg-[#f97316]', border: 'border-[#c2410c]', text: 'text-white' }, // S2 orange
  { bg: 'bg-[#8b5cf6]', border: 'border-[#6d28d9]', text: 'text-white' }, // S3 purple
  { bg: 'bg-[#3b82f6]', border: 'border-[#1d4ed8]', text: 'text-white' }, // S4 blue
  { bg: 'bg-[#ec4899]', border: 'border-[#be185d]', text: 'text-white' }, // S5 pink
  { bg: 'bg-[var(--kt-accent)]', border: 'border-[#0e7490]', text: 'text-white' }, // S6 cyan
  { bg: 'bg-[#eab308]', border: 'border-[#a16207]', text: 'text-black font-bold' }, // S7 yellow
  { bg: 'bg-[#ef4444]', border: 'border-[#b91c1c]', text: 'text-white' }, // S8 red
];

function getSpeakerPreset(spk, idx = 0) {
  if (!spk) return SPK_PRESETS[idx % SPK_PRESETS.length];
  const clean = String(spk).trim().toLowerCase();
  let h = 0;
  for (let i = 0; i < clean.length; i++) h = clean.charCodeAt(i) + ((h << 5) - h);
  return SPK_PRESETS[Math.abs(h) % SPK_PRESETS.length];
}

// ── Subtitle Block on Timeline ──
const TimelineSubtitleBlock = React.memo(function TimelineSubtitleBlock({
  event, zoomLevel, isActive, effectiveDuration, cplLimit, cpsLimit,
  setActiveEventId, onSeek, handleMouseDown, onContextMenu,
  isInternalSeekRef, scrollRef, hideText,
}) {
  const start  = event.start_time ?? event.start ?? 0;
  const end    = event.end_time   ?? event.end   ?? 0;
  const id     = event.id ?? event.event_id;
  const startX = start * zoomLevel;
  const width  = Math.max((end - start) * zoomLevel, 16);

  const dur    = Math.max(0.1, end - start);
  const text   = event.text || '';
  const rawLen = stripFormatting(text).trim().length;
  const cps    = rawLen / dur;
  const maxCpl = Math.max(...stripFormatting(text).split('\n').map(l => l.trim().length), 0);
  const hasErr = !hideText && cps > cpsLimit || maxCpl > cplLimit || dur < 0.833 || dur > 7;

  return (
    <div
      className={`absolute top-1 bottom-1 rounded-md flex items-stretch overflow-hidden select-none border transition-all ${
        isActive
          ? 'bg-[var(--ss-accent)] border-2 border-white/70 text-[var(--ss-accent-ink)] z-30 shadow-lg'
          : hasErr
            ? 'bg-[var(--kt-s3)] border-rose-500/80 text-rose-100 z-20 hover:border-rose-400'
            : 'bg-[var(--kt-s4)] border-[var(--ss-line)] text-slate-100 z-20 hover:border-[#4a6098] hover:bg-[var(--ss-hover)]'
      }`}
      style={{ left: `${startX}px`, width: `${width}px` }}
      onClick={(e) => {
        e.stopPropagation();
        if (isInternalSeekRef) isInternalSeekRef.current = true;
        setActiveEventId(id);
        const rect = scrollRef.current?.getBoundingClientRect();
        if (rect) {
          const cx = e.clientX - rect.left + scrollRef.current.scrollLeft;
          onSeek(Math.max(0, Math.min(effectiveDuration, cx / zoomLevel)));
        } else onSeek(start);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onContextMenu(e, id, start, end);
      }}
    >
      {/* Left trim handle */}
      <div
        onMouseDown={(e) => { e.stopPropagation(); handleMouseDown(e, id, 'resize-start'); }}
        className="w-2 shrink-0 flex items-center justify-center cursor-col-resize z-40 hover:bg-white/30 group/lh transition-colors"
        title="Trim Start (In-point)"
        style={{ pointerEvents: 'auto' }}
      >
        <div className="w-0.5 h-5 rounded-full bg-white/40 group-hover/lh:bg-white transition-colors" />
      </div>

      {/* Body — drag to move subtitle */}
      <div
        onMouseDown={(e) => { e.stopPropagation(); handleMouseDown(e, id, 'move'); }}
        className="flex-1 px-1.5 flex flex-col justify-center overflow-hidden cursor-grab active:cursor-grabbing min-w-0"
        style={{ pointerEvents: 'auto' }}
      >
        <span className="ss-script text-[12px] font-medium leading-tight truncate select-none">
          {hideText ? '' : (text ? stripFormatting(text).replace(/\n/g, ' ') : `#${id}`)}
        </span>
      </div>

      {/* Right trim handle */}
      <div
        onMouseDown={(e) => { e.stopPropagation(); handleMouseDown(e, id, 'resize-end'); }}
        className="w-2 shrink-0 flex items-center justify-center cursor-col-resize z-40 hover:bg-white/30 group/rh transition-colors"
        title="Trim End (Out-point)"
        style={{ pointerEvents: 'auto' }}
      >
        <div className="w-0.5 h-5 rounded-full bg-white/40 group-hover/rh:bg-white transition-colors" />
      </div>
    </div>
  );
});

// ── Compact Track Header (Eye Button + Track Icon Side by Side) ──
function CompactTrackLabel({ top, height, icon, label, visible, onToggle }) {
  return (
    <div
      className={`absolute left-0 right-0 border-b border-[var(--ss-line)] flex items-center justify-center gap-1.5 px-1 select-none transition-colors ${
        visible ? 'bg-[var(--ss-panel)]' : 'bg-[var(--kt-s0)]'
      }`}
      style={{ top: `${top}px`, height: `${height}px` }}
    >
      {/* Eye toggle button — Click to hide/show layer */}
      <button
        type="button"
        onClick={onToggle}
        className={`p-1 rounded transition-colors cursor-pointer flex items-center justify-center ${
          visible
            ? 'text-[var(--ss-accent)] hover:text-white hover:bg-white/10'
            : 'text-rose-400 hover:text-rose-300 hover:bg-rose-500/20'
        }`}
        title={visible ? `Hide ${label} track` : `Show ${label} track`}
      >
        {visible ? <Eye size={13} /> : <EyeOff size={13} />}
      </button>

      {/* Track type icon */}
      <div className={`shrink-0 ${visible ? 'text-slate-300' : 'text-slate-600 opacity-60'}`} title={label}>
        {icon}
      </div>
    </div>
  );
}

export default function AudioWaveformTimeline({
  videoUrl = null,
  audioUrl = null,
  isAudio = false,
  selectedFile = null,
  videoId = null,
  initialPeaks = [],
  API_BASE = '',
  events = [],
  shotChanges = [],
  activeEventId = null,
  setActiveEventId = () => {},
  duration = 0,
  onEventTimeChange = () => {},
  onSeek = () => {},
  onAddSubtitleAtTime = null,
  onShiftAllFollowing = null,
  onContinueFromTime = null,
  onUndo = null,
  onRedo = null,
  onDeleteEvent = null,
  onSplitAtTime = null,
  onMergeWithNext = null,
  onPlayEvent = null,
  frameRate = 24.0,
  cpsLimit = 20,
  cplLimit = 42,
  theme = 'dark',
  hideBlockText = false,
}) {
  const [zoomLevel, setZoomLevel] = useState(70);
  const [waveformPeaks, setWaveformPeaks] = useState(initialPeaks || []);
  const [waveformPointsPerSec, setWaveformPointsPerSec] = useState(50);
  const [isAudioLoading, setIsAudioLoading] = useState(false);

  // Filmstrip frame thumbnails: { time: number, dataUrl: string }[]
  const [filmFrames, setFilmFrames] = useState([]);
  const [filmExtracted, setFilmExtracted] = useState(false);

  // Track visibility (All tracks remain in label column for easy toggling back!)
  const [trackVisible, setTrackVisible] = useState({
    filmstrip: true, subtitle: true, waveform: true, speaker: true,
  });
  const toggleTrack = (key) => setTrackVisible(p => ({ ...p, [key]: !p[key] }));

  // Right-click context menu
  const [contextMenu, setContextMenu] = useState(null);

  const containerRef = useRef(null);
  const scrollRef    = useRef(null);
  const canvasRef    = useRef(null);
  const lastActiveIdRef = useRef(activeEventId);

  const [dragState, setDragState] = useState(null);
  const [dragTooltip, setDragTooltip] = useState(null);

  // ── Global Ctrl+Z (Undo) and Ctrl+Y / Ctrl+Shift+Z (Redo) ──
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (['INPUT', 'TEXTAREA'].includes(e.target?.tagName)) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (e.shiftKey) {
          e.preventDefault();
          if (onRedo) onRedo();
        } else {
          e.preventDefault();
          if (onUndo) onUndo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        if (onRedo) onRedo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onUndo, onRedo]);

  // Close context menu on outside click or scroll
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [contextMenu]);

  // ── High Resolution Video Filmstrip Frame Extraction ──
  useEffect(() => {
    if (!videoUrl || filmExtracted) return;
    const vid = document.createElement('video');
    vid.crossOrigin = 'anonymous';
    vid.preload = 'metadata';
    vid.muted = true;
    vid.src = videoUrl;

    vid.addEventListener('loadedmetadata', async () => {
      const dur = vid.duration;
      if (!dur || isNaN(dur)) return;

      const interval = Math.max(1.5, Math.ceil(dur / 80));
      const times = [];
      for (let t = 0; t <= dur; t += interval) times.push(t);

      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 180;

      const ctx2d = canvas.getContext('2d');
      const frames = [];

      for (const t of times) {
        await new Promise((res) => {
          vid.currentTime = t;
          vid.onseeked = () => {
            try {
              ctx2d.drawImage(vid, 0, 0, 320, 180);
              frames.push({ time: t, dataUrl: canvas.toDataURL('image/jpeg', 0.85) });
            } catch { /* CORS fallback */ }
            res();
          };
          setTimeout(res, 250);
        });
      }

      setFilmFrames(frames);
      setFilmExtracted(true);
    });
  }, [videoUrl, filmExtracted]);

  // ── Waveform Peaks ──
  useEffect(() => {
    if (initialPeaks && initialPeaks.length > 0) {
      setWaveformPeaks(initialPeaks);
      setIsAudioLoading(false);
    }
  }, [initialPeaks]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (initialPeaks?.length > 0) return;
      const cacheKey = videoId ? `wf_peaks_${videoId}` : null;
      if (cacheKey) {
        try {
          const c = sessionStorage.getItem(cacheKey);
          if (c) { const p = JSON.parse(c); if (p?.peaks?.length) { setWaveformPeaks(p.peaks); setWaveformPointsPerSec(p.pps||50); return; } }
        } catch {}
      }
      if (!videoId || !API_BASE) return;
      setIsAudioLoading(true);
      try {
        const res = await fetch(`${API_BASE}/api/subtitle/waveform_peaks/${videoId}`);
        if (!cancelled && res.ok) {
          const data = await res.json();
          if (data?.peaks?.length) {
            setWaveformPeaks(data.peaks);
            setWaveformPointsPerSec(data.points_per_second || 50);
            if (cacheKey) try { sessionStorage.setItem(cacheKey, JSON.stringify({peaks: data.peaks, pps: data.points_per_second||50})); } catch {}
          }
        }
      } catch {} finally { if (!cancelled) setIsAudioLoading(false); }
    };
    load();
    return () => { cancelled = true; };
  }, [videoId, videoUrl, initialPeaks, API_BASE]);

  // ── Geometry & Layout Specs ──
  const maxEventTime = events.length > 0 ? Math.max(...events.map(e => e.end_time ?? e.end ?? 0)) : 0;
  const peakDuration = waveformPeaks?.length ? (waveformPeaks.length / (waveformPointsPerSec || 50)) : 0;
  const effectiveDuration = Math.max(duration || 0, peakDuration, maxEventTime + 10, 60);
  const timelineWidth = Math.max(effectiveDuration * zoomLevel, scrollRef.current?.clientWidth || 900);
  const [viewportScroll, setViewportScroll] = useState({ scrollLeft: 0, clientWidth: 1000 });

  const visibleEvents = useMemo(() => {
    const buf = 15;
    const vStart = Math.max(0, (viewportScroll.scrollLeft / zoomLevel) - buf);
    const vEnd   = ((viewportScroll.scrollLeft + viewportScroll.clientWidth) / zoomLevel) + buf;
    return events.filter(e => {
      const st = e.start_time ?? e.start ?? 0;
      const en = e.end_time ?? e.end ?? 0;
      return en >= vStart && st <= vEnd;
    });
  }, [events, viewportScroll, zoomLevel]);

  // Track Layout Positions (Always computes positions for all 4 tracks)
  const { tTops, hTops, totalH } = useMemo(() => {
    const TRACK_DEFS = [
      { key: 'ruler',     h: RULER_H,    always: true },
      { key: 'filmstrip', h: FILM_H,     always: false },
      { key: 'subtitle',  h: SUBTITLE_H, always: false },
      { key: 'waveform',  h: WAVEFORM_H, always: false },
      { key: 'speaker',   h: SPEAKER_H,  always: false },
    ];
    let cum = 0;
    const tops = {};
    for (const td of TRACK_DEFS) {
      if (td.always || trackVisible[td.key]) {
        tops[td.key] = cum;
        cum += td.h;
      }
    }
    // Hidden tracks collapse into slim rows at the bottom so their eye button stays clickable
    const hiddenTops = {};
    for (const td of TRACK_DEFS) {
      if (!td.always && !trackVisible[td.key]) {
        hiddenTops[td.key] = cum;
        cum += HIDDEN_TRACK_H;
      }
    }
    return { tTops: tops, hTops: hiddenTops, totalH: cum };
  }, [trackVisible]);

  // ── Crisp High-DPI Time-Normalized Waveform Canvas (100% Full Media Duration Span, Smooth Tapering, Zero Cutoffs) ──
  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    const scrollElem = scrollRef.current;
    if (!canvas || !scrollElem) return;

    const VW = Math.max(scrollElem.clientWidth || 900, 400);
    const SL = scrollElem.scrollLeft || 0;
    const H  = WAVEFORM_H;

    // Pin canvas horizontally to the scroll viewport so it never scrolls out of view
    canvas.style.transform = `translate3d(${SL}px, 0, 0)`;

    const dpr = window.devicePixelRatio || 1;
    const targetW = Math.floor(VW * dpr);
    const targetH = Math.floor(H * dpr);

    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
      canvas.style.width = `${VW}px`;
      canvas.style.height = `${H}px`;
    }

    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, VW, H);

    const cy   = H / 2;
    const maxA = (H / 2) - 4;

    // Center baseline
    ctx.strokeStyle = withAlpha(themeColor('accent'), 0.4);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, cy);
    ctx.lineTo(VW, cy);
    ctx.stroke();

    // Draw continuously across the full visible viewport width without arbitrary endPx cutoffs!
    const startPx = Math.max(0, Math.floor(SL - 20));
    const endPx = Math.ceil(SL + VW + 20);

    if (endPx <= startPx) { ctx.restore(); return; }

    const totalMediaDuration = Math.max(
      duration || 0,
      waveformPeaks?.length ? waveformPeaks.length / (waveformPointsPerSec || 50) : 0,
      effectiveDuration
    );
    const hasPeaks = waveformPeaks && waveformPeaks.length > 0;
    const pps = waveformPointsPerSec || 50;
    const stepPx = 2; // High-definition 2px step sampling

    ctx.beginPath();
    ctx.moveTo(startPx - SL, cy);

    // Upper envelope calculation across 100% of the media timeline (no cutoffs on scroll!)
    for (let px = startPx; px <= endPx; px += stepPx) {
      const t = px / zoomLevel;
      let amp = 0.05;

      if (hasPeaks) {
        const peakIdx = Math.floor(t * pps);
        if (peakIdx >= 0 && peakIdx < waveformPeaks.length) {
          amp = waveformPeaks[peakIdx];
        } else {
          const normIdx = Math.floor((t / Math.max(1, totalMediaDuration)) * waveformPeaks.length);
          const clampedIdx = Math.min(waveformPeaks.length - 1, Math.max(0, normIdx));
          amp = waveformPeaks[clampedIdx] || 0.08;
        }
      } else {
        amp = 0.18 + 0.12 * Math.abs(Math.sin(t * 8) * Math.cos(t * 3.5));
      }

      amp = Math.max(0.05, Math.min(0.95, amp));
      const x = px - SL;
      ctx.lineTo(x, cy - (amp * maxA));
    }
    ctx.lineTo(endPx - SL, cy);

    // Lower envelope (mirrored)
    for (let px = endPx; px >= startPx; px -= stepPx) {
      const t = px / zoomLevel;
      let amp = 0.05;

      if (hasPeaks) {
        const peakIdx = Math.floor(t * pps);
        if (peakIdx >= 0 && peakIdx < waveformPeaks.length) {
          amp = waveformPeaks[peakIdx];
        } else {
          const normIdx = Math.floor((t / Math.max(1, totalMediaDuration)) * waveformPeaks.length);
          const clampedIdx = Math.min(waveformPeaks.length - 1, Math.max(0, normIdx));
          amp = waveformPeaks[clampedIdx] || 0.08;
        }
      } else {
        amp = 0.18 + 0.12 * Math.abs(Math.sin(t * 8) * Math.cos(t * 3.5));
      }

      amp = Math.max(0.05, Math.min(0.95, amp));
      const x = px - SL;
      ctx.lineTo(x, cy + (amp * maxA));
    }
    ctx.closePath();

    // OOONA bright turquoise fill
    const g = ctx.createLinearGradient(0, cy - maxA, 0, cy + maxA);
    g.addColorStop(0,   withAlpha(themeColor('accent'), 0.65));
    g.addColorStop(0.5, withAlpha(themeColor('accent'), 0.95));
    g.addColorStop(1,   withAlpha(themeColor('accent'), 0.65));
    ctx.fillStyle = g;
    ctx.fill();

    // Crisp outline
    ctx.strokeStyle = themeColor('accentSoft');
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.restore();
  }, [waveformPeaks, waveformPointsPerSec, zoomLevel, duration, effectiveDuration]);

  useEffect(() => { drawWaveform(); }, [drawWaveform]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = null;
    const onSR = () => {
      const cv = canvasRef.current;
      if (cv) {
        cv.style.transform = `translate3d(${el.scrollLeft}px, 0, 0)`;
      }
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        drawWaveform();
        if (el) setViewportScroll({ scrollLeft: el.scrollLeft, clientWidth: el.clientWidth || 1000 });
      });
    };
    onSR();
    el.addEventListener('scroll', onSR, { passive: true });
    window.addEventListener('resize', onSR);
    const ro = new ResizeObserver(onSR);
    ro.observe(el);
    return () => { ro.disconnect(); el.removeEventListener('scroll', onSR); window.removeEventListener('resize', onSR); if (raf) cancelAnimationFrame(raf); };
  }, [drawWaveform]);

  // ── Zoom ──
  const zoomCenterRef = useRef(null);
  const isZoomingRef  = useRef(false);

  const handleZoomChange = useCallback((nz) => {
    const z = Math.max(20, Math.min(350, nz));
    const el = scrollRef.current;
    if (el) { zoomCenterRef.current = el.scrollLeft / zoomLevel; isZoomingRef.current = true; }
    setZoomLevel(z);
  }, [zoomLevel]);

  useLayoutEffect(() => {
    if (!isZoomingRef.current || zoomCenterRef.current === null) return;
    const el = scrollRef.current;
    if (el) el.scrollLeft = Math.max(0, zoomCenterRef.current * zoomLevel);
    isZoomingRef.current = false; zoomCenterRef.current = null;
  }, [zoomLevel]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onW = (e) => {
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); handleZoomChange(zoomLevel + (e.deltaY < 0 ? 15 : -15)); return; }
      if (Math.abs(e.deltaY) > 0 || Math.abs(e.deltaX) > 0) {
        e.preventDefault();
        el.scrollLeft -= (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * 1.5;
      }
    };
    el.addEventListener('wheel', onW, { passive: false });
    return () => el.removeEventListener('wheel', onW);
  }, [zoomLevel, handleZoomChange]);

  // ── Viewport auto-scroll ──
  const isInternalSeekRef = useRef(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || dragState || isZoomingRef.current) return;
    if (isInternalSeekRef.current) { isInternalSeekRef.current = false; lastActiveIdRef.current = activeEventId; return; }
    const w  = el.clientWidth || 900;
    const px = getPlayhead() * zoomLevel;
    const cs = el.scrollLeft;
    const ac = activeEventId !== lastActiveIdRef.current;
    lastActiveIdRef.current = activeEventId;
    const isIn = px >= cs && px <= cs + w;
    // Playback following is handled by the playhead-bus subscription; here only jump to a newly selected cue
    if (ac && !isIn) el.scrollLeft = Math.max(0, px - w * 0.2);
  }, [activeEventId, zoomLevel, dragState]);

  // ── Playhead needle: follows the playhead bus every frame, without React renders ──
  const needleRef = useRef(null);
  const zoomRef = useRef(zoomLevel);
  zoomRef.current = zoomLevel;
  const scrubbingRef = useRef(false);

  // Viewport geometry is cached (resize/scroll listeners) so the per-frame callback never reads
  // layout right after writing a transform, which would force a synchronous reflow every frame.
  const viewRef = useRef({ width: 900, scrollLeft: 0 });
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const sync = () => { viewRef.current = { width: el.clientWidth || 900, scrollLeft: el.scrollLeft }; };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    el.addEventListener('scroll', sync, { passive: true });
    return () => { ro.disconnect(); el.removeEventListener('scroll', sync); };
  }, []);

  useEffect(() => subscribePlayhead((t) => {
    const needle = needleRef.current;
    if (needle) needle.style.transform = `translateX(${t * zoomRef.current}px)`;
    // Follow playback: keep the needle in view (not while the user scrubs)
    const el = scrollRef.current;
    if (!el || scrubbingRef.current) return;
    const px = t * zoomRef.current;
    const { width: w, scrollLeft } = viewRef.current;
    if (px > scrollLeft + w * 0.92 || px < scrollLeft) {
      const next = Math.max(0, px - w * 0.15);
      el.scrollLeft = next;
      viewRef.current.scrollLeft = next;
    }
  }), []);

  useLayoutEffect(() => {
    if (needleRef.current) needleRef.current.style.transform = `translateX(${getPlayhead() * zoomLevel}px)`;
  }, [zoomLevel]);

  // Press & drag on the ruler or the needle head to scrub
  const startScrub = useCallback((e) => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const el = scrollRef.current;
    if (!el) return;
    scrubbingRef.current = true;
    isInternalSeekRef.current = true;
    let pending = null;
    let raf = 0;
    const timeAt = (clientX) => {
      const rect = el.getBoundingClientRect();
      const cx = clientX - rect.left + el.scrollLeft;
      return Math.max(0, Math.min(effectiveDuration, cx / zoomRef.current));
    };
    const flush = () => {
      raf = 0;
      if (pending === null) return;
      onSeek(pending);
      pending = null;
    };
    const move = (ev) => {
      const t = timeAt(ev.clientX);
      publishPlayhead(t);          // needle follows the mouse instantly
      pending = t;                 // the video seeks at most once per frame
      if (!raf) raf = requestAnimationFrame(flush);
    };
    const up = (ev) => {
      move(ev);
      if (raf) { cancelAnimationFrame(raf); flush(); }
      scrubbingRef.current = false;
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    move(e);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }, [effectiveDuration, onSeek]);

  const handleFitToWindow = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !effectiveDuration) return;
    const z = Math.max(20, Math.min(350, (el.clientWidth - 8) / effectiveDuration));
    zoomCenterRef.current = 0; isZoomingRef.current = true;
    setZoomLevel(z);
  }, [effectiveDuration]);

  // Selected cue and the cue under the playhead (for toolbar enablement)
  const activeEvent = events.find(x => (x.id ?? x.event_id) === activeEventId) || null;
  const activeStart = activeEvent ? (activeEvent.start_time ?? activeEvent.start ?? 0) : 0;
  const activeEnd = activeEvent ? (activeEvent.end_time ?? activeEvent.end ?? 0) : 0;
  const isLastActive = activeEvent ? (events[events.length - 1] === activeEvent) : true;
  // Toolbar buttons whose enabled state depends on the playhead (see PlayheadButton)
  const cueAtTime = (t) => events.some(x => {
    const st = x.start_time ?? x.start ?? 0, en = x.end_time ?? x.end ?? 0;
    return t > st + 0.05 && t < en - 0.05;
  });

  // ── Drag & Resize Subtitle Blocks ──
  const handleMouseDown = useCallback((e, eventId, actionType) => {
    e.stopPropagation(); e.preventDefault();
    const ev = events.find(x => (x.id === eventId || x.event_id === eventId));
    if (!ev) return;
    setActiveEventId(eventId);
    const iS = ev.start_time ?? ev.start ?? 0;
    const iE = ev.end_time   ?? ev.end   ?? 0;
    setDragState({ eventId, actionType, startX: e.clientX, initialStart: iS, initialEnd: iE, initialDuration: iE - iS, hasMoved: false });
  }, [events, setActiveEventId]);

  const handleMouseMove = useCallback((e) => {
    if (!dragState) return;
    const dx = e.clientX - dragState.startX;
    if (!dragState.hasMoved && Math.abs(dx) < 3) return;
    dragState.hasMoved = true;
    const dt = dx / zoomLevel;
    let nS = dragState.initialStart, nE = dragState.initialEnd;
    if (dragState.actionType === 'move')         { nS = Math.max(0, dragState.initialStart + dt); nE = nS + dragState.initialDuration; }
    else if (dragState.actionType === 'resize-start') { nS = Math.max(0, Math.min(dragState.initialEnd - 0.2, dragState.initialStart + dt)); }
    else if (dragState.actionType === 'resize-end')   { nE = Math.max(dragState.initialStart + 0.2, dragState.initialEnd + dt); }
    nS = Math.round(nS * 1000) / 1000; nE = Math.round(nE * 1000) / 1000;
    onEventTimeChange(dragState.eventId, nS, nE);
    setDragTooltip({ x: e.clientX, y: e.clientY - 48, t: `${formatTime(nS)} → ${formatTime(nE)}`, d: `${(nE-nS).toFixed(2)}s` });
  }, [dragState, zoomLevel, onEventTimeChange]);

  const handleMouseUp = useCallback(() => {
    setDragState(null);
    setDragTooltip(null);
  }, []);

  useEffect(() => {
    if (!dragState) return;
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp); };
  }, [dragState, handleMouseMove, handleMouseUp]);

  // Right-click Handler on Subtitle Block
  const handleBlockContextMenu = useCallback((e, eventId, start, end) => {
    const rect = scrollRef.current?.getBoundingClientRect();
    const clickTime = rect ? (e.clientX - rect.left + scrollRef.current.scrollLeft) / zoomLevel : start;
    setContextMenu({ x: e.clientX, y: e.clientY, eventId, start, end, clickTime });
  }, [zoomLevel]);

  // ── Shift+drag create new subtitle ──
  const [selSt, setSelSt] = useState(null);
  const shiftSelRef = useRef(false);

  const onTrackMouseDown = (e) => {
    if (!e.shiftKey) return;
    e.preventDefault(); e.stopPropagation();
    const rect = scrollRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = e.clientX - rect.left + scrollRef.current.scrollLeft;
    const t  = Math.max(0, Math.min(effectiveDuration, cx / zoomLevel));
    shiftSelRef.current = true;
    setSelSt({ startX: cx, currentX: cx, startTime: t, currentTime: t });
  };

  useEffect(() => {
    if (!selSt) return;
    const onM = (e) => {
      const rect = scrollRef.current?.getBoundingClientRect(); if (!rect) return;
      const cx = e.clientX - rect.left + scrollRef.current.scrollLeft;
      const t  = Math.max(0, Math.min(effectiveDuration, cx / zoomLevel));
      setSelSt(p => p ? { ...p, currentX: cx, currentTime: t } : null);
    };
    const onU = () => {
      if (selSt) {
        const sT = Math.min(selSt.startTime, selSt.currentTime);
        const eT = Math.max(selSt.startTime, selSt.currentTime);
        if (eT - sT >= 0.2 && onAddSubtitleAtTime) onAddSubtitleAtTime(Math.round(sT*1000)/1000, Math.round(eT*1000)/1000);
        setSelSt(null);
        setTimeout(() => { shiftSelRef.current = false; }, 50);
      }
    };
    window.addEventListener('mousemove', onM);
    window.addEventListener('mouseup', onU);
    return () => { window.removeEventListener('mousemove', onM); window.removeEventListener('mouseup', onU); };
  }, [selSt, effectiveDuration, zoomLevel, onAddSubtitleAtTime]);

  const onTrackClick = (e) => {
    if (dragState || shiftSelRef.current || e.shiftKey) return;
    isInternalSeekRef.current = true;
    const rect = scrollRef.current.getBoundingClientRect();
    const cx = e.clientX - rect.left + scrollRef.current.scrollLeft;
    onSeek(Math.max(0, Math.min(effectiveDuration, cx / zoomLevel)));
  };

  // Ruler marks
  let rulerStep = 1;
  if (zoomLevel >= 150) rulerStep = 1;
  else if (zoomLevel >= 80)  rulerStep = effectiveDuration > 600 ? 5  : (effectiveDuration > 180 ? 2 : 1);
  else if (zoomLevel >= 40)  rulerStep = effectiveDuration > 1800 ? 30 : (effectiveDuration > 600 ? 10 : 5);
  else                       rulerStep = effectiveDuration > 1800 ? 60 : (effectiveDuration > 600 ? 30 : 10);
  const marks = [];
  for (let t = 0; t <= effectiveDuration; t += rulerStep) marks.push(t);

  return (
    <div ref={containerRef} className="border-t border-[var(--ss-line)] bg-[var(--ss-bg)] flex flex-col w-full h-full overflow-hidden select-none">

      {/* ── Timeline Top Toolbar (No Emoji in Split / Auto Split) ── */}
      <div className="h-10 px-3 border-b border-[var(--ss-line)] bg-[var(--ss-panel)] flex items-center justify-between text-xs shrink-0 gap-2">
        {/* Left: edit actions (all act on the selected subtitle or the playhead) */}
        <div className="flex items-center gap-0.5">
          <ToolbarButton title="Undo (Ctrl+Z)" onClick={onUndo} disabled={!onUndo}><RotateCcw size={13}/></ToolbarButton>
          <ToolbarButton title="Redo (Ctrl+Y)" onClick={onRedo} disabled={!onRedo}><RotateCw size={13}/></ToolbarButton>
          <div className="w-px h-4 bg-[var(--ss-line)] mx-1.5" />
          <PlayheadButton
            title="Split the subtitle under the playhead at the playhead"
            label="Split"
            unavailable={!onSplitAtTime} disabledAt={(t) => !cueAtTime(t)} deps={[events]}
            onClick={() => onSplitAtTime(getPlayhead())}
          ><Scissors size={12}/></PlayheadButton>
          <ToolbarButton
            title="Merge the selected subtitle with the next one"
            label="Merge"
            disabled={!onMergeWithNext || !activeEvent || isLastActive}
            onClick={() => onMergeWithNext(activeEventId)}
          ><Merge size={12}/></ToolbarButton>
          <PlayheadButton
            title="Set the selected subtitle's start to the playhead"
            label="Set In"
            unavailable={!activeEvent} disabledAt={(t) => t >= activeEnd} deps={[activeEnd]}
            onClick={() => onEventTimeChange(activeEventId, getPlayhead(), activeEnd)}
          ><LogIn size={12}/></PlayheadButton>
          <PlayheadButton
            title="Set the selected subtitle's end to the playhead"
            label="Set Out"
            unavailable={!activeEvent} disabledAt={(t) => t <= activeStart} deps={[activeStart]}
            onClick={() => onEventTimeChange(activeEventId, activeStart, getPlayhead())}
          ><LogOut size={12}/></PlayheadButton>
          <ToolbarButton
            title="Delete the selected subtitle"
            label="Delete"
            danger
            disabled={!onDeleteEvent || !activeEvent}
            onClick={() => onDeleteEvent(activeEventId)}
          ><Trash2 size={12}/></ToolbarButton>
          <span className="ml-2 text-[10px] text-slate-500 hidden xl:inline">Shift+drag on the timeline to add a subtitle</span>
        </div>

        {/* Right: zoom */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[var(--ss-panel)] border border-[var(--ss-line)]">
            <button type="button" className="text-slate-400 hover:text-white cursor-pointer" onClick={() => handleZoomChange(zoomLevel - 20)} title="Zoom out (Ctrl+scroll)"><ZoomOut size={12}/></button>
            <input type="range" aria-label="Timeline zoom" min="20" max="350" value={zoomLevel}
              onChange={(e) => handleZoomChange(Number(e.target.value))}
              className="w-20 h-1 rounded-full appearance-none cursor-pointer accent-[var(--ss-accent)] bg-[var(--ss-line)]"
            />
            <button type="button" className="text-slate-400 hover:text-white cursor-pointer" onClick={() => handleZoomChange(zoomLevel + 20)} title="Zoom in (Ctrl+scroll)"><ZoomIn size={12}/></button>
            <span className="text-[10px] text-slate-500 font-mono w-7 text-right">{Math.round(zoomLevel*100/70)}%</span>
          </div>
          <button type="button" onClick={handleFitToWindow} className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-white/8 transition-colors cursor-pointer" title="Fit the whole media in view">
            <Maximize2 size={13}/>
          </button>
        </div>
      </div>

      {/* ── Multi-Track Workspace ── */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden custom-scrollbar">
      <div className="flex relative" style={{ minHeight: '100%' }}>

        {/* LEFT TRACK LABELS COLUMN (Eye Button + Track Icon Side by Side) */}
        <div className="shrink-0 border-r border-[var(--ss-line)] bg-[var(--ss-panel)] sticky left-0 z-30 select-none" style={{ width: `${LABEL_W}px`, height: `${totalH}px` }}>
          {/* Ruler Top Spacer */}
          <div style={{ height: `${RULER_H}px` }} className="border-b border-[var(--ss-line)] bg-[var(--ss-panel)] flex items-center justify-center">
            <span className="text-[9px] font-mono text-slate-600 tracking-widest">TC</span>
          </div>

          {[
            { key: 'filmstrip', h: FILM_H,     icon: <Film size={13} />,          label: 'Video' },
            { key: 'subtitle',  h: SUBTITLE_H, icon: <MessageSquare size={13} />, label: 'Subtitles' },
            { key: 'waveform',  h: WAVEFORM_H, icon: <Volume2 size={13} />,       label: 'Waveform' },
            { key: 'speaker',   h: SPEAKER_H,  icon: <Users size={13} />,         label: 'Speakers' },
          ].map(t => (
            <CompactTrackLabel
              key={t.key}
              top={trackVisible[t.key] ? tTops[t.key] : hTops[t.key]}
              height={trackVisible[t.key] ? t.h : HIDDEN_TRACK_H}
              icon={t.icon}
              label={t.label} visible={trackVisible[t.key]}
              onToggle={() => toggleTrack(t.key)}
            />
          ))}
        </div>

        {/* SCROLLABLE TRACKS BODY */}
        <div
          ref={scrollRef}
          className="relative flex-1 overflow-x-auto overflow-y-hidden cursor-crosshair custom-scrollbar bg-[var(--ss-bg)]"
          onClick={onTrackClick}
          onMouseDown={onTrackMouseDown}
        >
          <div className="relative" style={{ width: `${timelineWidth}px`, height: `${totalH}px` }}>

            {/* ── RULER (press & drag to scrub) ── */}
            <div
              className="absolute left-0 right-0 bg-[var(--ss-panel)] border-b border-[var(--ss-line)] z-10 overflow-hidden cursor-ew-resize"
              style={{ top: 0, height: `${RULER_H}px` }}
              onMouseDown={startScrub}
              onClick={(e) => e.stopPropagation()}
              title="Click or drag to move the playhead"
            >
              {marks.map(t => (
                <div key={t} className="absolute top-0 h-full border-l border-[var(--ss-line)] pl-1 flex items-center"
                  style={{ left: `${t * zoomLevel}px` }}>
                  <span className="text-[10px] font-mono font-semibold text-slate-400">{formatTime(t).slice(0,5)}</span>
                </div>
              ))}
              {/* Shot change markers */}
              {shotChanges.map((sc, i) => (
                <div key={i} className="absolute top-0 bottom-0 w-px bg-yellow-500/50 pointer-events-none" style={{ left: `${sc * zoomLevel}px` }} />
              ))}

            </div>

            {/* ── FILMSTRIP THUMBNAILS (Directly under ruler) ── */}
            {trackVisible.filmstrip && tTops.filmstrip !== undefined && (
              <div
                className="absolute left-0 right-0 border-b border-[var(--ss-line)] overflow-hidden pointer-events-none z-5 bg-[var(--ss-bg)]"
                style={{ top: `${tTops.filmstrip}px`, height: `${FILM_H}px` }}
              >
                {filmFrames.length > 0
                  ? filmFrames.map((fr, i) => {
                      const nextTime = filmFrames[i+1]?.time ?? effectiveDuration;
                      const left  = fr.time * zoomLevel;
                      const width = (nextTime - fr.time) * zoomLevel;
                      return (
                        <div
                          key={fr.time}
                          className="absolute top-0 bottom-0 border-r border-black/40 overflow-hidden"
                          style={{ left: `${left}px`, width: `${width}px` }}
                        >
                          <img
                            src={fr.dataUrl}
                            alt=""
                            className="w-full h-full object-cover"
                            draggable={false}
                          />
                        </div>
                      );
                    })
                  : (
                    marks.map(t => (
                      <div
                        key={t}
                        className="absolute top-0 bottom-0 border-r border-black/40 bg-[var(--kt-s1)] flex items-center justify-center"
                        style={{ left: `${t * zoomLevel}px`, width: `${rulerStep * zoomLevel}px` }}
                      >
                        <Film size={12} className="text-slate-700/60" />
                      </div>
                    ))
                  )
                }
              </div>
            )}

            {/* ── SUBTITLE TRACK ── */}
            {trackVisible.subtitle && tTops.subtitle !== undefined && (
              <div
                className="absolute left-0 right-0 border-b border-[var(--ss-line)] bg-[var(--kt-s1)]/70 z-20"
                style={{ top: `${tTops.subtitle}px`, height: `${SUBTITLE_H}px`, pointerEvents: 'none' }}
              >
                {visibleEvents.map((ev) => {
                  const id = ev.id ?? ev.event_id;
                  return (
                    <TimelineSubtitleBlock
                      key={id}
                      event={ev}
                      zoomLevel={zoomLevel}
                      isActive={activeEventId === id}
                      effectiveDuration={effectiveDuration}
                      cplLimit={cplLimit}
                      cpsLimit={cpsLimit}
                      setActiveEventId={setActiveEventId}
                      onSeek={onSeek}
                      handleMouseDown={handleMouseDown}
                      onContextMenu={handleBlockContextMenu}
                      isInternalSeekRef={isInternalSeekRef}
                      scrollRef={scrollRef}
                      hideText={hideBlockText}
                    />
                  );
                })}
              </div>
            )}

            {/* ── WAVEFORM TRACK ── */}
            {trackVisible.waveform && tTops.waveform !== undefined && (
              <div
                className="absolute left-0 right-0 border-b border-[var(--ss-line)] bg-[var(--kt-s0)] z-0 overflow-hidden"
                style={{ top: `${tTops.waveform}px`, height: `${WAVEFORM_H}px`, pointerEvents: 'none' }}
              >
                <canvas
                  ref={canvasRef}
                  className="absolute top-0 left-0 block"
                  style={{
                    height: `${WAVEFORM_H}px`,
                    pointerEvents: 'none',
                    willChange: 'transform'
                  }}
                />
                {isAudioLoading && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-[10px] text-emerald-400/80 animate-pulse font-mono">Rendering waveform...</span>
                  </div>
                )}
              </div>
            )}

            {/* ── SPEAKER TRACK (OOONA Solid Rects with Hashed Distinct Colors) ── */}
            {trackVisible.speaker && tTops.speaker !== undefined && (
              <div
                className="absolute left-0 right-0 border-b border-[var(--ss-line)] bg-[var(--kt-s1)]/60 z-20"
                style={{ top: `${tTops.speaker}px`, height: `${SPEAKER_H}px`, pointerEvents: 'none' }}
              >
                {visibleEvents.map((ev, idx) => {
                  const start = ev.start_time ?? ev.start ?? 0;
                  const end   = ev.end_time   ?? ev.end   ?? 0;
                  const startX = start * zoomLevel;
                  const width  = Math.max((end - start) * zoomLevel, 12);
                  const spk    = ev.speaker || 'Speaker 1';
                  const preset = getSpeakerPreset(spk, idx);

                  return (
                    <div
                      key={ev.id ?? idx}
                      className={`absolute top-1 bottom-1 rounded-md px-2 flex items-center gap-1.5 overflow-hidden cursor-pointer shadow-xs transition-all hover:brightness-110 ${preset.bg} ${preset.border} ${preset.text}`}
                      style={{ left: `${startX}px`, width: `${width}px`, pointerEvents: 'auto' }}
                      onClick={(e) => { e.stopPropagation(); setActiveEventId(ev.id ?? ev.event_id); onSeek(start); }}
                    >
                      <Users size={10} className="shrink-0 text-white/90" />
                      <span className="text-[11px] font-semibold whitespace-nowrap truncate">{spk}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── Shift-drag selection overlay ── */}
            {selSt && tTops.subtitle !== undefined && (
              <div
                className="absolute z-30 pointer-events-none border border-[var(--ss-accent)] bg-[var(--ss-accent)]/15"
                style={{
                  top: `${tTops.subtitle}px`, height: `${SUBTITLE_H}px`,
                  left: `${Math.min(selSt.startX, selSt.currentX)}px`,
                  width: `${Math.max(Math.abs(selSt.currentX - selSt.startX), 4)}px`
                }}
              >
                <div className="m-1 bg-[var(--ss-accent)] text-[var(--ss-accent-ink)] text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-sm w-fit shadow-md">+ Subtitle</div>
              </div>
            )}

            {/* ── RED PLAYHEAD NEEDLE (position set directly from the playhead bus; head is draggable) ── */}
            <div
              ref={needleRef}
              className="absolute top-0 bottom-0 left-0 w-0 z-40 pointer-events-none will-change-transform"
              style={{ transform: `translateX(${getPlayhead() * zoomLevel}px)` }}
            >
              <div className="absolute top-0 bottom-0 -left-px w-px bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.9)]" />
              <div
                onMouseDown={startScrub}
                onClick={(e) => e.stopPropagation()}
                className="absolute -top-0.5 -left-[7px] w-3.5 h-3.5 bg-red-500 rounded-sm rotate-45 border border-red-300 shadow-md pointer-events-auto cursor-ew-resize"
                title="Drag to scrub"
              />
            </div>

          </div>
        </div>
      </div>
      </div>

      {/* ── Right-Click Context Menu (Fixed Viewport Clamped) ── */}
      {contextMenu && (
        <div
          className="fixed z-[99999] min-w-[190px] bg-[var(--ss-panel)] border border-[var(--kt-s4)] rounded-xl shadow-2xl py-1.5 text-xs text-slate-200 backdrop-blur-md overflow-hidden animate-studio-entrance"
          style={{
            left: `${Math.min(contextMenu.x, window.innerWidth - 210)}px`,
            top: `${Math.min(contextMenu.y, window.innerHeight - 250)}px`,
            pointerEvents: 'auto'
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-1">
            <ContextMenuItem
              icon={<Play size={12} className="text-[var(--ss-accent)]" />}
              label="Play this subtitle"
              onClick={() => { setActiveEventId(contextMenu.eventId); if (onPlayEvent) onPlayEvent(contextMenu.eventId); else onSeek(contextMenu.start); setContextMenu(null); }}
            />
            <ContextMenuItem
              icon={<Eye size={12} className="text-slate-300" />}
              label="Select subtitle"
              onClick={() => { setActiveEventId(contextMenu.eventId); setContextMenu(null); }}
            />
            {onSplitAtTime && contextMenu.clickTime > contextMenu.start + 0.05 && contextMenu.clickTime < contextMenu.end - 0.05 && (
              <ContextMenuItem
                icon={<Split size={12} className="text-emerald-400" />}
                label="Split here"
                onClick={() => { onSplitAtTime(contextMenu.clickTime); setContextMenu(null); }}
              />
            )}
            <div className="h-px bg-[var(--ss-line)] my-1" />
            <ContextMenuItem
              icon={<AlignLeft size={12} className="text-[var(--ss-accent)]" />}
              label="Set start to playhead"
              onClick={() => { const t = getPlayhead(); if (t < contextMenu.end) onEventTimeChange(contextMenu.eventId, t, contextMenu.end); setContextMenu(null); }}
            />
            <ContextMenuItem
              icon={<AlignRight size={12} className="text-[var(--ss-accent)]" />}
              label="Set end to playhead"
              onClick={() => { const t = getPlayhead(); if (t > contextMenu.start) onEventTimeChange(contextMenu.eventId, contextMenu.start, t); setContextMenu(null); }}
            />
            <ContextMenuItem
              icon={<MoveHorizontal size={12} className="text-amber-400" />}
              label="Move this and following to playhead"
              onClick={() => { onShiftAllFollowing?.(contextMenu.eventId, getPlayhead()); setContextMenu(null); }}
            />
            {onDeleteEvent && (
              <>
                <div className="h-px bg-[var(--ss-line)] my-1" />
                <ContextMenuItem
                  icon={<Trash2 size={12} className="text-rose-400" />}
                  label="Delete subtitle"
                  danger
                  onClick={() => { onDeleteEvent(contextMenu.eventId); setContextMenu(null); }}
                />
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Drag Tooltip ── */}
      {dragTooltip && (
        <div
          className="fixed z-[99999] bg-[var(--ss-panel)]/96 border border-[var(--ss-accent)]/80 text-white text-[11px] font-mono px-3 py-1.5 rounded-lg shadow-2xl pointer-events-none flex items-center gap-2"
          style={{ left: `${dragTooltip.x + 14}px`, top: `${dragTooltip.y}px` }}
        >
          <span className="text-[var(--ss-accent)] font-bold">{dragTooltip.t}</span>
          <span className="text-slate-400">({dragTooltip.d})</span>
        </div>
      )}
    </div>
  );
}

function ToolbarButton({ title, label, onClick, disabled = false, danger = false, children }) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={() => { if (!disabled) onClick?.(); }}
      className={`px-2 py-1 rounded text-[11px] font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed ${
        danger ? 'text-slate-300 hover:text-rose-300 hover:bg-rose-500/10' : 'text-slate-300 hover:text-white hover:bg-[var(--ss-raised)]'
      }`}
    >
      {children}{label && <span>{label}</span>}
    </button>
  );
}

/** Toolbar button that is enabled or disabled depending on where the playhead is. It watches the playhead itself,
 *  so the timeline around it re-renders only when the button actually flips, not as the playhead moves. */
function PlayheadButton({ unavailable = false, disabledAt, deps = [], ...rest }) {
  const atDisabled = usePlayheadSelector(unavailable ? null : disabledAt, [unavailable, ...deps]);
  return <ToolbarButton {...rest} disabled={unavailable || Boolean(atDisabled)} />;
}

function ContextMenuItem({ icon, label, shortcut, danger, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-left cursor-pointer transition-colors ${
        danger
          ? 'text-rose-400 hover:bg-rose-500/15 hover:text-rose-300'
          : 'text-slate-200 hover:bg-[var(--ss-hover)] hover:text-white'
      }`}
    >
      <div className="flex items-center gap-2">
        {icon}
        <span>{label}</span>
      </div>
      {shortcut && <span className="text-[10px] text-slate-500 font-mono shrink-0">{shortcut}</span>}
    </button>
  );
}
