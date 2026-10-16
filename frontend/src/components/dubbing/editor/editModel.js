// Dubbing editor: pure functions over the edit (tracks + clips). The same edit is saved on the server and drives the mix.
// A clip plays [in, out) of its source starting at `start` on the timeline; out === null means "to the end of the source".
// Clips that share a `link` (the video and its audio pieces) are selected, cut and trimmed together.
// ctx = { duration, lines: { [lineId]: segment with .audio } }

export const MIN_CLIP = 0.1;
const EPS = 1e-3;
const r3 = (v) => Math.round(v * 1000) / 1000;
let seq = 0;
export const newId = (prefix = 'c') => `${prefix}${Date.now().toString(36)}${(seq += 1).toString(36)}`;

export const TEXT_SOURCE = 36000; // a text clip has no source of its own; its length is out - in
export function sourceLength(clip, ctx) {
  if (clip.source === 'text') return TEXT_SOURCE;
  if (clip.source !== 'line') return ctx.duration;
  const seg = ctx.lines[clip.line];
  if (!seg) return 0;
  return seg.audio?.ready ? seg.audio.duration : Math.max(MIN_CLIP, seg.end - seg.start);
}
export const clipOut = (clip, ctx) => Math.min(clip.out ?? Infinity, sourceLength(clip, ctx));
export const clipLength = (clip, ctx) => Math.max(0, clipOut(clip, ctx) - clip.in);
export const clipEnd = (clip, ctx) => clip.start + clipLength(clip, ctx);
const setOut = (clip, out, ctx) => (out >= sourceLength(clip, ctx) - EPS ? null : r3(out));

export const trackOf = (edit, id) => edit.tracks.find((t) => t.id === id);
const unlocked = (edit, c) => !trackOf(edit, c.track)?.locked;
export const isEditable = (clip, edit) => unlocked(edit, clip);
export const sequenceEnd = (edit, ctx) => edit.clips.reduce((m, c) => Math.max(m, clipEnd(c, ctx)), 0) || ctx.duration;

/** Which tracks are heard: not muted, and when anything is soloed only the soloed tracks. */
export function audible(edit) {
  const solo = edit.tracks.some((t) => t.solo);
  return Object.fromEntries(edit.tracks.map((t) => [t.id, !t.mute && (t.solo || !solo)]));
}

/** The clip and the clips linked to it (same `link`), or just the clip. */
export function linkGroup(edit, id) {
  const c = edit.clips.find((x) => x.id === id);
  if (!c) return [];
  if (!c.link) return [c.id];
  return edit.clips.filter((x) => x.link === c.link).map((x) => x.id);
}
export const expandLinked = (edit, ids) => [...new Set(ids.flatMap((id) => linkGroup(edit, id)))];

/** Clips under time t (strictly inside, not at an edge), optionally only on unlocked tracks. */
export const clipsAt = (edit, t, ctx, onlyUnlocked = true) => edit.clips.filter((c) => (!onlyUnlocked || unlocked(edit, c)) && c.start < t - EPS && clipEnd(c, ctx) > t + EPS);

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

const mapClips = (edit, fn) => ({ ...edit, clips: edit.clips.map((c) => fn(c) || c) });
const byId = (edit, id) => edit.clips.find((x) => x.id === id);

// Lines whose last clip has gone are remembered as removed, so the server does not put them back.
function noteRemoved(before, after) {
  const had = new Set(before.clips.filter((c) => c.source === 'line').map((c) => c.line));
  const has = new Set(after.clips.filter((c) => c.source === 'line').map((c) => c.line));
  const gone = [...had].filter((l) => !has.has(l));
  if (!gone.length) return after;
  return { ...after, removed_lines: [...new Set([...(after.removed_lines || []), ...gone])] };
}

