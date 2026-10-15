// Dubbing editor: pure functions over the edit (tracks + clips). The same edit is saved on the server and drives the mix.
// A clip plays [in, out) of its source starting at `start` on the timeline; out === null means "to the end of the source".
// ctx = { duration, lines: { [lineId]: segment with .audio } }

export const MIN_CLIP = 0.1;
const r3 = (v) => Math.round(v * 1000) / 1000;

export function sourceLength(clip, ctx) {
  if (clip.source !== 'line') return ctx.duration;
  const seg = ctx.lines[clip.line];
  if (!seg) return 0;
  return seg.audio?.ready ? seg.audio.duration : Math.max(MIN_CLIP, seg.end - seg.start);
}
export const clipOut = (clip, ctx) => Math.min(clip.out ?? Infinity, sourceLength(clip, ctx));
export const clipLength = (clip, ctx) => Math.max(0, clipOut(clip, ctx) - clip.in);
export const clipEnd = (clip, ctx) => clip.start + clipLength(clip, ctx);

export const trackOf = (edit, id) => edit.tracks.find((t) => t.id === id);
export const isEditable = (clip, edit) => clip.source === 'line' && !trackOf(edit, clip.track)?.locked;

/** Which tracks are heard: not muted, and when anything is soloed only the soloed tracks. */
export function audible(edit) {
  const solo = edit.tracks.some((t) => t.solo);
  return Object.fromEntries(edit.tracks.map((t) => [t.id, !t.mute && (t.solo || !solo)]));
}

/** Times a dragged edge can snap to: the playhead, the ends of the timeline, other clips' edges and the lines' own slots. */
export function snapTargets(edit, ctx, playhead, exclude = new Set()) {
  const out = [0, ctx.duration];
  if (playhead != null) out.push(playhead);
  for (const c of edit.clips) {
    if (exclude.has(c.id)) continue;
    out.push(c.start, clipEnd(c, ctx));
  }
  for (const seg of Object.values(ctx.lines)) out.push(seg.start, seg.end);
  return out;
}

/** Closest target to any of `times` within `threshold` seconds: { delta, at } or null. */
export function nearestSnap(times, targets, threshold) {
  let best = null;
  for (const t of times) {
    for (const g of targets) {
      const d = g - t;
      if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.delta))) best = { delta: d, at: g };
    }
  }
  return best;
}

// Room a set of moving clips has on their tracks: [minDelta, maxDelta] before touching a clip that is not moving.
function moveRoom(edit, ids, ctx) {
  let lo = -Infinity; let hi = Infinity;
  for (const c of edit.clips) {
    if (!ids.has(c.id)) continue;
    lo = Math.max(lo, -c.start);
    const end = clipEnd(c, ctx);
    for (const o of edit.clips) {
      if (o.track !== c.track || ids.has(o.id) || o.disabled) continue;
      const oEnd = clipEnd(o, ctx);
      if (oEnd <= c.start + 1e-6) lo = Math.max(lo, oEnd - c.start);
      else if (o.start >= end - 1e-6) hi = Math.min(hi, o.start - end);
    }
  }
  return [lo, hi];
}

const mapClips = (edit, fn) => ({ ...edit, clips: edit.clips.map((c) => fn(c) || c) });

/**
 * Move the clips `ids` by `dt` seconds from `base` (the edit when the drag began). Clips stop at their neighbours and at 0.
 * With `snap` = { targets, threshold } the moved clips' edges snap to the nearest target. Returns { edit, snapAt }.
 */
export function moveClips(base, idList, dt, ctx, snap) {
  const ids = new Set(idList.filter((id) => { const c = base.clips.find((x) => x.id === id); return c && isEditable(c, base); }));
  if (!ids.size) return { edit: base, snapAt: null };
  let d = dt;
  let snapAt = null;
  if (snap) {
    const times = [];
    for (const c of base.clips) if (ids.has(c.id)) times.push(c.start + dt, clipEnd(c, ctx) + dt);
    const hit = nearestSnap(times, snap.targets, snap.threshold);
    if (hit) { d = dt + hit.delta; snapAt = hit.at; }
  }
  const [lo, hi] = moveRoom(base, ids, ctx);
  const clamped = Math.max(lo, Math.min(hi, d));
  if (clamped !== d) snapAt = null;
  return { edit: mapClips(base, (c) => (ids.has(c.id) ? { ...c, start: r3(c.start + clamped) } : null)), snapAt };
}

