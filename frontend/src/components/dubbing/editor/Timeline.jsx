import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Lock, Unlock, Film, AudioLines } from 'lucide-react';
import { themeColor, withAlpha } from '../../../theme/themeEngine';
import {
  clipEnd, clipLength, clipOut, isEditable, moveClips, trimClips, slipClips, rollEdit, razor, snapTargets, nearestSnap,
  audible, timecode, expandLinked, linkGroup, clipsAt, gapAt, leftNeighbour, rightNeighbour, sequenceEnd,
} from './editModel';

export const LABEL_W = 176;
const RULER_H = 28;
const rowHeight = (t) => (t.kind === 'video' ? 44 : 58);
const DRAG_PX = 3;
const SNAP_PX = 8;
const EPS = 1e-3;
export const TOOLS = {
  select: { label: 'Selection', key: 'V' },
  ripple: { label: 'Ripple Edit', key: 'B' },
  roll: { label: 'Rolling Edit', key: 'N' },
  slip: { label: 'Slip', key: 'Y' },
  razor: { label: 'Razor', key: 'C' },
};

// Draws peaks (0..1 spread evenly over `span` seconds of source) for the source times [s0, s1] into a canvas `w` px wide.
function drawPeaks(canvas, { peaks, span, s0, s1, w, h, color }) {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(w * dpr));
  canvas.height = Math.floor(h * dpr);
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  if (!peaks?.length || !(span > 0) || w <= 0) return;
  g.fillStyle = color;
  const n = peaks.length;
  const mid = h / 2;
  const per = (s1 - s0) / w;
  for (let x = 0; x < w; x += 1) {
    const a = Math.floor(((s0 + x * per) / span) * n);
    const b = Math.max(a + 1, Math.floor(((s0 + (x + 1) * per) / span) * n));
    if (b <= 0 || a >= n) continue;
    let v = 0;
    for (let i = Math.max(0, a); i < Math.min(n, b); i += 1) if (peaks[i] > v) v = peaks[i];
    const hh = Math.max(1, v * (h - 4));
    g.fillRect(x, mid - hh / 2, 1, hh);
  }
}

// Waveform of the visible part of a clip: its source from `in` onwards. Only what is on screen is drawn, so the
// timeline can zoom to single frames on long media.
function ClipWave({ peaks, span, clip, len, pps, view, height, color }) {
  const ref = useRef(null);
  const left = clip.start * pps;
  const a = Math.max(left, view.left - LABEL_W);
  const b = Math.min(left + len * pps, view.left + view.width);
  const w = Math.max(0, Math.ceil(b - a));
  useEffect(() => {
    if (w <= 0) return;
    const s0 = clip.in + (a - left) / pps;
    drawPeaks(ref.current, { peaks, span, s0, s1: s0 + w / pps, w, h: height, color });
  }, [peaks, span, clip.in, a, left, w, pps, height, color]);
  if (w <= 0) return null;
  return <canvas ref={ref} className="absolute bottom-0 pointer-events-none" style={{ left: a - left, width: w, height }} />;
}

