// Dubbing editor: audio levels. These formulas mirror backend/app/dubbing_edit.py (clip_gain, duck_points,
// track_gain_fn) so the browser preview and the render sound the same; both test suites check the same numbers.
//   clip:  gain (dB), fade_in / fade_out (seconds, equal-power), keyframes [{t (source seconds), db}] interpolated in dB
//   track: volume (linear fader 0..2), duck {on, amount dB, attack, release} for the original and background
//   edit.master: {volume}
import { audible, clipEnd, clipLength } from './editModel.js';

export const MIN_DB = -60;
export const MAX_GAIN_DB = 20;
export const DUCK_DEFAULT = { on: true, amount: -12, attack: 0.25, release: 0.5 };
export const dbToGain = (db) => 10 ** (db / 20);
export const gainToDb = (g) => (g <= 0 ? -Infinity : 20 * Math.log10(g));
const r3 = (v) => Math.round(v * 1000) / 1000;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export const hasLevels = (c) => Boolean(c.gain || c.fade_in || c.fade_out || c.keyframes?.length);
const fade = (u) => Math.sin((Math.PI / 2) * clamp(u, 0, 1));

/** Keyframe level (dB) at source time s: held before the first and after the last keyframe (like numpy.interp). */
export function keyframeDb(kfs, s) {
  if (!kfs?.length) return 0;
  if (s <= kfs[0].t) return kfs[0].db;
  const last = kfs[kfs.length - 1];
  if (s >= last.t) return last.db;
  for (let i = 1; i < kfs.length; i += 1) {
    const a = kfs[i - 1]; const b = kfs[i];
    if (s <= b.t) return b.t - a.t < 1e-9 ? b.db : a.db + ((s - a.t) / (b.t - a.t)) * (b.db - a.db);
  }
  return last.db;
}

/** Level of a clip in dB before fades: its gain plus its keyframes at clip-local time x. */
export const clipDb = (c, x) => (c.gain || 0) + keyframeDb(c.keyframes, (c.in || 0) + x);

/** Linear gain of a clip at clip-local time x (seconds from the clip's start), with fades. */
export function clipGain(c, x, length) {
  let g = dbToGain(clipDb(c, x));
  const fi = c.fade_in || 0; const fo = c.fade_out || 0;
  if (fi > 0 && x < fi) g *= fade(x / fi);
  if (fo > 0 && length - x < fo) g *= fade((length - x) / fo);
  return g;
}

