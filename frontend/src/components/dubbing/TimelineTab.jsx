import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Mic2, VolumeX, Volume2, ZoomIn, ZoomOut, Headphones } from 'lucide-react';
import { api, call, send, GRAD, fmtTime } from './dubApi';

const LABEL_W = 132;
const WAVE_H = 52;
const ROW_H = 46;
const MAX_CANVAS = 30000;
const PALETTE = ['#5b8cff', '#a064ff', '#2fc4a4', '#f5a742', '#ff6b81', '#4fd1ff'];

function Btn({ children, onClick, disabled, primary, icon: Icon, small, title, active }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title}
      className={`${small ? 'h-7 px-2 text-xs' : 'h-9 px-3 text-[13px]'} rounded-lg font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${primary ? 'text-white' : active ? 'border border-[var(--kt-accent)] bg-[var(--kt-accent)]/15' : 'border border-[var(--kt-s5)] bg-[var(--kt-s2)] hover:bg-[var(--kt-s3)]'}`}
      style={primary ? { background: GRAD } : undefined}>
      {Icon ? <Icon size={small ? 12 : 14} /> : null}{children}
    </button>
  );
}

function Wave({ peaks, width, height, color }) {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || !peaks?.length) return;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = color;
    const mid = height / 2;
    for (let x = 0; x < width; x += 1) {
      const v = peaks[Math.min(peaks.length - 1, Math.floor((x / width) * peaks.length))] || 0;
      const h = Math.max(1, v * (height - 6));
      ctx.fillRect(x, mid - h / 2, 1, h);
    }
  }, [peaks, width, height, color]);
  return <canvas ref={ref} width={Math.max(1, Math.floor(width))} height={height} style={{ width, height }} />;
}

