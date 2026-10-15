import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Lock, Unlock, Film, AudioLines } from 'lucide-react';
import { themeColor, withAlpha } from '../../../theme/themeEngine';
import {
  clipEnd, clipLength, isEditable, moveClips, trimClip, snapTargets, audible, timecode,
} from './editModel';

export const LABEL_W = 176;
const RULER_H = 28;
const rowHeight = (t) => (t.kind === 'video' ? 40 : 58);
const DRAG_PX = 3;
const SNAP_PX = 8;

// Draws peaks (0..1 spread evenly over `span` seconds starting at `origin`) for the times [t0, t1] into a canvas `w` px wide.
function drawPeaks(canvas, { peaks, origin = 0, span, t0, t1, w, h, color }) {
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
  const per = (t1 - t0) / w;
  for (let x = 0; x < w; x += 1) {
    const a = Math.floor(((t0 + x * per - origin) / span) * n);
    const b = Math.max(a + 1, Math.floor(((t0 + (x + 1) * per - origin) / span) * n));
    if (b <= 0 || a >= n) continue;
    let v = 0;
    for (let i = Math.max(0, a); i < Math.min(n, b); i += 1) if (peaks[i] > v) v = peaks[i];
    const hh = Math.max(1, v * (h - 4));
    g.fillRect(x, mid - hh / 2, 1, hh);
  }
}

// A waveform for a long media track that only draws the visible part, so the timeline can zoom in to single frames.
function ViewportWave({ peaks, duration, view, pps, height, color }) {
  const ref = useRef(null);
  const w = Math.max(1, view.width - LABEL_W);
  useEffect(() => {
    drawPeaks(ref.current, { peaks, origin: 0, span: duration, t0: view.left / pps, t1: (view.left + w) / pps, w, h: height, color });
  }, [peaks, duration, view.left, w, pps, height, color]);
  return <canvas ref={ref} className="absolute top-0 pointer-events-none" style={{ left: view.left, width: w, height }} />;
}

function ClipWave({ peaks, clip, len, pps, height, color }) {
  const ref = useRef(null);
  const w = Math.max(1, Math.min(8000, len * pps));
  useEffect(() => {
    if (!peaks) return;
    drawPeaks(ref.current, { peaks: peaks.peaks, origin: 0, span: peaks.duration, t0: clip.in, t1: clip.in + len, w, h: height, color });
  }, [peaks, clip.in, len, w, height, color]);
  return <canvas ref={ref} className="absolute left-0 bottom-0 pointer-events-none" style={{ width: w, height }} />;
}

