// Dubbing editor: pictures. Video layers with transitions and effects, and text overlays. The transition rules mirror
// backend/app/dubbing_edit.py (transition_at, video_plan) so the preview shows what the render makes; both test suites
// check the same case. Text clips are drawn by the browser (overlayDraw.js) and sent to the server as PNG pictures.
import { clipEnd, clipLength, clipOut, newId, audible } from './editModel.js';

export const TEXT_TRACK = 'T1';
export const SUB_TRACK = 'T2';
const r3 = (v) => Math.round(v * 1000) / 1000;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export const DEFAULT_TITLE = {
  font: 'sans', size: 0.08, color: '#ffffff', bold: true, italic: false, align: 'center', x: 0.5, y: 0.5, width: 0.8,
  box: false, box_color: '#000000', box_opacity: 0.6, outline: 0.004, outline_color: '#000000', shadow: true,
};
export const DEFAULT_SUBTITLE = {
  ...DEFAULT_TITLE, size: 0.055, bold: false, y: 0.88, width: 0.86, box: true, box_opacity: 0.55, outline: 0, shadow: false,
};
export const EFFECTS_DEFAULT = { brightness: 1, contrast: 1, saturation: 1, blur: 0 };

/** Picture tracks that show: not muted (hidden). */
export const visible = (edit) => Object.fromEntries(edit.tracks.filter((t) => t.kind === 'video' || t.kind === 'overlay').map((t) => [t.id, !t.mute]));

// ---------------------------------------------------------------------------------------------- text pictures
// A stable name for the picture of a text clip: the same text, style and size always give the same name, so a picture
// is drawn and sent once and the edit can name it straight away.
function fnv(str, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i += 1) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
export function overlayName(text, style, dims) {
  const key = JSON.stringify(['v1', text, style, dims?.width, dims?.height]);
  return fnv(key, 2166136261) + fnv(key, 0x9747b28c);
}
const withImage = (c, dims) => ({ ...c, image: overlayName(c.text || '', c.style, dims) });

/** Add a text clip at time t on the Text track (3 s), unless another text clip is there. Returns { edit, id, error }. */
export function addText(edit, t, dims, { text = 'Title', style = DEFAULT_TITLE, length = 3 } = {}) {
  const start = r3(Math.max(0, t));
  const end = start + length;
  const busy = edit.clips.find((c) => c.track === TEXT_TRACK && c.start < end - 1e-3 && clipEnd(c, { duration: 0, lines: {} }) > start + 1e-3);
  if (busy) return { edit, id: null, error: 'There is already text on the Text track at the playhead. Move the playhead or the other text first.' };
  const clip = withImage({ id: newId('t'), track: TEXT_TRACK, source: 'text', start, in: 0, out: length, disabled: false, text, style: { ...style } }, dims);
  return { edit: { ...edit, clips: [...edit.clips, clip] }, id: clip.id, error: null };
}

/** Change a text clip's words or style (the picture name follows). */
export function setText(edit, ids, patch, dims) {
  const set = new Set(ids);
  return {
    ...edit,
    clips: edit.clips.map((c) => (set.has(c.id) && c.source === 'text'
      ? withImage({ ...c, ...(patch.text != null ? { text: patch.text } : {}), style: { ...c.style, ...(patch.style || {}) } }, dims)
      : c)),
  };
}

/** Subtitles from the dub: one text clip per heard line clip, on the Subtitles track (replacing what was there). */
export function subtitlesFromLines(edit, ctx, dims, { from = 'translation', style = DEFAULT_SUBTITLE } = {}) {
  const on = audible(edit);
  const lines = edit.clips.filter((c) => c.source === 'line' && !c.disabled && on[c.track]).sort((a, b) => a.start - b.start);
  const subs = [];
  let lastEnd = 0;
  for (const c of lines) {
    const seg = ctx.lines[c.line];
    const text = ((from === 'original' ? seg?.text : seg?.translation) || '').trim();
    if (!text) continue;
    const start = Math.max(c.start, lastEnd);
    const end = clipEnd(c, ctx);
    if (end - start < 0.2) continue;
    subs.push(withImage({ id: newId('s'), track: SUB_TRACK, source: 'text', start: r3(start), in: 0, out: r3(end - start), disabled: false, text, style: { ...style } }, dims));
    lastEnd = end;
  }
  return { ...edit, clips: [...edit.clips.filter((c) => c.track !== SUB_TRACK), ...subs] };
}

// ---------------------------------------------------------------------------------------------- transitions and effects
const vctx = (ctx) => ctx;
/** Enabled clips of the video track, in time order. */
export const videoClips = (edit) => edit.clips.filter((c) => c.track === 'V1' && !c.disabled).sort((a, b) => a.start - b.start);

/**
 * The transition into clips[i] from the clip just before it, with its length limited the way the server limits it:
 * the clips must touch, neither may be shorter than it, and a dissolve needs half its length of spare source on each
 * side of the cut. { type, duration, cut, requested } or null.
 */
export function transitionAt(clips, i, ctx) {
  const c = clips[i]; const t = c?.transition;
  if (!t || i === 0) return null;
  const left = clips[i - 1];
  const lLen = clipLength(left, ctx); const rLen = clipLength(c, ctx);
  if (Math.abs(left.start + lLen - c.start) > 1e-3) return null;
  let d = Math.min(t.duration ?? 1, lLen, rLen);
  if (t.type === 'dissolve') d = Math.min(d, 2 * (ctx.duration - clipOut(left, ctx)), 2 * (c.in || 0));
  if (d < 0.04) return null;
  return { type: t.type, duration: r3(d), cut: c.start, requested: t.duration ?? 1 };
}