export default function Timeline({
  edit, ctx, fps, pps, setPps, minPps, maxPps, getTime, seek, selection, setSelection, dispatch, snapping,
  peaks, linePeaks, palette, filename, scrollToRef, playing, tool, linked, gap, setGap,
}) {
  const scroller = useRef(null);
  const head = useRef(null);
  const [view, setView] = useState({ left: 0, width: 800 });
  const [drag, setDrag] = useState(null);
  const [snapAt, setSnapAt] = useState(null);
  const [tip, setTip] = useState(null);
  const [marquee, setMarquee] = useState(null);
  const [razorAt, setRazorAt] = useState(null);
  const zoomAnchor = useRef(null);
  const seqLen = Math.max(ctx.duration, sequenceEnd(edit, ctx));
  const width = Math.max(1, Math.ceil(seqLen * pps));
  const on = useMemo(() => audible(edit), [edit]);
  const speakerColor = useMemo(() => {
    const m = {}; let i = 0;
    for (const t of edit.tracks) if (t.role === 'speaker') { m[t.id] = palette[i % palette.length]; i += 1; }
    return m;
  }, [edit.tracks, palette]);
  const rows = useMemo(() => edit.tracks.reduce((acc, t) => {
    const top = acc.length ? acc[acc.length - 1].top + acc[acc.length - 1].height : RULER_H;
    return [...acc, { track: t, top, height: rowHeight(t) }];
  }, []), [edit.tracks]);
  const clipsByTrack = useMemo(() => {
    const m = {};
    for (const c of edit.clips) (m[c.track] = m[c.track] || []).push(c);
    return m;
  }, [edit.clips]);
  const sel = useMemo(() => new Set(selection), [selection]);
  const t0 = view.left / pps;
  const t1 = (view.left + view.width) / pps;

  // keep the visible window in state (for drawing only what is on screen)
  const measure = useCallback(() => {
    const el = scroller.current;
    if (el) setView((v) => (v.left === el.scrollLeft && v.width === el.clientWidth ? v : { left: el.scrollLeft, width: el.clientWidth }));
  }, []);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return undefined;
    let raf = 0;
    const onScroll = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(measure); };
    el.addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(measure); ro.observe(el);
    measure();
    return () => { el.removeEventListener('scroll', onScroll); ro.disconnect(); cancelAnimationFrame(raf); };
  }, [measure]);

  // zoom keeps the time under the cursor (or the playhead) where it was
  useLayoutEffect(() => {
    const a = zoomAnchor.current; const el = scroller.current;
    if (a && el) { el.scrollLeft = Math.max(0, a.t * pps - a.x); zoomAnchor.current = null; measure(); }
  }, [pps, measure]);
  const zoomTo = useCallback((next, clientX) => {
    const el = scroller.current;
    if (!el) return;
    const v = Math.max(minPps, Math.min(maxPps, next));
    const r = el.getBoundingClientRect();
    const x = clientX != null ? clientX - r.left - LABEL_W : Math.min(el.clientWidth - LABEL_W, Math.max(0, getTime() * pps - el.scrollLeft));
    zoomAnchor.current = { t: (el.scrollLeft + x) / pps, x };
    setPps(v);
  }, [minPps, maxPps, pps, setPps, getTime]);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      if (!(e.ctrlKey || e.metaKey || e.altKey)) return;
      e.preventDefault();
      zoomTo(pps * (e.deltaY < 0 ? 1.2 : 1 / 1.2), e.clientX);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomTo, pps]);
  // the workspace asks to scroll a time into view (asset clicks, Up/Down) and to zoom (keys)
  useEffect(() => {
    scrollToRef.current = {
      reveal: (t) => {
        const el = scroller.current; if (!el) return;
        const x = t * pps;
        if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - LABEL_W - 40) el.scrollLeft = Math.max(0, x - (el.clientWidth - LABEL_W) / 3);
      },
      zoom: (factor) => zoomTo(pps * factor),
      fit: () => { const el = scroller.current; if (el) { setPps(Math.max(minPps, Math.min(maxPps, (el.clientWidth - LABEL_W - 24) / seqLen))); el.scrollLeft = 0; } },
    };
  }, [scrollToRef, pps, zoomTo, setPps, minPps, maxPps, seqLen]);

  // the playhead follows the clock without re-rendering the timeline; it pages along while playing
  useEffect(() => {
    let raf;
    const tick = () => {
      const t = getTime();
      if (head.current) head.current.style.transform = `translateX(${t * pps}px)`;
      const el = scroller.current;
      if (el && el.dataset.playing === '1' && !drag) {
        const x = t * pps; const vis = el.clientWidth - LABEL_W;
        if (x > el.scrollLeft + vis - 30 || x < el.scrollLeft) el.scrollLeft = Math.max(0, x - 40);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [getTime, pps, drag]);

  const timeAt = (clientX) => {
    const el = scroller.current; const r = el.getBoundingClientRect();
    return (clientX - r.left - LABEL_W + el.scrollLeft) / pps;
  };
  const contentPoint = (e) => {
    const el = scroller.current; const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left + el.scrollLeft, y: e.clientY - r.top + el.scrollTop };
  };
  const snapTime = (t, useSnap) => {
    if (!useSnap) return t;
    const hit = nearestSnap([t], snapTargets(edit, ctx, getTime()), SNAP_PX / pps);
    return hit ? hit.at : t;
  };
  const group = (c, alt) => (linked && !alt ? linkGroup(edit, c.id) : [c.id]);

  // ------------------------------------------------------------------ pointer
  const onRulerDown = (e) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    seek(Math.max(0, Math.min(seqLen, timeAt(e.clientX))));
    setDrag({ mode: 'scrub' });
  };
  const begin = (e, d) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dispatch({ type: 'begin' });
    setDrag({ ...d, x0: e.clientX, base: edit, started: false, targets: snapTargets(edit, ctx, getTime(), new Set(d.ids || [d.id])) });
  };
  const onClipDown = (e, c, part) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setGap(null);
    const useSnap = snapping !== (e.ctrlKey || e.metaKey);
    if (tool === 'razor') {
      const t = snapTime(timeAt(e.clientX), useSnap);
      const ids = e.shiftKey ? clipsAt(edit, t, ctx).map((x) => x.id) : group(c, e.altKey);
      dispatch({ type: 'commit', edit: razor(edit, ids, t, ctx) });
      return;
    }
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    const mine = group(c, e.altKey);
    let ids = selection;
    if (additive && part === 'body') ids = sel.has(c.id) ? selection.filter((x) => !mine.includes(x)) : [...new Set([...selection, ...mine])];
    else if (!sel.has(c.id) || part !== 'body') ids = mine;
    setSelection(ids);
    if (!isEditable(c, edit) || !ids.includes(c.id)) return;
    if (tool === 'slip') { begin(e, { mode: 'slip', id: c.id, ids: mine }); return; }
    if (part === 'body') { if (tool === 'select') begin(e, { mode: 'move', id: c.id, ids }); return; }
    const edgeAt = part === 'left' ? c.start : clipEnd(c, ctx);
    if (tool === 'roll') {
      const left = part === 'right' ? c : leftNeighbour(edit, c, ctx);
      if (left && rightNeighbour(edit, left, ctx)) { begin(e, { mode: 'roll', id: left.id, alt: e.altKey }); return; }
    }
    // the clip and its linked clips that share this edge trim together
    const same = mine.map((id) => edit.clips.find((x) => x.id === id))
      .filter((x) => x && Math.abs((part === 'left' ? x.start : clipEnd(x, ctx)) - edgeAt) < EPS).map((x) => x.id);
    begin(e, { mode: 'trim', edge: part, id: c.id, ids: same, ripple: tool === 'ripple' });
  };
  const onBgDown = (e, trackId) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const keep = e.shiftKey || e.ctrlKey || e.metaKey;
    if (!keep) setSelection([]);
    setGap(null);
    setDrag({ mode: 'marquee', p0: contentPoint(e), keep: keep ? selection : [], trackId, t: timeAt(e.clientX), moved: false, alt: e.altKey });
  };
  const onMove = (e) => {
    if (!drag) {
      if (tool === 'razor') {
        const p = contentPoint(e);
        setRazorAt(p.x > LABEL_W && p.y > RULER_H ? snapTime(timeAt(e.clientX), snapping !== (e.ctrlKey || e.metaKey)) : null);
      }
      return;
    }
    if (drag.mode === 'scrub') { seek(Math.max(0, Math.min(seqLen, timeAt(e.clientX)))); return; }
    if (drag.mode === 'marquee') {
      const p = contentPoint(e);
      if (!drag.moved && Math.hypot(p.x - drag.p0.x, p.y - drag.p0.y) < DRAG_PX) return;
      if (!drag.moved) setDrag((d) => ({ ...d, moved: true }));
      const box = { x0: Math.min(p.x, drag.p0.x), x1: Math.max(p.x, drag.p0.x), y0: Math.min(p.y, drag.p0.y), y1: Math.max(p.y, drag.p0.y) };
      setMarquee(box);
      const ta = (box.x0 - LABEL_W) / pps; const tb = (box.x1 - LABEL_W) / pps;
      const hit = [];
      for (const row of rows) {
        if (row.top + row.height < box.y0 || row.top > box.y1) continue;
        for (const c of clipsByTrack[row.track.id] || []) if (c.start < tb && clipEnd(c, ctx) > ta) hit.push(c.id);
      }
      setSelection([...new Set([...drag.keep, ...(linked && !drag.alt ? expandLinked(edit, hit) : hit)])]);
      return;
    }
    const px = e.clientX - drag.x0;
    if (!drag.started && Math.abs(px) < DRAG_PX) return;
    if (!drag.started) setDrag((d) => ({ ...d, started: true }));
    const dt = px / pps;
    const snap = snapping !== (e.ctrlKey || e.metaKey) ? { targets: drag.targets, threshold: SNAP_PX / pps } : null;
    let res;
    if (drag.mode === 'move') res = moveClips(drag.base, drag.ids, dt, ctx, snap);
    else if (drag.mode === 'trim') res = trimClips(drag.base, drag.ids, drag.edge, dt, ctx, snap, { grab: drag.id, ripple: drag.ripple });
    else if (drag.mode === 'slip') res = slipClips(drag.base, drag.ids, dt, ctx);
    else res = rollEdit(drag.base, drag.id, dt, ctx, snap, linked && !drag.alt);
    dispatch({ type: 'preview', edit: res.edit });
    setSnapAt(res.snapAt);
    const c = res.edit.clips.find((x) => x.id === drag.id);
    const b = drag.base.clips.find((x) => x.id === drag.id);
    let text = '';
    if (drag.mode === 'move') text = `${c.start - b.start >= 0 ? '+' : ''}${(c.start - b.start).toFixed(2)}s · ${timecode(c.start, fps)}`;
    else if (drag.mode === 'trim') text = `${drag.ripple ? 'Ripple ' : ''}${drag.edge === 'left' ? 'In' : 'Out'} ${timecode(drag.edge === 'left' ? (drag.ripple ? c.in : c.start) : clipEnd(c, ctx), fps)} · ${clipLength(c, ctx).toFixed(2)}s`;
    else if (drag.mode === 'slip') text = `Source ${timecode(c.in, fps)} – ${timecode(clipOut(c, ctx), fps)}`;
    else text = `Cut at ${timecode(clipEnd(c, ctx), fps)} (${(clipEnd(c, ctx) - clipEnd(b, ctx) >= 0 ? '+' : '')}${(clipEnd(c, ctx) - clipEnd(b, ctx)).toFixed(2)}s)`;
    setTip({ x: e.clientX, y: e.clientY, text });
  };
  const onUp = () => {
    if (!drag) return;
    if (drag.mode === 'marquee' && !drag.moved && !drag.keep.length) setGap(gapAt(edit, drag.trackId, drag.t, ctx));
    if (!['scrub', 'marquee'].includes(drag.mode)) dispatch({ type: 'end' });
    setDrag(null); setSnapAt(null); setTip(null); setMarquee(null);
  };

  // ------------------------------------------------------------------ drawing
  const ticks = [];
  const minor = [1 / fps, 5 / fps, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find((s) => s * pps >= 9) || 600;
  const major = [1 / fps * 5, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800].find((s) => s * pps >= 90 && s >= minor) || 1800;
  for (let i = Math.floor(t0 / minor); i * minor <= Math.min(seqLen, t1); i += 1) {
    const t = i * minor;
    const isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6;
    ticks.push({ t, isMajor });
  }
  const faint = themeColor('faint');
  const colorOf = (track) => speakerColor[track.id] || (track.role === 'background' ? themeColor('success') : track.kind === 'video' ? themeColor('accent') : faint);
  const bodyCursor = tool === 'razor' ? 'crosshair' : tool === 'slip' ? 'ew-resize' : tool === 'select' ? 'grab' : 'default';
  const edgeCursor = tool === 'roll' ? 'col-resize' : tool === 'ripple' ? 'w-resize' : 'ew-resize';

  const edges = (c) => (isEditable(c, edit) && tool !== 'razor' && tool !== 'slip' ? <>
    <div className="absolute left-0 top-0 bottom-0 w-[6px] hover:bg-[var(--kt-text)]/30 z-[1]" style={{ cursor: edgeCursor }} onPointerDown={(e) => onClipDown(e, c, 'left')} />
    <div className="absolute right-0 top-0 bottom-0 w-[6px] hover:bg-[var(--kt-text)]/30 z-[1]" style={{ cursor: edgeCursor }} onPointerDown={(e) => onClipDown(e, c, 'right')} />
  </> : null);

  const renderClip = (c, track, h) => {
    const start = c.start; const len = clipLength(c, ctx); const end = start + len;
    if (end < t0 - 2 || start > t1 + 2) return null;
    const color = colorOf(track);
    const left = start * pps; const w = Math.max(2, len * pps);
    const selected = sel.has(c.id);
    const frame = { left, width: w, borderColor: selected ? themeColor('text') : withAlpha(color, 0.7), boxShadow: selected ? `0 0 0 1px ${themeColor('text')}` : undefined, cursor: isEditable(c, edit) ? bodyCursor : 'default' };
    if (c.source !== 'line') {
      return (
        <div key={c.id} onPointerDown={(e) => onClipDown(e, c, 'body')}
          className={`absolute top-1 bottom-1 rounded-sm overflow-hidden border ${c.disabled ? 'opacity-35' : ''}`}
          style={{ ...frame, background: c.disabled ? `repeating-linear-gradient(135deg, ${withAlpha(color, 0.12)} 0 6px, transparent 6px 12px)` : withAlpha(color, track.kind === 'video' ? 0.16 : 0.12) }}
          title={`${track.name} · source ${timecode(c.in, fps)} – ${timecode(clipOut(c, ctx), fps)}`}>
          {track.kind === 'video'
            ? <div className="absolute top-0 bottom-0 inline-flex items-center gap-1.5 px-2 text-[11px] text-[var(--kt-muted)] whitespace-nowrap pointer-events-none" style={{ left: Math.max(0, view.left - left) }}><Film size={12} />{filename} <span className="text-[var(--kt-faint)]" style={{ fontFamily: 'var(--kt-font-mono)' }}>{timecode(c.in, fps)}</span></div>
            : <ClipWave peaks={track.role === 'background' ? peaks.background : peaks.original} span={ctx.duration} clip={c} len={len} pps={pps} view={view} height={h - 8} color={withAlpha(color, 0.75)} />}
          {edges(c)}
        </div>
      );
    }
    const seg = ctx.lines[c.line] || {};
    const audio = seg.audio || {};
    const status = !audio.ready ? 'none' : audio.overrun ? 'over' : audio.stale ? 'stale' : 'ok';
    const lp = linePeaks[c.line];
    return (
      <div key={c.id} onPointerDown={(e) => onClipDown(e, c, 'body')} onDoubleClick={() => seek(c.start)}
        className={`absolute top-1 bottom-1 rounded-sm overflow-hidden ${status === 'none' ? 'border border-dashed' : 'border'} ${c.disabled || seg.mute ? 'opacity-35' : ''}`}
        style={{
          ...frame, borderColor: selected ? themeColor('text') : color,
          background: c.disabled ? `repeating-linear-gradient(135deg, ${withAlpha(color, 0.12)} 0 6px, transparent 6px 12px)` : withAlpha(color, status === 'none' ? 0.08 : 0.28),
        }}
        title={`${seg.speaker || ''} · ${seg.translation || seg.text || ''}`}>
        {audio.ready && lp ? <ClipWave peaks={lp.peaks} span={lp.duration} clip={c} len={len} pps={pps} view={view} height={h - 22} color={withAlpha(color, 0.9)} /> : null}
        <div className="relative flex items-center gap-1 px-1.5 h-[16px] text-[10px] leading-[16px] text-[var(--kt-text)] whitespace-nowrap pointer-events-none">
          {status === 'stale' ? <span className="h-1.5 w-1.5 rounded-full shrink-0 bg-[var(--kt-warn)]" title="Changed since generated" /> : null}
          {status === 'over' ? <span className="h-1.5 w-1.5 rounded-full shrink-0 bg-[var(--kt-danger)]" title="Longer than its slot" /> : null}
          <span className="truncate" style={{ fontFamily: 'var(--kt-font-script)' }}>{status === 'none' ? 'No speech yet · ' : ''}{seg.translation || seg.text}</span>
        </div>
        {edges(c)}
      </div>
    );
  };

  const toggleTrack = (t, key) => {
    const next = { ...edit, tracks: edit.tracks.map((x) => (x.id === t.id ? { ...x, [key]: !x[key] } : x)) };
    dispatch({ type: 'commit', edit: next });
  };
  const HeadBtn = ({ on: active, onClick, title, children, tone }) => (
    <button type="button" title={title} aria-pressed={!!active} onClick={onClick} onPointerDown={(e) => e.stopPropagation()}
      className={`h-[18px] min-w-[18px] px-1 rounded-[3px] text-[10px] font-bold grid place-items-center cursor-pointer border ${active ? (tone || 'bg-[var(--kt-accent)] text-[var(--kt-accent-ink)] border-transparent') : 'border-[var(--kt-s5)] text-[var(--kt-muted)] hover:text-[var(--kt-text)]'}`}>
      {children}
    </button>
  );

  const selectedLine = selection.length === 1 ? edit.clips.find((c) => c.id === selection[0] && c.source === 'line') : null;
  const ghost = selectedLine ? ctx.lines[selectedLine.line] : null;

  return (
    <div ref={scroller} data-timeline data-playing={playing ? '1' : '0'} className="relative flex-1 min-h-0 overflow-auto select-none bg-[var(--kt-s0)]"
      onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={() => setRazorAt(null)}>
      <div className="relative" style={{ width: LABEL_W + width + 200, minHeight: '100%' }}>
        {/* ruler */}
        <div className="flex sticky top-0 z-30" style={{ height: RULER_H }}>
          <div className="sticky left-0 z-10 shrink-0 bg-[var(--kt-s1)] border-r border-b border-[var(--kt-s4)] px-2 flex items-center text-[10px] text-[var(--kt-faint)]" style={{ width: LABEL_W }}>
            {Math.round(pps)} px/s
          </div>
          <div className="relative shrink-0 bg-[var(--kt-s1)] border-b border-[var(--kt-s4)] cursor-text" style={{ width: width + 200 }} onPointerDown={onRulerDown}>
            {ticks.map(({ t, isMajor }) => (
              <div key={t} className={`absolute bottom-0 border-l ${isMajor ? 'h-full border-[var(--kt-s5)]' : 'h-[6px] border-[var(--kt-s4)]'}`} style={{ left: t * pps }}>
                {isMajor ? <span className="absolute top-0.5 left-1 text-[10px] text-[var(--kt-faint)] whitespace-nowrap" style={{ fontFamily: 'var(--kt-font-mono)' }}>{timecode(t, fps)}</span> : null}
              </div>
            ))}
          </div>
        </div>

        {rows.map(({ track: t, height: h }) => (
          <div key={t.id} className="flex border-b border-[var(--kt-s4)]" style={{ height: h }}>
            <div className="sticky left-0 z-20 shrink-0 bg-[var(--kt-s1)] border-r border-[var(--kt-s4)] px-2 flex flex-col justify-center gap-1" style={{ width: LABEL_W }}>
              <div className="flex items-center gap-1.5 text-xs min-w-0">
                {t.role === 'speaker' ? <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: colorOf(t) }} /> : t.kind === 'video' ? <Film size={12} className="shrink-0 text-[var(--kt-faint)]" /> : <AudioLines size={12} className="shrink-0 text-[var(--kt-faint)]" />}
                <span className="truncate font-medium" title={t.name}>{t.name}</span>
                {t.kind === 'audio' && !on[t.id] ? <span className="ml-auto text-[9px] uppercase tracking-wider text-[var(--kt-faint)]">silent</span> : null}
              </div>
              <div className="flex items-center gap-1">
                {t.kind === 'audio' ? <>
                  <HeadBtn on={t.mute} title={t.role === 'original' ? 'Mute the original (it is a reference and not part of the dub mix)' : 'Mute this track'} onClick={() => toggleTrack(t, 'mute')} tone="bg-[var(--kt-warn)] text-[var(--kt-s0)] border-transparent">M</HeadBtn>
                  <HeadBtn on={t.solo} title="Solo: hear only soloed tracks" onClick={() => toggleTrack(t, 'solo')} tone="bg-[var(--kt-success)] text-[var(--kt-s0)] border-transparent">S</HeadBtn>
                </> : null}
                <HeadBtn on={t.locked} title={t.locked ? 'Unlock this track' : 'Lock this track: its clips cannot be edited, and ripple edits leave it in place'} onClick={() => toggleTrack(t, 'locked')}>{t.locked ? <Lock size={10} /> : <Unlock size={10} />}</HeadBtn>
                {t.role === 'original' ? <span className="text-[9px] text-[var(--kt-faint)] ml-1">reference</span> : null}
              </div>
            </div>
            <div className={`relative shrink-0 ${t.locked ? 'bg-[repeating-linear-gradient(135deg,transparent_0_8px,var(--kt-s1)_8px_16px)]' : ''}`} style={{ width: width + 200, cursor: tool === 'razor' ? 'crosshair' : undefined }} onPointerDown={(e) => onBgDown(e, t.id)}>
              <div className="absolute top-0 bottom-0 left-0 bg-[var(--kt-s1)]/40" style={{ width }} />
              {gap && gap.track === t.id ? (
                <div className="absolute top-1 bottom-1 rounded-sm border border-[var(--kt-accent)] bg-[var(--kt-accent)]/15 pointer-events-none grid place-items-center text-[10px] text-[var(--kt-accent)] overflow-hidden whitespace-nowrap"
                  style={{ left: gap.a * pps, width: Math.max(2, (gap.b - gap.a) * pps) }}>Gap {(gap.b - gap.a).toFixed(2)}s · Delete closes it</div>
              ) : null}
              {ghost && selectedLine.track === t.id ? (
                <div className="absolute top-0.5 bottom-0.5 rounded-sm border border-dashed border-[var(--kt-faint)] pointer-events-none" style={{ left: ghost.start * pps, width: Math.max(2, (ghost.end - ghost.start) * pps) }} title="The line's original time" />
              ) : null}
              {(clipsByTrack[t.id] || []).map((c) => renderClip(c, t, h))}
            </div>
          </div>
        ))}

        <div ref={head} className="absolute top-0 bottom-0 z-40 pointer-events-none" style={{ left: LABEL_W, width: 0 }}>
          <div className="absolute top-0 -left-[6px] w-[13px] h-[14px] bg-[var(--kt-accent)]" style={{ clipPath: 'polygon(0 0,100% 0,100% 60%,50% 100%,0 60%)' }} />
          <div className="absolute top-0 bottom-0 left-0 w-px bg-[var(--kt-accent)]" />
        </div>
        {snapAt != null ? <div className="absolute top-0 bottom-0 z-40 w-px bg-[var(--kt-warn)] pointer-events-none" style={{ left: LABEL_W + snapAt * pps }} /> : null}
        {tool === 'razor' && razorAt != null && !drag ? <div className="absolute bottom-0 z-40 w-px border-l border-dashed border-[var(--kt-danger)] pointer-events-none" style={{ top: RULER_H, left: LABEL_W + razorAt * pps }} /> : null}
        {marquee ? <div className="absolute z-40 border border-[var(--kt-accent)] bg-[var(--kt-accent)]/10 pointer-events-none" style={{ left: marquee.x0, top: marquee.y0, width: marquee.x1 - marquee.x0, height: marquee.y1 - marquee.y0 }} /> : null}
      </div>
      {tip ? <div className="pointer-events-none fixed z-50 px-1.5 py-0.5 rounded bg-[var(--kt-s3)] border border-[var(--kt-s5)] text-[11px] text-[var(--kt-text)] whitespace-nowrap" style={{ left: tip.x + 12, top: tip.y - 26, fontFamily: 'var(--kt-font-mono)' }}>{tip.text}</div> : null}
    </div>
  );
}
