import { useCallback, useEffect, useRef } from 'react';
import { api } from '../dubApi';
import { audible, clipEnd } from './editModel';

/**
 * Plays the edit in the browser: the player (video or audio element) is the clock and carries the original sound (track A1);
 * dub lines are scheduled with Web Audio from their clips (trim, mute, solo, disabled all apply); the background stem plays
 * on its own element. Only at normal speed; while shuttling faster the dub is silent.
 */
export default function usePreviewAudio({ projectId, edit, ctx, player, ready, hasStems }) {
  const ac = useRef(null);
  const buffers = useRef({});
  const loading = useRef({});
  const sources = useRef([]);
  const gen = useRef(0);
  const bg = useRef(null);
  const live = useRef({ edit, ctx });
  useEffect(() => { live.current = { edit, ctx }; });

  const audioCtx = () => {
    ac.current = ac.current || new (window.AudioContext || window.webkitAudioContext)();
    return ac.current;
  };
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

  // decode generated lines in the background so pressing play is instant
  useEffect(() => {
    const segs = Object.values(ctx.lines).filter((s) => s.audio?.ready);
    let cancelled = false;
    (async () => {
      for (let i = 0; i < segs.length && !cancelled; i += 4) await Promise.all(segs.slice(i, i + 4).map(load));
    })();
    return () => { cancelled = true; };
  }, [ctx.lines, load]);

  useEffect(() => {
    if (!hasStems) { bg.current = null; return undefined; }
    let url = ''; let cancelled = false;
    fetch(api(`/projects/${projectId}/download/background`)).then((r) => (r.ok ? r.blob() : null)).then((b) => {
      if (!b || cancelled) return;
      url = URL.createObjectURL(b); bg.current = new Audio(url); bg.current.preload = 'auto';
    }).catch(() => {});
    return () => { cancelled = true; if (bg.current) bg.current.pause(); bg.current = null; if (url) URL.revokeObjectURL(url); };
  }, [projectId, hasStems]);

  const stop = useCallback(() => {
    gen.current += 1;
    sources.current.forEach((s) => { try { s.stop(); } catch { /* already stopped */ } });
    sources.current = [];
    if (bg.current) bg.current.pause();
  }, []);

  // levels that apply without rescheduling: the original on the player, the background element
  const applyLevels = useCallback(() => {
    const el = player.current;
    const { edit: e } = live.current;
    const on = audible(e);
    const vol = Object.fromEntries(e.tracks.map((t) => [t.id, t.volume ?? 1]));
    if (el) { el.muted = !on.A1; el.volume = Math.min(1, vol.A1 ?? 1); }
    if (bg.current) bg.current.volume = Math.min(1, vol.A2 ?? 1);
    return on;
  }, [player]);

  const start = useCallback(async () => {
    const el = player.current;
    if (!el || el.paused) return;
    stop();
    const my = gen.current;
    const on = applyLevels();
    if (Math.abs(el.playbackRate - 1) > 0.01) return;
    const a = audioCtx();
    await a.resume();
    const { edit: e, ctx: c } = live.current;
    const vol = Object.fromEntries(e.tracks.map((t) => [t.id, t.volume ?? 1]));
    if (bg.current && on.A2) { bg.current.currentTime = el.currentTime; bg.current.play().catch(() => {}); }
    const from = el.currentTime;
    const clips = e.clips.filter((cl) => cl.source === 'line' && !cl.disabled && on[cl.track] && clipEnd(cl, c) > from && cl.start < from + 900);
    clips.sort((x, y) => x.start - y.start);
    for (const cl of clips) {
      const seg = c.lines[cl.line];
      if (!seg?.audio?.ready || seg.mute) continue;
      const buf = await load(seg);
      if (my !== gen.current) return;
      if (!buf || el.paused) continue;
      const now = el.currentTime;           // the player keeps running while lines decode, so place each clip against it
      const end = clipEnd(cl, c);
      if (end <= now) continue;
      const skip = Math.max(0, now - cl.start);
      const src = a.createBufferSource(); src.buffer = buf;
      const g = a.createGain(); g.gain.value = (seg.gain ?? 1) * (vol[cl.track] ?? 1);
      src.connect(g).connect(a.destination);
      src.start(a.currentTime + Math.max(0, cl.start - now), cl.in + skip, end - cl.start - skip);
      sources.current.push(src);
    }
  }, [player, stop, applyLevels, load]);

  useEffect(() => {
    const el = player.current;
    if (!el) return undefined;
    const onPlay = () => start();
    const onSeeked = () => { if (!el.paused) start(); };
    el.addEventListener('play', onPlay); el.addEventListener('pause', stop); el.addEventListener('seeking', stop);
    el.addEventListener('seeked', onSeeked); el.addEventListener('ratechange', onSeeked);
    return () => {
      el.removeEventListener('play', onPlay); el.removeEventListener('pause', stop); el.removeEventListener('seeking', stop);
      el.removeEventListener('seeked', onSeeked); el.removeEventListener('ratechange', onSeeked);
      stop(); el.muted = false;
    };
  }, [player, ready, start, stop]);

  // an edit made while playing is heard straight away
  useEffect(() => {
    applyLevels();
    const el = player.current;
    if (!el || el.paused) return undefined;
    const t = setTimeout(start, 120);
    return () => clearTimeout(t);
  }, [edit, player, start, applyLevels]);

  useEffect(() => () => { stop(); if (ac.current) ac.current.close().catch(() => {}); }, [stop]);
}