const fadeFactor = (c, T, ctx) => {
  let a = 1;
  const x = T - c.start; const end = clipEnd(c, ctx);
  if (c.fade_in > 0) a *= clamp(x / c.fade_in, 0, 1);
  if (c.fade_out > 0) a *= clamp((end - T) / c.fade_out, 0, 1);
  return a;
};

/**
 * What the picture shows at time T: [{ clip, src, opacity }] from bottom to top (empty = black). Within a dissolve both
 * clips show, the second one fading in over the first (handles play past the first clip's out and before the second
 * clip's in); a dip fades the first to black and the second up from black. Clip fades fade from / to black.
 */
export function videoLayers(edit, ctx, T) {
  if (visible(edit).V1 === false) return [];
  const clips = videoClips(edit);
  const c0 = vctx(ctx);
  for (let i = 1; i < clips.length; i += 1) {
    const tr = transitionAt(clips, i, c0);
    if (!tr) continue;
    const h = tr.duration / 2;
    if (T < tr.cut - h || T >= tr.cut + h) continue;
    const L = clips[i - 1]; const R = clips[i];
    if (tr.type === 'dissolve') {
      const p = (T - (tr.cut - h)) / tr.duration;
      return [
        { clip: L, src: L.in + (T - L.start), opacity: fadeFactor(L, Math.min(T, clipEnd(L, c0) - 1e-3), c0) },
        { clip: R, src: R.in + (T - R.start), opacity: p * fadeFactor(R, Math.max(T, R.start), c0) },
      ];
    }
    if (T < tr.cut) return [{ clip: L, src: L.in + (T - L.start), opacity: ((tr.cut - T) / h) * fadeFactor(L, T, c0) }];
    return [{ clip: R, src: R.in + (T - R.start), opacity: ((T - tr.cut) / h) * fadeFactor(R, T, c0) }];
  }
  const c = clips.find((x) => T >= x.start && T < clipEnd(x, c0));
  return c ? [{ clip: c, src: c.in + (T - c.start), opacity: fadeFactor(c, T, c0) }] : [];
}

/** Text clips showing at time T, bottom track first, with their opacity (fades). */
export function overlaysAt(edit, T) {
  const shown = visible(edit);
  const out = [];
  for (const track of [TEXT_TRACK, SUB_TRACK]) {
    if (shown[track] === false) continue;
    for (const c of edit.clips) {
      if (c.track !== track || c.source !== 'text' || c.disabled) continue;
      const len = (c.out ?? 0) - (c.in || 0);
      if (T < c.start || T >= c.start + len) continue;
      let a = 1;
      if (c.fade_in > 0) a *= clamp((T - c.start) / c.fade_in, 0, 1);
      if (c.fade_out > 0) a *= clamp((c.start + len - T) / c.fade_out, 0, 1);
      out.push({ clip: c, alpha: a });
    }
  }
  return out;
}

/** CSS filter for a clip's effects; blur is a fraction of the picture height, so it needs the shown height in px. */
export function cssFilter(fx, shownHeight) {
  if (!fx) return 'none';
  const parts = [];
  if (fx.brightness != null && Math.abs(fx.brightness - 1) > 1e-3) parts.push(`brightness(${fx.brightness})`);
  if (fx.contrast != null && Math.abs(fx.contrast - 1) > 1e-3) parts.push(`contrast(${fx.contrast})`);
  if (fx.saturation != null && Math.abs(fx.saturation - 1) > 1e-3) parts.push(`saturate(${fx.saturation})`);
  if (fx.blur > 1e-4) parts.push(`blur(${(fx.blur * shownHeight).toFixed(2)}px)`);
  return parts.length ? parts.join(' ') : 'none';
}

const mapIds = (edit, ids, fn) => { const s = new Set(ids); return { ...edit, clips: edit.clips.map((c) => (s.has(c.id) ? fn(c) : c)) }; };
export function setEffects(edit, ids, patch) {
  return mapIds(edit, ids, (c) => {
    const fx = { ...EFFECTS_DEFAULT, ...(c.effects || {}), ...patch };
    const changed = Object.keys(EFFECTS_DEFAULT).some((k) => Math.abs(fx[k] - EFFECTS_DEFAULT[k]) > 1e-6);
    const next = { ...c };
    if (changed) next.effects = fx; else delete next.effects;
    return next;
  });
}
export const setTransition = (edit, id, tr) => mapIds(edit, [id], (c) => {
  const next = { ...c };
  if (tr) next.transition = { type: tr.type, duration: r3(clamp(tr.duration ?? 1, 0.04, 10)) }; else delete next.transition;
  return next;
});

/** Ctrl+D: a 1 s cross dissolve at the video cut nearest the playhead (within 2 s). Returns { edit, error, cut }. */
export function applyDefaultTransition(edit, ctx, T, duration = 1) {
  const clips = videoClips(edit);
  let best = null;
  for (let i = 1; i < clips.length; i += 1) {
    const L = clips[i - 1]; const R = clips[i];
    if (Math.abs(clipEnd(L, ctx) - R.start) > 1e-3) continue;
    const dist = Math.abs(R.start - T);
    if (dist <= 2 && (!best || dist < best.dist)) best = { dist, id: R.id, cut: R.start };
  }
  if (!best) return { edit, error: 'No video cut near the playhead. Cut the video with the Razor (C) first, then add a transition there.', cut: null };
  return { edit: setTransition(edit, best.id, { type: 'dissolve', duration }), error: null, cut: best.cut };
}
