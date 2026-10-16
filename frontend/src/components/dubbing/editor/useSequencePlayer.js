import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../dubApi';
import { audible, clipEnd, clipOnTrackAt, sequenceEnd } from './editModel';

/**
 * Plays the edit in the browser. The timeline has its own clock; media elements follow it:
 *   - the video element (always muted) shows the V1 clip under the playhead, or black between clips,
 *   - a hidden audio element plays the original (A1) the same way, a second one the background (A2),
 *   - dub lines are scheduled with Web Audio from their clips (trim, mute, solo, disabled all apply).
 * Cuts, moves, slips and gaps are therefore heard and seen as edited. Faster shuttle shows picture only;
 * reverse shuttle steps the picture backwards.
 */
export default function useSequencePlayer({ projectId, edit, ctx, video, mediaUrl, hasStems, onBlack }) {
  const [playing, setPlaying] = useState(false);
  const [rate, setRateState] = useState(1);
  const clock = useRef({ playing: false, rate: 1, t0: 0, a0: 0 });
  const live = useRef({ edit, ctx });
  useEffect(() => { live.current = { edit, ctx }; });
  const ac = useRef(null);
  const buffers = useRef({});
  const loading = useRef({});
  const sources = useRef([]);
  const gen = useRef(0);
  const a1 = useRef(null);
  const bg = useRef(null);
  const raf = useRef(0);
  const blackRef = useRef(onBlack);
  useEffect(() => { blackRef.current = onBlack; });

  const now = () => performance.now() / 1000;
  const getTime = useCallback(() => {
    const c = clock.current;
    return c.playing ? c.t0 + (now() - c.a0) * c.rate : c.t0;
  }, []);
  const audioCtx = () => { ac.current = ac.current || new (window.AudioContext || window.webkitAudioContext)(); return ac.current; };

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

  // Make one element show/play what its track has at time T.
  const follow = useCallback((el, track, isPicture, T, on, vol) => {
    if (!el) return;
    const { edit: e, ctx: c } = live.current;
    const clip = clipOnTrackAt(e, track, T, c);
    const usable = clip && !clip.disabled && (isPicture || on[track]);
    if (isPicture) blackRef.current?.(!usable);
    if (!usable) { if (!el.paused) el.pause(); el.dataset.clip = ''; return; }
    if (!isPicture) el.volume = Math.min(1, vol[track] ?? 1);
    const src = clip.in + (T - clip.start);
    const k = clock.current;
    const run = k.playing && k.rate > 0 && (isPicture || Math.abs(k.rate - 1) < 0.01);
    if (run) {
      if (el.playbackRate !== k.rate) el.playbackRate = k.rate;
      if (el.dataset.clip !== clip.id || Math.abs(el.currentTime - src) > 0.3) { el.currentTime = src; el.dataset.clip = clip.id; }
      if (el.paused) el.play().catch(() => {});
    } else {
      if (!el.paused) el.pause();
      if (isPicture && Math.abs(el.currentTime - src) > 0.02) el.currentTime = src;
      el.dataset.clip = clip.id;
    }
  }, []);
  const syncMedia = useCallback((T) => {
    const { edit: e } = live.current;
    const on = audible(e);
    const vol = Object.fromEntries(e.tracks.map((t) => [t.id, t.volume ?? 1]));
    if (video.current) { video.current.muted = true; follow(video.current, 'V1', true, T, on, vol); }
    follow(a1.current, 'A1', false, T, on, vol);
    follow(bg.current, 'A2', false, T, on, vol);
  }, [follow, video]);

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
    const vol = Object.fromEntries(e.tracks.map((t) => [t.id, t.volume ?? 1]));
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
      const end = clipEnd(cl, c);
      if (end <= t) continue;
      const skip = Math.max(0, t - cl.start);
      const src = a.createBufferSource(); src.buffer = buf;
      const g = a.createGain(); g.gain.value = (seg.gain ?? 1) * (vol[cl.track] ?? 1);
      src.connect(g).connect(a.destination);
      src.start(a.currentTime + Math.max(0, cl.start - t), cl.in + skip, end - cl.start - skip);
      sources.current.push(src);
    }
  }, [getTime, load, stopLines]);

  // ------------------------------------------------------------------ transport
  // A timer, not animation frames: frames stop when the tab is not painted, and the media would then run past cuts.
  const loop = useCallback(() => {
    clearInterval(raf.current);
    const tick = () => {
      const k = clock.current;
      if (!k.playing) { clearInterval(raf.current); return; }
      const { edit: e, ctx: c } = live.current;
      const end = sequenceEnd(e, c);
      let T = getTime();
      if (T >= end || (k.rate < 0 && T <= 0)) {
        T = Math.max(0, Math.min(end, T));
        k.playing = false; k.t0 = T; k.rate = 1;
        clearInterval(raf.current);
        stopLines(); setPlaying(false); setRateState(1);
        syncMedia(T);
        return;
      }
      syncMedia(T);
    };
    raf.current = setInterval(tick, 40);
  }, [getTime, stopLines, syncMedia]);

  const start = useCallback((r) => {
    const k = clock.current;
    const end = sequenceEnd(live.current.edit, live.current.ctx);
    let T = getTime();
    if (r > 0 && T >= end - 0.05) T = 0;
    k.t0 = T; k.a0 = now(); k.rate = r; k.playing = true;
    setPlaying(true); setRateState(r);
    syncMedia(T); scheduleLines(); loop();
  }, [getTime, syncMedia, scheduleLines, loop]);
  const pause = useCallback(() => {
    const k = clock.current;
    k.t0 = getTime(); k.playing = false; k.rate = 1;
    clearInterval(raf.current);
    stopLines(); setPlaying(false); setRateState(1);
    syncMedia(k.t0);
  }, [getTime, stopLines, syncMedia]);
  const seek = useCallback((t) => {
    const k = clock.current;
    const end = sequenceEnd(live.current.edit, live.current.ctx);
    k.t0 = Math.max(0, Math.min(end, t)); k.a0 = now();
    syncMedia(k.t0);
    if (k.playing) scheduleLines();
  }, [syncMedia, scheduleLines]);
  const toggle = useCallback(() => { if (clock.current.playing) pause(); else start(1); }, [pause, start]);
  // J / L: each press doubles the speed in that direction (up to 4x); K stops
  const shuttle = useCallback((dir) => {
    const k = clock.current;
    const cur = k.playing ? k.rate : 0;
    const next = dir > 0 ? (cur > 0 ? Math.min(4, cur * 2) : 1) : (cur < 0 ? Math.max(-4, cur * 2) : -1);
    start(next);
  }, [start]);

  // an edit made while playing is heard straight away; when paused the picture shows the new frame
  useEffect(() => {
    if (!clock.current.playing) { syncMedia(clock.current.t0); return undefined; }
    const t = setTimeout(() => scheduleLines(), 120);
    return () => clearTimeout(t);
  }, [edit, syncMedia, scheduleLines]);
  useEffect(() => () => {
    clearInterval(raf.current); stopLines();
    if (ac.current) ac.current.close().catch(() => {});
  }, [stopLines]);

  return { getTime, seek, toggle, pause, shuttle, playing, rate, syncMedia };
}