export default function Timeline({
  edit, ctx, fps, pps, setPps, minPps, maxPps, getTime, seek, selection, setSelection, dispatch, snapping,
  peaks, linePeaks, palette, filename, scrollToRef, playing,
}) {
  const scroller = useRef(null);
  const head = useRef(null);
  const [view, setView] = useState({ left: 0, width: 800 });
  const [drag, setDrag] = useState(null);
  const [snapAt, setSnapAt] = useState(null);
  const [tip, setTip] = useState(null);
  const [marquee, setMarquee] = useState(null);
  const zoomAnchor = useRef(null);
  const width = Math.max(1, Math.ceil(ctx.duration * pps));
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
      fit: () => { const el = scroller.current; if (el) { setPps(Math.max(minPps, Math.min(maxPps, (el.clientWidth - LABEL_W - 24) / ctx.duration))); el.scrollLeft = 0; } },
    };
  }, [scrollToRef, pps, zoomTo, setPps, minPps, maxPps, ctx.duration]);

  // the playhead follows the player without re-rendering the timeline; it pages along while playing
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

  // ------------------------------------------------------------------ pointer: scrub, move, trim, marquee
  const onRulerDown = (e) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    seek(Math.max(0, Math.min(ctx.duration, timeAt(e.clientX))));
    setDrag({ mode: 'scrub' });
  };
  const onClipDown = (e, c, mode) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    let ids = selection;
    if (mode !== 'move') ids = [c.id];
    else if (additive) ids = sel.has(c.id) ? selection.filter((x) => x !== c.id) : [...selection, c.id];
    else if (!sel.has(c.id)) ids = [c.id];
    setSelection(ids);
    if (!isEditable(c, edit) || (mode === 'move' && !ids.includes(c.id))) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const moving = mode === 'move' ? ids : [c.id];
    dispatch({ type: 'begin' });
    setDrag({ mode, id: c.id, ids: moving, x0: e.clientX, base: edit, started: false, targets: snapTargets(edit, ctx, getTime(), new Set(moving)) });
  };
  const onBgDown = (e) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const el = scroller.current; const r = el.getBoundingClientRect();
    const p = { x: e.clientX - r.left + el.scrollLeft, y: e.clientY - r.top + el.scrollTop };
    if (!(e.shiftKey || e.ctrlKey || e.metaKey)) setSelection([]);
    setDrag({ mode: 'marquee', p0: p, keep: e.shiftKey || e.ctrlKey || e.metaKey ? selection : [] });
  };
  const onMove = (e) => {
    if (!drag) return;
    if (drag.mode === 'scrub') { seek(Math.max(0, Math.min(ctx.duration, timeAt(e.clientX)))); return; }
    if (drag.mode === 'marquee') {
      const el = scroller.current; const r = el.getBoundingClientRect();
      const p = { x: e.clientX - r.left + el.scrollLeft, y: e.clientY - r.top + el.scrollTop };
      const box = { x0: Math.min(p.x, drag.p0.x), x1: Math.max(p.x, drag.p0.x), y0: Math.min(p.y, drag.p0.y), y1: Math.max(p.y, drag.p0.y) };
      setMarquee(box);
      const ta = (box.x0 - LABEL_W) / pps; const tb = (box.x1 - LABEL_W) / pps;
      const hit = [];
      for (const row of rows) {
        if (row.top + row.height < box.y0 || row.top > box.y1) continue;
        for (const c of clipsByTrack[row.track.id] || []) if (c.source === 'line' && c.start < tb && clipEnd(c, ctx) > ta) hit.push(c.id);
      }
      setSelection([...new Set([...drag.keep, ...hit])]);
      return;
    }
    const px = e.clientX - drag.x0;
    if (!drag.started && Math.abs(px) < DRAG_PX) return;
    if (!drag.started) setDrag((d) => ({ ...d, started: true }));
    const dt = px / pps;
    const snap = snapping !== (e.ctrlKey || e.metaKey) ? { targets: drag.targets, threshold: SNAP_PX / pps } : null;
    const res = drag.mode === 'move' ? moveClips(drag.base, drag.ids, dt, ctx, snap) : trimClip(drag.base, drag.id, drag.mode, dt, ctx, snap);
    dispatch({ type: 'preview', edit: res.edit });
    setSnapAt(res.snapAt);
    const c = res.edit.clips.find((x) => x.id === drag.id);
    const b = drag.base.clips.find((x) => x.id === drag.id);
    setTip({
      x: e.clientX, y: e.clientY,
      text: drag.mode === 'move'
        ? `${c.start - b.start >= 0 ? '+' : ''}${(c.start - b.start).toFixed(2)}s · ${timecode(c.start, fps)}`
        : `${drag.mode === 'left' ? 'In' : 'Out'} ${timecode(drag.mode === 'left' ? c.start : clipEnd(c, ctx), fps)} · ${clipLength(c, ctx).toFixed(2)}s`,
    });
  };
  const onUp = () => {
    if (!drag) return;
    if (drag.mode !== 'scrub' && drag.mode !== 'marquee') dispatch({ type: 'end' });
    setDrag(null); setSnapAt(null); setTip(null); setMarquee(null);
  };

  // ------------------------------------------------------------------ drawing
  const ticks = [];
  const minor = [1 / fps, 5 / fps, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find((s) => s * pps >= 9) || 600;
  const major = [1 / fps * 5, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800].find((s) => s * pps >= 90 && s >= minor) || 1800;
  for (let i = Math.floor(t0 / minor); i * minor <= Math.min(ctx.duration, t1); i += 1) {
    const t = i * minor;
    const isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6;
    ticks.push({ t, isMajor });
  }
  const faint = themeColor('faint');
  const colorOf = (track) => speakerColor[track.id] || (track.role === 'background' ? themeColor('success') : faint);

  const renderClip = (c, track, h) => {
    const start = c.start; const len = clipLength(c, ctx); const end = start + len;
    if (end < t0 - 2 || start > t1 + 2) return null;
    const color = colorOf(track);
    const left = start * pps; const w = Math.max(2, len * pps);
    const selected = sel.has(c.id);
    if (c.source !== 'line') {
      return (
        <div key={c.id} onPointerDown={(e) => onClipDown(e, c, 'move')}
          className={`absolute top-1 bottom-1 rounded-sm overflow-hidden border ${selected ? 'border-[var(--kt-text)]' : 'border-[var(--kt-s5)]'}`}
          style={{ left, width: w, background: withAlpha(color, 0.12) }} title="Fixed for now: the source media">
          {track.kind === 'video'
            ? <div className="absolute top-0 bottom-0 inline-flex items-center gap-1.5 px-2 text-[11px] text-[var(--kt-muted)] whitespace-nowrap" style={{ left: view.left }}><Film size={12} />{filename}</div>
            : <ViewportWave peaks={track.role === 'background' ? peaks.background : peaks.original} duration={ctx.duration} view={{ left: view.left, width: view.width }} pps={pps} height={h - 8} color={withAlpha(color, 0.75)} />}
        </div>
      );
    }
    const seg = ctx.lines[c.line] || {};
    const audio = seg.audio || {};
    const status = !audio.ready ? 'none' : audio.overrun ? 'over' : audio.stale ? 'stale' : 'ok';
    return (
      <div key={c.id} onPointerDown={(e) => onClipDown(e, c, 'move')} onDoubleClick={() => seek(c.start)}
        className={`absolute top-1 bottom-1 rounded-sm overflow-hidden ${status === 'none' ? 'border border-dashed' : 'border'} ${c.disabled || seg.mute ? 'opacity-35' : ''}`}
        style={{
          left, width: w, borderColor: selected ? themeColor('text') : color, boxShadow: selected ? `0 0 0 1px ${themeColor('text')}` : undefined,
          background: c.disabled ? `repeating-linear-gradient(135deg, ${withAlpha(color, 0.12)} 0 6px, transparent 6px 12px)` : withAlpha(color, status === 'none' ? 0.08 : 0.28),
          cursor: isEditable(c, edit) ? 'grab' : 'default',
        }}
        title={`${seg.speaker || ''} · ${seg.translation || seg.text || ''}`}>
        {audio.ready ? <ClipWave peaks={linePeaks[c.line]} clip={c} len={len} pps={pps} height={h - 22} color={withAlpha(color, 0.9)} /> : null}
        <div className="relative flex items-center gap-1 px-1.5 h-[16px] text-[10px] leading-[16px] text-[var(--kt-text)] whitespace-nowrap">
          {status === 'stale' ? <span className="h-1.5 w-1.5 rounded-full shrink-0 bg-[var(--kt-warn)]" title="Changed since generated" /> : null}
          {status === 'over' ? <span className="h-1.5 w-1.5 rounded-full shrink-0 bg-[var(--kt-danger)]" title="Longer than its slot" /> : null}
          <span className="truncate" style={{ fontFamily: 'var(--kt-font-script)' }}>{status === 'none' ? 'No speech yet · ' : ''}{seg.translation || seg.text}</span>
        </div>
        {isEditable(c, edit) ? <>
          <div className="absolute left-0 top-0 bottom-0 w-[6px] cursor-ew-resize hover:bg-[var(--kt-text)]/30" onPointerDown={(e) => onClipDown(e, c, 'left')} />
          <div className="absolute right-0 top-0 bottom-0 w-[6px] cursor-ew-resize hover:bg-[var(--kt-text)]/30" onPointerDown={(e) => onClipDown(e, c, 'right')} />
        </> : null}
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
      onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
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
              {t.kind === 'audio' ? (
                <div className="flex items-center gap-1">
                  <HeadBtn on={t.mute} title={t.role === 'original' ? 'Mute the original (it is a reference and not part of the dub mix)' : 'Mute this track'} onClick={() => toggleTrack(t, 'mute')} tone="bg-[var(--kt-warn)] text-[var(--kt-s0)] border-transparent">M</HeadBtn>
                  <HeadBtn on={t.solo} title="Solo: hear only soloed tracks" onClick={() => toggleTrack(t, 'solo')} tone="bg-[var(--kt-success)] text-[var(--kt-s0)] border-transparent">S</HeadBtn>
                  {t.role === 'speaker' ? <HeadBtn on={t.locked} title={t.locked ? 'Unlock this track' : 'Lock this track so its clips cannot move'} onClick={() => toggleTrack(t, 'locked')}>{t.locked ? <Lock size={10} /> : <Unlock size={10} />}</HeadBtn> : null}
                  {t.role === 'original' ? <span className="text-[9px] text-[var(--kt-faint)] ml-1">reference</span> : null}
                </div>
              ) : null}
            </div>
            <div className={`relative shrink-0 ${t.locked ? 'bg-[repeating-linear-gradient(135deg,transparent_0_8px,var(--kt-s1)_8px_16px)]' : ''}`} style={{ width: width + 200 }} onPointerDown={onBgDown}>
              <div className="absolute top-0 bottom-0 left-0 bg-[var(--kt-s1)]/40" style={{ width }} />
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
        {marquee ? <div className="absolute z-40 border border-[var(--kt-accent)] bg-[var(--kt-accent)]/10 pointer-events-none" style={{ left: marquee.x0, top: marquee.y0, width: marquee.x1 - marquee.x0, height: marquee.y1 - marquee.y0 }} /> : null}
      </div>
      {tip ? <div className="pointer-events-none fixed z-50 px-1.5 py-0.5 rounded bg-[var(--kt-s3)] border border-[var(--kt-s5)] text-[11px] text-[var(--kt-text)] whitespace-nowrap" style={{ left: tip.x + 12, top: tip.y - 26, fontFamily: 'var(--kt-font-mono)' }}>{tip.text}</div> : null}
    </div>
  );
}