// ---------------------------------------------------------------------------------------------- move
// Room a set of moving clips has on their tracks: [minDelta, maxDelta] before touching a clip that is not moving.
function moveRoom(edit, ids, ctx) {
  let lo = -Infinity; let hi = Infinity;
  for (const c of edit.clips) {
    if (!ids.has(c.id)) continue;
    lo = Math.max(lo, -c.start);
    const end = clipEnd(c, ctx);
    for (const o of edit.clips) {
      if (o.track !== c.track || ids.has(o.id)) continue;
      const oEnd = clipEnd(o, ctx);
      if (oEnd <= c.start + 1e-6) lo = Math.max(lo, oEnd - c.start);
      else if (o.start >= end - 1e-6) hi = Math.min(hi, o.start - end);
    }
  }
  return [lo, hi];
}

/**
 * Move the clips `ids` by `dt` seconds from `base` (the edit when the drag began). Clips stop at their neighbours and at 0.
 * With `snap` = { targets, threshold } the moved clips' edges snap to the nearest target. Returns { edit, snapAt }.
 */
export function moveClips(base, idList, dt, ctx, snap) {
  const ids = new Set(idList.filter((id) => { const c = byId(base, id); return c && isEditable(c, base); }));
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

// ---------------------------------------------------------------------------------------------- ripple helpers
// How far left everything from time t onwards (on unlocked tracks, not counting `skip`) can shift before it runs into a
// clip that stays put. Returns the lowest allowed (negative) shift.
function rippleFloor(edit, t, ctx, skip) {
  let lo = -Infinity;
  const tracks = new Set(edit.clips.map((c) => c.track));
  for (const tr of tracks) {
    if (trackOf(edit, tr)?.locked) continue;
    const on = edit.clips.filter((c) => c.track === tr && !skip.has(c.id));
    const moving = on.filter((c) => c.start >= t - 1e-6);
    if (!moving.length) continue;
    const s1 = Math.min(...moving.map((c) => c.start));
    const staying = on.filter((c) => c.start < t - 1e-6);
    const p = staying.length ? Math.max(...staying.map((c) => clipEnd(c, ctx))) : 0;
    lo = Math.max(lo, p - s1);
  }
  return lo;
}
const shiftFrom = (edit, t, k, skip) => mapClips(edit, (c) => (
  !skip.has(c.id) && unlocked(edit, c) && c.start >= t - 1e-6 ? { ...c, start: r3(c.start + k) } : null));

// ---------------------------------------------------------------------------------------------- trim (normal and ripple)
/**
 * Trim one edge of the clips `idList` (normally a clip and its linked clips) by `dt` from `base`, all by the same amount.
 * Left edge moves start and in together; right edge moves out. With `ripple`, the clips keep their start and everything
 * after them on unlocked tracks moves by the change in length instead (Premiere's Ripple Edit tool).
 * `grab` is the clip whose edge is being dragged (snapping and the reported snap point follow it).
 */
export function trimClips(base, idList, edge, dt, ctx, snap, { grab, ripple = false } = {}) {
  const group = idList.map((id) => byId(base, id)).filter((c) => c && isEditable(c, base));
  if (!group.length) return { edit: base, snapAt: null };
  const ids = new Set(group.map((c) => c.id));
  const g = group.find((c) => c.id === grab) || group[0];
  let d = dt;
  let snapAt = null;
  if (snap && (!ripple || edge === 'right')) {
    const at = edge === 'left' ? g.start : clipEnd(g, ctx);
    const hit = nearestSnap([at + dt], snap.targets, snap.threshold);
    if (hit) { d = dt + hit.delta; snapAt = hit.at; }
  }
  let lo = -Infinity; let hi = Infinity;
  for (const c of group) {
    const len = clipLength(c, ctx); const out = clipOut(c, ctx);
    if (edge === 'left') {
      lo = Math.max(lo, -c.in); hi = Math.min(hi, len - MIN_CLIP);
      if (!ripple) {
        const prev = base.clips.filter((o) => o.track === c.track && !ids.has(o.id) && clipEnd(o, ctx) <= c.start + 1e-6);
        lo = Math.max(lo, (prev.length ? Math.max(...prev.map((o) => clipEnd(o, ctx))) : 0) - c.start);
      }
    } else {
      lo = Math.max(lo, c.in + MIN_CLIP - out); hi = Math.min(hi, sourceLength(c, ctx) - out);
      if (!ripple) {
        const end = clipEnd(c, ctx);
        const next = base.clips.filter((o) => o.track === c.track && !ids.has(o.id) && o.start >= end - 1e-6);
        if (next.length) hi = Math.min(hi, Math.min(...next.map((o) => o.start)) - end);
      }
    }
  }
  const pivot = clipEnd(g, ctx);
  if (ripple) {
    // later clips move by +k (right edge) or -k (left edge); they must not run into anything that stays
    const floor = rippleFloor(base, pivot, ctx, ids);
    if (edge === 'right') lo = Math.max(lo, floor);
    else hi = Math.min(hi, -floor);
  }
  const k = Math.max(lo, Math.min(hi, d));
  if (k !== d) snapAt = null;
  let next = mapClips(base, (c) => {
    if (!ids.has(c.id)) return null;
    if (edge === 'left') return ripple ? { ...c, in: r3(c.in + k) } : { ...c, start: r3(c.start + k), in: r3(c.in + k) };
    return { ...c, out: setOut(c, clipOut(c, ctx) + k, ctx) };
  });
  if (ripple) next = shiftFrom(next, pivot, edge === 'right' ? k : -k, ids);
  return { edit: next, snapAt };
}
// kept for callers that trim a single clip
export const trimClip = (base, id, edge, dt, ctx, snap) => trimClips(base, [id], edge, dt, ctx, snap, { grab: id });

// ---------------------------------------------------------------------------------------------- slip and roll
/** Slip (Y): keep the clips where they are and show an earlier or later part of their source. Dragging right shows earlier. */
export function slipClips(base, idList, dt, ctx) {
  const group = idList.map((id) => byId(base, id)).filter((c) => c && isEditable(c, base));
  if (!group.length) return { edit: base, snapAt: null };
  const ids = new Set(group.map((c) => c.id));
  let lo = -Infinity; let hi = Infinity;
  for (const c of group) { lo = Math.max(lo, -c.in); hi = Math.min(hi, sourceLength(c, ctx) - clipOut(c, ctx)); }
  const k = Math.max(lo, Math.min(hi, -dt));
  return { edit: mapClips(base, (c) => (ids.has(c.id) ? { ...c, in: r3(c.in + k), out: setOut(c, clipOut(c, ctx) + k, ctx) } : null)), snapAt: null };
}

/** The clip that starts exactly where `clip` ends, on the same track. */
export const rightNeighbour = (edit, clip, ctx) => {
  const end = clipEnd(clip, ctx);
  return edit.clips.find((o) => o.track === clip.track && o.id !== clip.id && Math.abs(o.start - end) < EPS) || null;
};
export const leftNeighbour = (edit, clip, ctx) => edit.clips.find((o) => o.track === clip.track && o.id !== clip.id && Math.abs(clipEnd(o, ctx) - clip.start) < EPS) || null;

/**
 * Roll (N): move the cut between `leftId` and the clip right after it; one gets longer as the other gets shorter, so
 * nothing else moves. Linked clips with a cut at the same time roll with it.
 */
export function rollEdit(base, leftId, dt, ctx, snap, linked = true) {
  const left = byId(base, leftId);
  if (!left || !isEditable(left, base)) return { edit: base, snapAt: null };
  const t = clipEnd(left, ctx);
  const lefts = (linked ? linkGroup(base, leftId) : [leftId]).map((id) => byId(base, id))
    .filter((c) => isEditable(c, base) && Math.abs(clipEnd(c, ctx) - t) < EPS);
  const pairs = lefts.map((l) => [l, rightNeighbour(base, l, ctx)]).filter(([, r]) => r && isEditable(r, base));
  if (!pairs.length) return { edit: base, snapAt: null };
  let d = dt; let snapAt = null;
  if (snap) { const hit = nearestSnap([t + dt], snap.targets, snap.threshold); if (hit) { d = dt + hit.delta; snapAt = hit.at; } }
  let lo = -Infinity; let hi = Infinity;
  for (const [l, r] of pairs) {
    lo = Math.max(lo, MIN_CLIP - clipLength(l, ctx), -r.in);
    hi = Math.min(hi, sourceLength(l, ctx) - clipOut(l, ctx), clipLength(r, ctx) - MIN_CLIP);
  }
  const k = Math.max(lo, Math.min(hi, d));
  if (k !== d) snapAt = null;
  const L = new Set(pairs.map(([l]) => l.id)); const R = new Set(pairs.map(([, r]) => r.id));
  return {
    edit: mapClips(base, (c) => {
      if (L.has(c.id)) return { ...c, out: setOut(c, clipOut(c, ctx) + k, ctx) };
      if (R.has(c.id)) return { ...c, start: r3(c.start + k), in: r3(c.in + k) };
      return null;
    }),
    snapAt,
  };
}

// ---------------------------------------------------------------------------------------------- razor, delete, ripple delete
/** Cut the clips `idList` at time t. Pieces after the cut get new ids; linked clips stay linked piece by piece. */
export function razor(edit, idList, t, ctx) {
  const ids = new Set(idList);
  const links = {};
  const out = [];
  let cut = false;
  for (const c of edit.clips) {
    if (!ids.has(c.id) || !isEditable(c, edit) || !(t > c.start + MIN_CLIP / 2 && t < clipEnd(c, ctx) - MIN_CLIP / 2)) { out.push(c); continue; }
    const at = r3(c.in + (t - c.start));
    // the fade-in stays with the first piece and the fade-out with the second
    const right = { ...c, id: newId(c.source === 'line' ? 'L' : 'm'), start: r3(t), in: at, ...(c.fade_in ? { fade_in: 0 } : {}) };
    delete right.transition; // a transition belongs to the clip's start, which stays with the first piece
    if (c.link) right.link = (links[c.link] = links[c.link] || newId('k'));
    out.push({ ...c, out: at, ...(c.fade_out ? { fade_out: 0 } : {}) }, right);
    cut = true;
  }
  return cut ? { ...edit, clips: out } : edit;
}

/** Delete (lift): remove the clips and leave a gap. */
export function liftClips(edit, idList) {
  const ids = new Set(idList.filter((id) => { const c = byId(edit, id); return c && isEditable(c, edit); }));
  if (!ids.size) return edit;
  return noteRemoved(edit, { ...edit, clips: edit.clips.filter((c) => !ids.has(c.id)) });
}

function spansOf(edit, clips, ctx) {
  const spans = clips.map((c) => [c.start, clipEnd(c, ctx)]).sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s[0] <= last[1] + EPS) last[1] = Math.max(last[1], s[1]); else merged.push([...s]);
  }
  return merged;
}
function blockerIn(edit, a, b, ctx, skip) {
  return edit.clips.find((c) => !skip.has(c.id) && unlocked(edit, c) && c.start < b - EPS && clipEnd(c, ctx) > a + EPS) || null;
}