export default function TimelineTab({ projectId, project, segs, edit, dirty, save, wrap, refresh, running, busy, player, mediaUrl }) {
  const duration = Number(project.duration) || 1;
  const scroller = useRef(null);
  const head = useRef(null);
  const [pps, setPps] = useState(() => Math.min(40, MAX_CANVAS / duration));
  const maxPps = Math.max(2, Math.min(240, MAX_CANVAS / duration));
  const minPps = Math.max(1, Math.min(maxPps, 600 / duration));
  const width = Math.floor(duration * pps);
  const [peaks, setPeaks] = useState({});
  const [selected, setSelected] = useState(null);
  const [hear, setHear] = useState('original'); // original | dub
  const [mutedTracks, setMutedTracks] = useState({});
  const [drag, setDrag] = useState(null);
  const ctxRef = useRef(null);
  const buffers = useRef({});
  const sources = useRef([]);
  const bgEl = useRef(null);
  const live = useRef({});
  const lines = useMemo(() => segs.filter((s) => s.id != null), [segs]);
  const speakers = useMemo(() => Array.from(new Set(lines.map((s) => s.speaker))), [lines]);
  const sel = lines.find((s) => s.id === selected);
  useEffect(() => { live.current = { lines, mutedTracks, hear, project }; });

  useEffect(() => {
    call(`/projects/${projectId}/waveform/original`).then((d) => setPeaks((p) => ({ ...p, original: d.peaks }))).catch(() => {});
  }, [projectId]);
  useEffect(() => {
    if (!project.stems) return;
    call(`/projects/${projectId}/waveform/background`).then((d) => setPeaks((p) => ({ ...p, background: d.peaks }))).catch(() => {});
  }, [projectId, project.stems]);

  // playhead follows the shared video/audio player without re-rendering the blocks
  useEffect(() => {
    let raf;
    const tick = () => {
      const el = player.current;
      if (el && head.current) {
        head.current.style.transform = `translateX(${el.currentTime * pps}px)`;
        if (!el.paused && scroller.current) {
          const sc = scroller.current; const x = el.currentTime * pps;
          if (x > sc.scrollLeft + sc.clientWidth - 40 || x < sc.scrollLeft) sc.scrollLeft = Math.max(0, x - 80);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [player, pps, mediaUrl]);

  // ---- dub preview: the original voices are muted; dub lines (and the background) are played in sync with the video
  const stopPreview = useCallback(() => {
    sources.current.forEach((s) => { try { s.stop(); } catch { /* already stopped */ } });
    sources.current = [];
    if (bgEl.current) bgEl.current.pause();
  }, []);
  const loadBuffer = useCallback(async (s) => {
    const k = `${s.id}:${s.audio.rev}`;
    if (!buffers.current[k]) {
      const r = await fetch(api(`/projects/${projectId}/lines/${s.id}/audio`));
      if (!r.ok) return null;
      buffers.current[k] = await ctxRef.current.decodeAudioData(await r.arrayBuffer());
    }
    return buffers.current[k];
  }, [projectId]);
  const startPreview = useCallback(async (from) => {
    const { lines: ls, mutedTracks: mt } = live.current;
    ctxRef.current = ctxRef.current || new (window.AudioContext || window.webkitAudioContext)();
    const ctx = ctxRef.current;
    await ctx.resume();
    stopPreview();
    const t0 = ctx.currentTime;
    for (const s of ls) {
      if (!s.audio?.ready || s.mute || mt[s.speaker]) continue;
      const begin = Math.max(0, s.start + (s.shift || 0)) - from;
      if (begin > 600) continue;
      const buf = await loadBuffer(s);
      if (!buf || begin + buf.duration <= 0) continue;
      const src = ctx.createBufferSource(); src.buffer = buf;
      const g = ctx.createGain(); g.gain.value = s.gain ?? 1;
      src.connect(g).connect(ctx.destination);
      src.start(t0 + Math.max(0, begin), begin < 0 ? -begin : 0);
      sources.current.push(src);
    }
    if (bgEl.current && !mt.background) { bgEl.current.currentTime = from; bgEl.current.play().catch(() => {}); }
  }, [loadBuffer, stopPreview]);

  useEffect(() => {
    const el = player.current;
    if (!el) return undefined;
    el.muted = hear === 'dub';
    const onPlay = () => { if (live.current.hear === 'dub') startPreview(el.currentTime); };
    const onStop = () => stopPreview();
    const onSeeked = () => { if (live.current.hear === 'dub' && !el.paused) startPreview(el.currentTime); };
    el.addEventListener('play', onPlay); el.addEventListener('pause', onStop); el.addEventListener('seeking', onStop); el.addEventListener('seeked', onSeeked);
    return () => { el.removeEventListener('play', onPlay); el.removeEventListener('pause', onStop); el.removeEventListener('seeking', onStop); el.removeEventListener('seeked', onSeeked); el.muted = false; stopPreview(); };
  }, [player, mediaUrl, hear, startPreview, stopPreview]);

  useEffect(() => {
    if (!project.stems) { bgEl.current = null; return undefined; }
    let url = '';
    let cancelled = false;
    fetch(api(`/projects/${projectId}/download/background`)).then((r) => (r.ok ? r.blob() : null)).then((b) => {
      if (!b || cancelled) return;
      url = URL.createObjectURL(b); bgEl.current = new Audio(url);
    }).catch(() => {});
    return () => { cancelled = true; if (bgEl.current) bgEl.current.pause(); bgEl.current = null; if (url) URL.revokeObjectURL(url); };
  }, [projectId, project.stems]);

  const seekFromRuler = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const t = Math.max(0, Math.min(duration, (e.clientX - r.left) / pps));
    if (player.current) player.current.currentTime = t;
  };
  const toggle = () => { const el = player.current; if (!el) return; if (el.paused) el.play(); else el.pause(); };

  // ---- dragging a line (move) or its edges (trim the slot)
  const onDown = (e, s, mode) => {
    e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId);
    setSelected(s.id);
    setDrag({ id: s.id, mode, x0: e.clientX, start: s.start, end: s.end, shift: s.shift || 0 });
  };
  const onMove = (e) => {
    if (!drag) return;
    const dt = Math.round(((e.clientX - drag.x0) / pps) * 20) / 20;
    if (drag.mode === 'move') edit(drag.id, { shift: Math.max(-10, Math.min(10, Math.round((drag.shift + dt) * 100) / 100)) });
    else if (drag.mode === 'left') edit(drag.id, { start: Math.max(0, Math.min(drag.end - 0.2, Math.round((drag.start + dt) * 100) / 100)) });
    else edit(drag.id, { end: Math.min(duration, Math.max(drag.start + 0.2, Math.round((drag.end + dt) * 100) / 100)) });
  };
  const speak = (ids) => wrap(async () => {
    if (dirty) await save();
    await send('POST', `/projects/${projectId}/speak`, { ids });
    await refresh(true);
  });

  const ticks = [];
  const step = pps >= 80 ? 1 : pps >= 30 ? 5 : pps >= 12 ? 10 : pps >= 5 ? 30 : 60;
  for (let t = 0; t <= duration; t += step) ticks.push(t);

  const track = (label, children, h = ROW_H, extra) => (
    <div className="flex border-t border-[var(--kt-s4)]" style={{ height: h }}>
      <div className="sticky left-0 z-10 shrink-0 bg-[var(--kt-s1)] border-r border-[var(--kt-s4)] px-2 flex items-center justify-between gap-1 text-xs" style={{ width: LABEL_W }}>
        <span className="truncate font-medium" title={label}>{label}</span>{extra}
      </div>
      <div className="relative shrink-0" style={{ width }}>{children}</div>
    </div>
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-xl border border-[var(--kt-s4)] bg-[var(--kt-s1)] p-2 flex flex-wrap items-center gap-2">
        <Btn small icon={Play} onClick={toggle}>Play / pause</Btn>
        <Btn small icon={Headphones} active={hear === 'dub'} onClick={() => setHear(hear === 'dub' ? 'original' : 'dub')} title="Hear the dub (and background) instead of the original speech">{hear === 'dub' ? 'Hearing the dub' : 'Hearing the original'}</Btn>
        <div className="flex-1" />
        <Btn small icon={ZoomOut} onClick={() => setPps((v) => Math.max(minPps, v / 1.5))} />
        <Btn small icon={ZoomIn} onClick={() => setPps((v) => Math.min(maxPps, v * 1.5))} />
      </div>

      {sel ? (
        <div className="rounded-xl border border-[var(--kt-accent)]/50 bg-[var(--kt-s1)] p-2.5 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-xs text-[var(--kt-faint)]">{sel.speaker} · {fmtTime(sel.start)} · shift {(sel.shift || 0).toFixed(2)}s</span>
          <span className="flex-1 min-w-[160px] truncate" style={{ fontFamily: 'var(--kt-font-script)' }}>{sel.translation || sel.text}</span>
          <Btn small icon={Mic2} disabled={busy || running || !(sel.translation || '').trim()} onClick={() => speak([sel.id])}>{sel.audio?.ready ? 'Regenerate' : 'Generate'}</Btn>
          <Btn small icon={sel.mute ? VolumeX : Volume2} onClick={() => edit(sel.id, { mute: !sel.mute })}>{sel.mute ? 'Unmute' : 'Mute'}</Btn>
          <Btn small onClick={() => edit(sel.id, { shift: 0 })}>Reset shift</Btn>
          {sel.audio?.stale ? <span className="text-xs text-[var(--kt-warn)]">Changed since generated</span> : null}
        </div>
      ) : <div className="text-xs text-[var(--kt-faint)] px-1">Click the ruler to move the playhead. Drag a line to shift it, drag its edges to change its time slot, then press Save. Click a line to regenerate or mute it.</div>}

      <div ref={scroller} className="rounded-xl border border-[var(--kt-s4)] bg-[var(--kt-s0)] overflow-x-auto select-none" onPointerMove={onMove} onPointerUp={() => setDrag(null)}>
        <div className="relative" style={{ width: width + LABEL_W }}>
          <div className="flex" style={{ height: 24 }}>
            <div className="sticky left-0 z-10 shrink-0 bg-[var(--kt-s1)] border-r border-[var(--kt-s4)]" style={{ width: LABEL_W }} />
            <div className="relative shrink-0 cursor-pointer" style={{ width }} onClick={seekFromRuler}>
              {ticks.map((t) => <div key={t} className="absolute top-0 h-full border-l border-[var(--kt-s4)] pl-1 text-[10px] text-[var(--kt-faint)]" style={{ left: t * pps }}>{fmtTime(t)}</div>)}
            </div>
          </div>
          {track('Original', peaks.original ? <Wave peaks={peaks.original} width={width} height={WAVE_H} color="#7a84a6" /> : <span className="text-[10px] text-[var(--kt-faint)] p-2">loading waveform…</span>, WAVE_H)}
          {track('Background', project.stems
            ? (peaks.background ? <Wave peaks={peaks.background} width={width} height={WAVE_H} color="#2fc4a4" /> : null)
            : <span className="text-[10px] text-[var(--kt-warn)] p-2">Not separated yet (Voice-over tab)</span>, WAVE_H,
          project.stems ? <button type="button" className="cursor-pointer" title="Mute the background in the preview" onClick={() => setMutedTracks((m) => ({ ...m, background: !m.background }))}>{mutedTracks.background ? <VolumeX size={13} /> : <Volume2 size={13} />}</button> : null)}
          {speakers.map((name, i) => track(name, (
            lines.filter((s) => s.speaker === name).map((s) => {
              const left = Math.max(0, s.start + (s.shift || 0)) * pps;
              const slotW = Math.max(6, (s.end - s.start) * pps);
              const audioW = s.audio?.ready ? Math.max(4, s.audio.duration * pps) : 0;
              const color = PALETTE[i % PALETTE.length];
              return (
                <div key={s.id} className={`absolute top-1 bottom-1 rounded-md overflow-hidden ${selected === s.id ? 'ring-2 ring-white' : ''} ${s.mute || mutedTracks[name] ? 'opacity-40' : ''}`}
                  style={{ left, width: Math.max(slotW, audioW), background: `${color}33`, border: `1px solid ${color}`, cursor: 'grab' }}
                  title={s.translation || s.text} onPointerDown={(e) => onDown(e, s, 'move')} onClick={(e) => e.stopPropagation()}>
                  {audioW ? <div className="absolute left-0 top-0 bottom-0" style={{ width: audioW, background: s.audio.overrun ? '#ff6b8155' : s.audio.stale ? '#f5b84a55' : `${color}88` }} /> : null}
                  <div className="relative px-1 text-[10px] leading-[16px] truncate text-white">{s.translation || s.text}</div>
                  <div className="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize" onPointerDown={(e) => onDown(e, s, 'left')} />
                  <div className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize" onPointerDown={(e) => onDown(e, s, 'right')} />
                </div>
              );
            })
          ), ROW_H, (
            <button type="button" className="cursor-pointer" title="Mute this speaker in the preview" onClick={() => setMutedTracks((m) => ({ ...m, [name]: !m[name] }))}>{mutedTracks[name] ? <VolumeX size={13} /> : <Volume2 size={13} />}</button>
          )))}
          <div ref={head} className="absolute top-0 bottom-0 w-px bg-[var(--kt-danger)] pointer-events-none z-20" style={{ left: LABEL_W }} />
        </div>
      </div>
      <div className="text-[11px] text-[var(--kt-faint)]">Block colours: solid = generated speech, amber = changed since generated, red = longer than its slot. Preview mutes only affect this preview, not the final mix (use Mute on a line for that).</div>
    </div>
  );
}