/** Where dub speech plays: [start, end] of every line clip that is heard, sorted (same rule as the server mix). */
export function speechRegions(edit, ctx) {
  const on = audible(edit);
  const out = [];
  for (const c of edit.clips) {
    if (c.source !== 'line' || c.disabled || !on[c.track]) continue;
    const seg = ctx.lines[c.line];
    if (!seg?.audio?.ready || seg.mute) continue;
    const len = clipLength(c, ctx);
    if (len > 0.01) out.push([c.start, c.start + len]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/** Breakpoints {xs, ys} of a ducking envelope (dB); speech closer than attack + release counts as one stretch. */
export function duckPoints(regions, duck) {
  const att = duck.attack ?? 0.25; const rel = duck.release ?? 0.5; const amt = duck.amount ?? -12;
  const merged = [];
  for (const [a, b] of regions) {
    const last = merged[merged.length - 1];
    if (last && a - last[1] < att + rel) last[1] = Math.max(last[1], b); else merged.push([a, b]);
  }
  const xs = []; const ys = [];
  for (const [a, b] of merged) { xs.push(a - att, a, b, b + rel); ys.push(0, amt, amt, 0); }
  return { xs, ys };
}

/** Value of breakpoints at t, 0 outside them (numpy.interp with left = right = 0). */
export function interpPoints({ xs, ys }, t) {
  if (!xs.length || t < xs[0] || t > xs[xs.length - 1]) return 0;
  for (let i = 1; i < xs.length; i += 1) {
    if (t <= xs[i]) return xs[i] - xs[i - 1] < 1e-9 ? ys[i] : ys[i - 1] + ((t - xs[i - 1]) / (xs[i] - xs[i - 1])) * (ys[i] - ys[i - 1]);
  }
  return 0;
}

/**
 * Gain of a media track (original or background) over timeline time from its clips' levels and its ducking; the fader
 * and master are applied separately on the track's bus. Returns a function of t.
 */
export function mediaEnvelope(edit, ctx, trackId) {
  const track = edit.tracks.find((t) => t.id === trackId) || {};
  const clips = edit.clips.filter((c) => c.track === trackId && !c.disabled).sort((a, b) => a.start - b.start);
  const duck = track.duck?.on ? duckPoints(speechRegions(edit, ctx), track.duck) : null;
  return (t) => {
    const c = clips.find((x) => t >= x.start && t < clipEnd(x, ctx));
    if (!c) return 0;
    let g = hasLevels(c) ? clipGain(c, t - c.start, clipLength(c, ctx)) : 1;
    if (duck) g *= dbToGain(interpPoints(duck, t));
    return g;
  };
}

/** Samples f over [t0, t0 + dur) at `rate` per second into a Float32Array (for AudioParam.setValueCurveAtTime). */
export function sampleCurve(f, t0, dur, rate, maxPoints = 72000) {
  const n = clamp(Math.ceil(dur * rate) + 1, 2, maxPoints);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) out[i] = f(t0 + (i / (n - 1)) * dur);
  return out;
}

// ---------------------------------------------------------------------------------------------- edit helpers
const mapClips = (edit, ids, fn) => {
  const set = new Set(ids);
  return { ...edit, clips: edit.clips.map((c) => (set.has(c.id) ? fn(c) : c)) };
};
/** Set clip gain (dB) and fades (seconds) on clips; fades are kept within the clip. */
export function setClipLevels(edit, ids, patch, ctx) {
  return mapClips(edit, ids, (c) => {
    const len = clipLength(c, ctx);
    const next = { ...c };
    if (patch.gain != null) next.gain = r3(clamp(patch.gain, MIN_DB, MAX_GAIN_DB));
    if (patch.fade_in != null) next.fade_in = r3(clamp(patch.fade_in, 0, len));
    if (patch.fade_out != null) next.fade_out = r3(clamp(patch.fade_out, 0, len));
    return next;
  });
}
/** Add a keyframe at clip-local time x, at the level the clip already has there (so the sound does not change). */
export function addKeyframe(edit, id, x) {
  return mapClips(edit, [id], (c) => {
    const t = r3((c.in || 0) + x);
    const kfs = (c.keyframes || []).filter((k) => Math.abs(k.t - t) > 1e-3);
    return { ...c, keyframes: [...kfs, { t, db: r3(keyframeDb(c.keyframes, t)) }].sort((a, b) => a.t - b.t) };
  });
}
/** Move keyframe `index` to source time t and level db, staying between its neighbours. */
export function moveKeyframe(edit, id, index, t, db) {
  return mapClips(edit, [id], (c) => {
    const kfs = [...(c.keyframes || [])];
    if (!kfs[index]) return c;
    const lo = index > 0 ? kfs[index - 1].t + 1e-3 : 0;
    const hi = index < kfs.length - 1 ? kfs[index + 1].t - 1e-3 : Infinity;
    kfs[index] = { t: r3(clamp(t, lo, hi)), db: r3(clamp(db, MIN_DB, MAX_GAIN_DB)) };
    return { ...c, keyframes: kfs };
  });
}
export const removeKeyframe = (edit, id, index) => mapClips(edit, [id], (c) => ({ ...c, keyframes: (c.keyframes || []).filter((_, i) => i !== index) }));
export const clearKeyframes = (edit, id) => mapClips(edit, [id], (c) => ({ ...c, keyframes: [] }));
export const setTrackVolume = (edit, id, volume) => ({ ...edit, tracks: edit.tracks.map((t) => (t.id === id ? { ...t, volume: r3(clamp(volume, 0, 2)) } : t)) });
export const setTrackDuck = (edit, id, patch) => ({
  ...edit, tracks: edit.tracks.map((t) => (t.id === id ? { ...t, duck: { ...DUCK_DEFAULT, ...(t.duck || { on: false }), ...patch } } : t)),
});
export const setMaster = (edit, volume) => ({ ...edit, master: { ...(edit.master || {}), volume: r3(clamp(volume, 0, 2)) } });

// Fader positions: -60 dB at the bottom (silence), +6 dB at the top.
export const faderToGain = (pos) => (pos <= MIN_DB ? 0 : dbToGain(pos));
export const gainToFader = (g) => clamp(gainToDb(g), MIN_DB, 6);
export const fmtDb = (db) => (!Number.isFinite(db) || db <= MIN_DB ? '-∞' : `${db > 0 ? '+' : ''}${db.toFixed(1)}`);