/**
 * Ripple delete (Shift+Delete): remove the clips and close the gap on every unlocked track, so everything after moves up.
 * The removed time has to be free of other clips on unlocked tracks. Returns { edit, error }.
 */
export function rippleDeleteClips(edit, idList, ctx) {
  const clips = idList.map((id) => byId(edit, id)).filter((c) => c && isEditable(c, edit));
  if (!clips.length) return { edit, error: null };
  const ids = new Set(clips.map((c) => c.id));
  const spans = spansOf(edit, clips, ctx);
  for (const [a, b] of spans) {
    const block = blockerIn(edit, a, b, ctx, ids);
    if (block) {
      return { edit, error: `Ripple delete needs that time to be empty on every unlocked track, and ${trackOf(edit, block.track)?.name || 'another track'} has a clip there. Select it too, lock its track, or press Delete to leave a gap.` };
    }
  }
  let next = { ...edit, clips: edit.clips.filter((c) => !ids.has(c.id)) };
  for (const [a, b] of spans.reverse()) next = shiftFrom(next, b, -(b - a), new Set());
  return { edit: noteRemoved(edit, next), error: null };
}

/** Remove the time [a, b) from every unlocked track (cutting clips at a and b) and close it up. Used by Q and W. */
export function rippleDeleteRange(edit, a, b, ctx) {
  if (b - a < EPS) return edit;
  let next = razor(edit, clipsAt(edit, a, ctx).map((c) => c.id), a, ctx);
  next = razor(next, clipsAt(next, b, ctx).map((c) => c.id), b, ctx);
  const inside = new Set(next.clips.filter((c) => unlocked(next, c) && c.start >= a - EPS && clipEnd(c, ctx) <= b + EPS).map((c) => c.id));
  next = { ...next, clips: next.clips.filter((c) => !inside.has(c.id)) };
  return noteRemoved(edit, shiftFrom(next, b, -(b - a), new Set()));
}

