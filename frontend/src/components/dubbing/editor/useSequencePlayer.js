import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../dubApi';
import { audible, clipEnd, clipLength, clipOnTrackAt, sequenceEnd } from './editModel';
import { clipGain, hasLevels, mediaEnvelope, sampleCurve } from './audioModel';
import { videoLayers, overlaysAt, cssFilter } from './videoModel';
import { drawText } from './overlayDraw';

/**
 * Plays the edit in the browser. The timeline has its own clock; media elements follow it:
 *   - the video element (always muted) shows the V1 clip under the playhead, or black between clips,
 *   - a hidden audio element plays the original (A1) the same way, a second one the background (A2),
 *   - dub lines are scheduled with Web Audio from their clips (trim, mute, solo, disabled all apply).
 * Audio runs through a mixer graph: every source -> its clip level (gain, keyframes, fades, ducking, as a scheduled gain
 * curve) -> its track bus (fader, mute / solo) -> master. Each bus has a meter. The level formulas are those of the
 * server render (audioModel.js), so what plays here is what the mix will sound like.
 * Faster shuttle shows picture only; reverse shuttle steps the picture backwards.
 */
const MEDIA_RATE = 40;      // gain-curve points per second for the original and background
const LINE_RATE = 100;      // and for a dub line
const MEDIA_WINDOW = 600;   // seconds of media level curve scheduled at a time