/** Trim one edge of a clip by `dt` from `base`. Left edge moves start and in together; right edge moves out. */
export function trimClip(base, id, edge, dt, ctx, snap) {
  const c = base.clips.find((x) => x.id === id);
  if (!c || !isEditable(c, base)) return { edit: base, snapAt: null };
  const len = sourceLength(c, ctx);
  const end = clipEnd(c, ctx);
  let prevEnd = 0; let nextStart = Infinity;
  for (const o of base.clips) {
    if (o.id === c.id || o.track !== c.track || o.disabled) continue;
    const oEnd = clipEnd(o, ctx);
    if (oEnd <= c.start + 1e-6) prevEnd = Math.max(prevEnd, oEnd);
    else if (o.start >= end - 1e-6) nextStart = Math.min(nextStart, o.start);
  }
  let d = dt;
  let snapAt = null;
  const edgeTime = edge === 'left' ? c.start : end;
  if (snap) {
    const hit = nearestSnap([edgeTime + dt], snap.targets, snap.threshold);
    if (hit) { d = dt + hit.delta; snapAt = hit.at; }
  }
  let next;
  if (edge === 'left') {
    const lo = Math.max(-c.in, prevEnd - c.start);
    const hi = clipLength(c, ctx) - MIN_CLIP;
    const k = Math.max(lo, Math.min(hi, d));
    if (k !== d) snapAt = null;
    next = { ...c, start: r3(c.start + k), in: r3(c.in + k) };
  } else {
    const out = clipOut(c, ctx);
    const lo = c.in + MIN_CLIP - out;
    const hi = Math.min(len - out, nextStart - end);
    const k = Math.max(lo, Math.min(hi, d));
    if (k !== d) snapAt = null;
    const o = r3(out + k);
    next = { ...c, out: o >= len - 1e-3 ? null : o };
  }
  return { edit: mapClips(base, (x) => (x.id === id ? next : null)), snapAt };
}

export const setTrack = (edit, id, patch) => ({ ...edit, tracks: edit.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)) });

/** Turn clips on or off (Shift+E): all on when any of them is off, otherwise all off. */
export function toggleDisabled(edit, ids) {
  const set = new Set(ids);
  const targets = edit.clips.filter((c) => set.has(c.id) && isEditable(c, edit));
  if (!targets.length) return edit;
  const turnOn = targets.some((c) => c.disabled);
  return mapClips(edit, (c) => (set.has(c.id) && isEditable(c, edit) ? { ...c, disabled: !turnOn } : null));
}

/** Set a clip's start / in / out from typed values (seconds), within the same limits as dragging. */
export function setClipTimes(edit, id, patch, ctx) {
  const c = edit.clips.find((x) => x.id === id);
  if (!c || !isEditable(c, edit)) return edit;
  let e = edit;
  if (patch.start != null) e = moveClips(e, [id], patch.start - c.start, ctx).edit;
  const cur = () => e.clips.find((x) => x.id === id);
  if (patch.in != null) e = trimClip(e, id, 'left', patch.in - cur().in, ctx).edit;
  if (patch.out != null) e = trimClip(e, id, 'right', patch.out - clipOut(cur(), ctx), ctx).edit;
  return e;
}

/** Every clip edge on the timeline, sorted (Up / Down jump between them). */
export function editPoints(edit, ctx) {
  const pts = new Set([0, r3(ctx.duration)]);
  for (const c of edit.clips) { if (c.source === 'line') { pts.add(r3(c.start)); pts.add(r3(clipEnd(c, ctx))); } }
  return [...pts].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------------------------- undo / redo
// history = { past: [edit], present: edit, future: [edit], base: edit | null }. A drag calls begin(), then preview() on
// every move (no history entries), then end() which records one step if anything changed.
export const historyInit = (present) => ({ past: [], present, future: [], base: null });
const LIMIT = 200;
export function historyReducer(h, action) {
  switch (action.type) {
    case 'reset': return historyInit(action.edit);
    case 'commit':
      if (action.edit === h.present) return h;
      return { past: [...h.past, h.present].slice(-LIMIT), present: action.edit, future: [], base: null };
    case 'begin': return { ...h, base: h.present };
    case 'preview': return { ...h, present: action.edit };
    case 'end':
      if (!h.base || h.base === h.present) return { ...h, base: null };
      return { past: [...h.past, h.base].slice(-LIMIT), present: h.present, future: [], base: null };
    case 'undo':
      if (!h.past.length) return h;
      return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future], base: null };
    case 'redo':
      if (!h.future.length) return h;
      return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1), base: null };
    default: return h;
  }
}

// ---------------------------------------------------------------------------------------------- time display
export function timecode(t, fps) {
  const f = Math.max(1, Math.round(fps || 25));
  const total = Math.max(0, Math.round((Number(t) || 0) * f));
  const fr = total % f; const s = Math.floor(total / f);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}:${p(fr)}`;
}