/** The empty stretch on a track around time t: { track, a, b } (only between clips, not after the last one). */
export function gapAt(edit, trackId, t, ctx) {
  const on = edit.clips.filter((c) => c.track === trackId);
  if (on.some((c) => c.start <= t && clipEnd(c, ctx) >= t)) return null;
  const before = on.filter((c) => clipEnd(c, ctx) <= t);
  const after = on.filter((c) => c.start >= t);
  if (!after.length) return null;
  const a = before.length ? Math.max(...before.map((c) => clipEnd(c, ctx))) : 0;
  const b = Math.min(...after.map((c) => c.start));
  return b - a > EPS ? { track: trackId, a: r3(a), b: r3(b) } : null;
}

/** Close a gap (Delete on a selected gap): pull everything after it up, if no unlocked track has a clip in that time. */
export function closeGap(edit, gap, ctx) {
  const block = blockerIn(edit, gap.a, gap.b, ctx, new Set());
  if (block) return { edit, error: `That gap cannot close: ${trackOf(edit, block.track)?.name || 'another track'} has a clip in the same time. Lock that track or cut the clip first.` };
  return { edit: shiftFrom(edit, gap.b, -(gap.b - gap.a), new Set()), error: null };
}

/** Put a line removed from the timeline back at its own time, if there is room on its track. */
export function putBackLine(edit, seg, ctx) {
  const track = `S:${seg.speaker}`;
  const start = r3(Math.max(0, seg.start + (seg.shift || 0)));
  const clip = { id: newId('L'), track, source: 'line', line: seg.id, start, in: 0, out: null, disabled: false, anchor: start };
  const end = start + sourceLength(clip, ctx);
  const block = edit.clips.find((c) => c.track === track && c.start < end - EPS && clipEnd(c, ctx) > start + EPS);
  if (block) return { edit, error: 'There is another clip at that line\'s time. Make room on its track first.' };
  return { edit: { ...edit, clips: [...edit.clips, clip], removed_lines: (edit.removed_lines || []).filter((l) => l !== seg.id) }, error: null };
}