export default function useSequencePlayer({ projectId, edit, ctx, video, video2, overlay, dims, mediaUrl, hasStems, onBlack }) {
  const [playing, setPlaying] = useState(false);
  const [rate, setRateState] = useState(1);
  const clock = useRef({ playing: false, rate: 1, t0: 0, a0: 0 });
  const live = useRef({ edit, ctx });
  useEffect(() => { live.current = { edit, ctx }; });
  const ac = useRef(null);
  const graph = useRef(null);
  const buffers = useRef({});
  const loading = useRef({});
  const sources = useRef([]);
  const gen = useRef(0);
  const a1 = useRef(null);
  const bg = useRef(null);
  const timer = useRef(0);
  const mediaUntil = useRef(0);
  const blackRef = useRef(onBlack);
  useEffect(() => { blackRef.current = onBlack; });
  const dimsRef = useRef(dims);
  useEffect(() => { dimsRef.current = dims; });
  const drawn = useRef('');

  const now = () => performance.now() / 1000;
  const getTime = useCallback(() => {
    const c = clock.current;
    return c.playing ? c.t0 + (now() - c.a0) * c.rate : c.t0;
  }, []);
  const audioCtx = () => { ac.current = ac.current || new (window.AudioContext || window.webkitAudioContext)(); return ac.current; };

  // ------------------------------------------------------------------ mixer graph
  const meterNode = (a) => { const an = a.createAnalyser(); an.fftSize = 1024; return { analyser: an, buf: new Float32Array(1024) }; };
  const ensureGraph = useCallback(() => {
    const a = audioCtx();
    if (!graph.current) {
      const master = a.createGain();
      const m = meterNode(a);
      master.connect(m.analyser); m.analyser.connect(a.destination);
      graph.current = { master, masterMeter: m, buses: {}, media: new WeakMap() };
    }
    return graph.current;
  }, []);
  const bus = useCallback((trackId) => {
    const g = ensureGraph();
    if (!g.buses[trackId]) {
      const gain = ac.current.createGain();
      const m = meterNode(ac.current);
      gain.connect(m.analyser); m.analyser.connect(g.master);
      g.buses[trackId] = { gain, ...m };
    }
    return g.buses[trackId];
  }, [ensureGraph]);
  // faders, mute / solo and the master apply at once, without rescheduling anything
  const applyLevels = useCallback(() => {
    const g = graph.current;
    if (!g) return;
    const { edit: e } = live.current;
    const on = audible(e);
    for (const t of e.tracks) if (t.kind === 'audio') bus(t.id).gain.gain.value = on[t.id] ? (t.volume ?? 1) : 0;
    g.master.gain.value = e.master?.volume ?? 1;
  }, [bus]);
  const mediaNode = useCallback((el, trackId) => {
    const g = ensureGraph();
    let n = g.media.get(el);
    if (!n) {
      const src = ac.current.createMediaElementSource(el);
      const env = ac.current.createGain();
      src.connect(env); env.connect(bus(trackId).gain);
      n = { src, env };
      g.media.set(el, n);
    }
    return n;
  }, [ensureGraph, bus]);
  /** Peak level (linear) of each track bus and the master over the last few milliseconds, for the meters. */
  const meters = useCallback(() => {
    const g = graph.current;
    if (!g || !clock.current.playing) return {};
    const peak = (m) => { m.analyser.getFloatTimeDomainData(m.buf); let p = 0; for (let i = 0; i < m.buf.length; i += 1) { const v = Math.abs(m.buf[i]); if (v > p) p = v; } return p; };
    const out = { master: peak(g.masterMeter) };
    for (const [id, b] of Object.entries(g.buses)) out[id] = peak(b);
    return out;
  }, []);

  // ------------------------------------------------------------------ media elements
  useEffect(() => {
    if (!mediaUrl) return undefined;
    const el = new Audio(mediaUrl); el.preload = 'auto';
    a1.current = el;
    return () => { el.pause(); a1.current = null; };
  }, [mediaUrl]);
  useEffect(() => {
    if (!hasStems) return undefined;
    let url = ''; let cancelled = false;
    fetch(api(`/projects/${projectId}/download/background`)).then((r) => (r.ok ? r.blob() : null)).then((b) => {
      if (!b || cancelled) return;
      url = URL.createObjectURL(b); bg.current = new Audio(url); bg.current.preload = 'auto';
    }).catch(() => {});
    return () => { cancelled = true; if (bg.current) bg.current.pause(); bg.current = null; if (url) URL.revokeObjectURL(url); };
  }, [projectId, hasStems]);

  // Play or show source time `src` of clip `clipId` on a media element, keeping it on the clock.
  const drive = useCallback((el, clipId, src, isPicture) => {
    const k = clock.current;
    const run = k.playing && k.rate > 0 && (isPicture || Math.abs(k.rate - 1) < 0.01);
    if (run) {
      if (el.playbackRate !== k.rate) el.playbackRate = k.rate;
      if (el.dataset.clip !== clipId || Math.abs(el.currentTime - src) > 0.3) { el.currentTime = Math.max(0, src); el.dataset.clip = clipId; }
      if (el.paused) el.play().catch(() => {});
    } else {
      if (!el.paused) el.pause();
      if (isPicture && Math.abs(el.currentTime - src) > 0.02) el.currentTime = Math.max(0, src);
      el.dataset.clip = clipId;
    }
  }, []);
  // The picture: up to two layers (a dissolve shows both clips), each on its own video element with its opacity and
  // effects; an element keeps the clip it already shows so a dissolve never makes it seek.
  const followPicture = useCallback((T) => {
    const els = [video.current, video2?.current];
    if (!els[0]) return;
    const { edit: e, ctx: c } = live.current;
    const layers = videoLayers(e, c, T);
    blackRef.current?.(!layers.length);
    const assign = [null, null];
    layers.forEach((l, z) => {
      const k = [0, 1].find((i) => els[i] && !assign[i] && els[i].dataset.clip === l.clip.id);
      if (k != null) assign[k] = { ...l, z };
    });
    layers.forEach((l, z) => {
      if (assign.some((a) => a && a.clip.id === l.clip.id)) return;
      const k = [0, 1].find((i) => els[i] && !assign[i]);
      if (k != null) assign[k] = { ...l, z };
    });
    els.forEach((el, i) => {
      if (!el) return;
      el.muted = true;
      const a = assign[i];
      if (!a) { el.style.opacity = '0'; if (!el.paused) el.pause(); el.dataset.clip = ''; return; }
      el.style.opacity = String(a.opacity);
      el.style.zIndex = String(a.z + 1);
      const shownH = el.videoWidth ? Math.min(el.clientHeight, (el.clientWidth * el.videoHeight) / el.videoWidth) : el.clientHeight;
      const f = cssFilter(a.clip.effects, shownH);
      if (el.style.filter !== f) el.style.filter = f;
      drive(el, a.clip.id, a.src, true);
    });
  }, [video, video2, drive]);
  // Text overlays, drawn over the picture at its shown size (redrawn only when something visible changed).
  const drawOverlays = useCallback((T) => {
    const cv = overlay?.current; const d = dimsRef.current;
    if (!cv || !d) return;
    const box = cv.parentElement.getBoundingClientRect();
    const scale = Math.min(box.width / d.width, box.height / d.height);
    const w = Math.max(1, Math.round(d.width * scale)); const h = Math.max(1, Math.round(d.height * scale));
    const dpr = window.devicePixelRatio || 1;
    const items = overlaysAt(live.current.edit, T);
    const key = `${w}x${h}:${items.map((o) => `${o.clip.image}@${o.alpha.toFixed(2)}`).join('|')}`;
    if (key === drawn.current) return;
    drawn.current = key;
    cv.style.width = `${w}px`; cv.style.height = `${h}px`;
    cv.style.left = `${(box.width - w) / 2}px`; cv.style.top = `${(box.height - h) / 2}px`;
    if (cv.width !== Math.round(w * dpr)) cv.width = Math.round(w * dpr);
    if (cv.height !== Math.round(h * dpr)) cv.height = Math.round(h * dpr);
    const g = cv.getContext('2d');
    g.clearRect(0, 0, cv.width, cv.height);
    for (const o of items) { g.globalAlpha = o.alpha; drawText(g, cv.width, cv.height, o.clip.text, o.clip.style); }
    g.globalAlpha = 1;
  }, [overlay]);

  // Make one audio element play what its track has at time T.
  const follow = useCallback((el, track, isPicture, T, on) => {
    if (!el) return;
    const { edit: e, ctx: c } = live.current;
    const clip = clipOnTrackAt(e, track, T, c);
    const usable = clip && !clip.disabled && (isPicture || on[track]);
    if (!usable) { if (!el.paused) el.pause(); el.dataset.clip = ''; return; }
    const src = clip.in + (T - clip.start);
    drive(el, clip.id, src, isPicture);
  }, [drive]);
  const syncMedia = useCallback((T) => {
    const on = audible(live.current.edit);
    followPicture(T);
    drawOverlays(T);
    follow(a1.current, 'A1', false, T, on);
    follow(bg.current, 'A2', false, T, on);
  }, [follow, followPicture, drawOverlays]);

  // the original's and background's levels (clip gain, keyframes, fades, ducking) as gain curves on the clock
  const scheduleMedia = useCallback(() => {
    const k = clock.current;
    if (!k.playing || Math.abs(k.rate - 1) > 0.01 || !ac.current) return;
    const { edit: e, ctx: c } = live.current;
    const T = getTime();
    const W = Math.min(sequenceEnd(e, c) - T, MEDIA_WINDOW);
    if (W <= 0.05) return;
    const at = ac.current.currentTime;
    for (const [el, track] of [[a1.current, 'A1'], [bg.current, 'A2']]) {
      if (!el) continue;
      const g = mediaNode(el, track).env.gain;
      g.cancelScheduledValues(0);
      g.setValueCurveAtTime(sampleCurve(mediaEnvelope(e, c, track), T, W, MEDIA_RATE), at, W);
    }
    mediaUntil.current = T + W;
  }, [getTime, mediaNode]);

  // ------------------------------------------------------------------ dub lines
  const key = (seg) => `${seg.id}:${seg.audio?.rev}`;
  const load = useCallback((seg) => {
    const k = key(seg);
    if (buffers.current[k]) return Promise.resolve(buffers.current[k]);
    if (!loading.current[k]) {
      loading.current[k] = fetch(api(`/projects/${projectId}/lines/${seg.id}/audio`))
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .then((b) => (b ? audioCtx().decodeAudioData(b) : null))
        .then((buf) => { buffers.current[k] = buf; delete loading.current[k]; return buf; })
        .catch(() => { delete loading.current[k]; return null; });
    }
    return loading.current[k];
  }, [projectId]);
  useEffect(() => {
    const segs = Object.values(ctx.lines).filter((s) => s.audio?.ready);
    let cancelled = false;
    (async () => { for (let i = 0; i < segs.length && !cancelled; i += 4) await Promise.all(segs.slice(i, i + 4).map(load)); })();
    return () => { cancelled = true; };
  }, [ctx.lines, load]);

  const stopLines = useCallback(() => {
    gen.current += 1;
    sources.current.forEach((s) => { try { s.stop(); } catch { /* already stopped */ } });
    sources.current = [];
  }, []);
  const scheduleLines = useCallback(async () => {
    stopLines();
    const k = clock.current;
    if (!k.playing || Math.abs(k.rate - 1) > 0.01) return;
    const my = gen.current;
    const a = audioCtx();
    await a.resume();
    const { edit: e, ctx: c } = live.current;
    const on = audible(e);
    const from = getTime();
    const clips = e.clips.filter((cl) => cl.source === 'line' && !cl.disabled && on[cl.track] && clipEnd(cl, c) > from && cl.start < from + 900)
      .sort((x, y) => x.start - y.start);
    for (const cl of clips) {
      const seg = c.lines[cl.line];
      if (!seg?.audio?.ready || seg.mute) continue;
      const buf = await load(seg);
      if (my !== gen.current) return;
      if (!buf) continue;
      const t = getTime(); // the clock keeps running while lines decode, so place each clip against it
      const len = clipLength(cl, c);
      const end = cl.start + len;
      if (end <= t) continue;
      const skip = Math.max(0, t - cl.start);
      const when = a.currentTime + Math.max(0, cl.start - t);
      const dur = end - cl.start - skip;
      const src = a.createBufferSource(); src.buffer = buf;
      const g = a.createGain();
      const lineLevel = seg.gain ?? 1;
      if (hasLevels(cl)) {
        const curve = sampleCurve((x) => clipGain(cl, x, len) * lineLevel, skip, dur, LINE_RATE);
        g.gain.setValueCurveAtTime(curve, when, dur);
      } else g.gain.value = lineLevel;
      src.connect(g).connect(bus(cl.track).gain);
      src.start(when, cl.in + skip, dur);
      sources.current.push(src);
    }
  }, [getTime, load, stopLines, bus]);

  // ------------------------------------------------------------------ transport
  // A timer, not animation frames: frames stop when the tab is not painted, and the media would then run past cuts.
  const loop = useCallback(() => {
    clearInterval(timer.current);
    const tick = () => {
      const k = clock.current;
      if (!k.playing) { clearInterval(timer.current); return; }
      const { edit: e, ctx: c } = live.current;
      const end = sequenceEnd(e, c);
      let T = getTime();
      if (T >= end || (k.rate < 0 && T <= 0)) {
        T = Math.max(0, Math.min(end, T));
        k.playing = false; k.t0 = T; k.rate = 1;
        clearInterval(timer.current);
        stopLines(); setPlaying(false); setRateState(1);
        syncMedia(T);
        return;
      }
      if (T > mediaUntil.current - 30) scheduleMedia();
      syncMedia(T);
    };
    timer.current = setInterval(tick, 40);
  }, [getTime, stopLines, syncMedia, scheduleMedia]);

  const start = useCallback((r) => {
    const k = clock.current;
    const end = sequenceEnd(live.current.edit, live.current.ctx);
    let T = getTime();
    if (r > 0 && T >= end - 0.05) T = 0;
    k.t0 = T; k.a0 = now(); k.rate = r; k.playing = true;
    setPlaying(true); setRateState(r);
    ensureGraph();
    if (a1.current) mediaNode(a1.current, 'A1');
    if (bg.current) mediaNode(bg.current, 'A2');
    applyLevels();
    ac.current.resume().catch(() => {});
    syncMedia(T); scheduleMedia(); scheduleLines(); loop();
  }, [getTime, ensureGraph, mediaNode, applyLevels, syncMedia, scheduleMedia, scheduleLines, loop]);
  const pause = useCallback(() => {
    const k = clock.current;
    k.t0 = getTime(); k.playing = false; k.rate = 1;
    clearInterval(timer.current);
    stopLines(); setPlaying(false); setRateState(1);
    syncMedia(k.t0);
  }, [getTime, stopLines, syncMedia]);
  const seek = useCallback((t) => {
    const k = clock.current;
    const end = sequenceEnd(live.current.edit, live.current.ctx);
    k.t0 = Math.max(0, Math.min(end, t)); k.a0 = now();
    syncMedia(k.t0);
    if (k.playing) { scheduleMedia(); scheduleLines(); }
  }, [syncMedia, scheduleMedia, scheduleLines]);
  const toggle = useCallback(() => { if (clock.current.playing) pause(); else start(1); }, [pause, start]);
  // J / L: each press doubles the speed in that direction (up to 4x); K stops
  const shuttle = useCallback((dir) => {
    const k = clock.current;
    const cur = k.playing ? k.rate : 0;
    const next = dir > 0 ? (cur > 0 ? Math.min(4, cur * 2) : 1) : (cur < 0 ? Math.max(-4, cur * 2) : -1);
    start(next);
  }, [start]);

  // An edit made while playing is heard straight away: faders at once, levels and lines after a short pause.
  // When paused the picture shows the new frame.
  // A fader move (only track volume or master changed) needs no rescheduling, so dragging one never glitches.
  const shape = useRef({});
  useEffect(() => {
    applyLevels();
    const prev = shape.current;
    const next = { clips: edit.clips, heard: JSON.stringify(audible(edit)), duck: JSON.stringify(edit.tracks.map((t) => t.duck || null)) };
    shape.current = next;
    drawn.current = '';
    if (!clock.current.playing) { syncMedia(clock.current.t0); return undefined; }
    const linesChanged = prev.clips !== next.clips || prev.heard !== next.heard;
    if (!linesChanged && prev.duck === next.duck) return undefined;
    const t = setTimeout(() => { scheduleMedia(); if (linesChanged) scheduleLines(); }, 120);
    return () => clearTimeout(t);
  }, [edit, applyLevels, syncMedia, scheduleMedia, scheduleLines]);
  useEffect(() => () => {
    clearInterval(timer.current); stopLines();
    if (ac.current) ac.current.close().catch(() => {});
  }, [stopLines]);

  return { getTime, seek, toggle, pause, shuttle, playing, rate, syncMedia, meters };
}