// ---------------------------------------------------------------------------------------------- small edits
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
  const c = byId(edit, id);
  if (!c || !isEditable(c, edit)) return edit;
  let e = edit;
  if (patch.start != null) e = moveClips(e, [id], patch.start - c.start, ctx).edit;
  const cur = () => byId(e, id);
  if (patch.in != null) e = trimClip(e, id, 'left', patch.in - cur().in, ctx).edit;
  if (patch.out != null) e = trimClip(e, id, 'right', patch.out - clipOut(cur(), ctx), ctx).edit;
  return e;
}

/** Every clip edge on the timeline, sorted (Up / Down jump between them). */
export function editPoints(edit, ctx) {
  const pts = new Set([0, r3(ctx.duration)]);
  for (const c of edit.clips) { pts.add(r3(c.start)); pts.add(r3(clipEnd(c, ctx))); }
  return [...pts].sort((a, b) => a - b);
}

/** The clip on a track that is playing at time t (enabled or not), or null. */
export function clipOnTrackAt(edit, trackId, t, ctx) {
  for (const c of edit.clips) if (c.track === trackId && c.start <= t + 1e-6 && clipEnd(c, ctx) > t + 1e-6) return c;
  return null;
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
      // rapid changes to one control (a slider being dragged) become a single undo step
      if (action.merge && h.merge === action.merge && Date.now() - (h.mergeAt || 0) < 1000) {
        return { ...h, present: action.edit, future: [], base: null, mergeAt: Date.now() };
      }
      return { past: [...h.past, h.present].slice(-LIMIT), present: action.edit, future: [], base: null, merge: action.merge || null, mergeAt: Date.now() };
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
