/**
 * Pure bulk-edit helpers for the Subtitle and Edit menus. Each takes the event list and
 * returns { events, changed } without mutating the input, so the caller can push the
 * result through the normal undo history and re-run QC.
 */

const round3 = (n) => Math.round(n * 1000) / 1000;
const startOf = (e) => e.start_time ?? e.start ?? 0;
const endOf = (e) => e.end_time ?? e.end ?? 0;
const idOf = (e) => e.id ?? e.event_id;

function withTimes(ev, s, e) {
  const start = round3(Math.max(0, s));
  const end = round3(Math.max(start + 0.1, e));
  return { ...ev, start_time: start, end_time: end, start, end, duration: round3(end - start) };
}

function withText(ev, text) {
  return { ...ev, text, lines: text.split('\n') };
}

const inScope = (ev, ids) => !ids || ids.has(idOf(ev));
const result = (events, changed) => ({ events, changed });

/** Move every subtitle (or those from `fromId` onwards) by `delta` seconds. */
export function shiftTimes(events, delta, { fromId = null } = {}) {
  if (!delta) return result(events, 0);
  let from = 0;
  if (fromId != null) {
    const i = events.findIndex((e) => idOf(e) === fromId);
    if (i >= 0) from = i;
  }
  let changed = 0;
  const next = events.map((ev, i) => {
    if (i < from) return ev;
    changed += 1;
    return withTimes(ev, startOf(ev) + delta, endOf(ev) + delta);
  });
  return result(next, changed);
}

/** Smallest delta that keeps every affected subtitle at or after 0. */
export function minShift(events, fromId = null) {
  let from = 0;
  if (fromId != null) {
    const i = events.findIndex((e) => idOf(e) === fromId);
    if (i >= 0) from = i;
  }
  const slice = events.slice(from);
  return slice.length ? -Math.min(...slice.map(startOf)) : 0;
}

const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'vs']);

function caseText(text, mode) {
  // Leave <i>, <b>, <font …> tags untouched
  return text
    .split(/(<[^>]+>)/)
    .map((part) => {
      if (part.startsWith('<') && part.endsWith('>')) return part;
      if (mode === 'upper') return part.toUpperCase();
      if (mode === 'lower') return part.toLowerCase();
      if (mode === 'sentence') {
        return part.toLowerCase().replace(/(^|[.!?…]\s+|\n\s*|-\s+)(\p{L})/gu, (_, pre, ch) => pre + ch.toUpperCase())
          .replace(/^(\p{L})/u, (c) => c.toUpperCase());
      }
      if (mode === 'title') {
        return part.toLowerCase().replace(/(^|[\s\-(\[“"'])(\p{L}[\p{L}'’]*)/gu, (m, pre, word, offset) =>
          (offset > 0 && SMALL_WORDS.has(word) ? pre + word : pre + word.charAt(0).toUpperCase() + word.slice(1)));
      }
      return part;
    })
    .join('');
}

/** mode: upper | lower | sentence | title. `ids` (Set) limits the scope. */
export function changeCase(events, mode, ids = null) {
  let changed = 0;
  const next = events.map((ev) => {
    if (!inScope(ev, ids) || !ev.text) return ev;
    const text = caseText(ev.text, mode);
    if (text === ev.text) return ev;
    changed += 1;
    return withText(ev, text);
  });
  return result(next, changed);
}

/** Collapse repeated spaces, trim line ends and drop blank lines. */
export function tidyWhitespace(events, ids = null) {
  let changed = 0;
  const next = events.map((ev) => {
    if (!inScope(ev, ids) || !ev.text) return ev;
    const text = ev.text
      .split('\n')
      .map((l) => l.replace(/[ \t ]{2,}/g, ' ').trim())
      .filter((l) => l.length > 0)
      .join('\n');
    if (text === ev.text) return ev;
    changed += 1;
    return withText(ev, text);
  });
  return result(next, changed);
}

export function removeEmpty(events) {
  const next = events.filter((ev) => (ev.text || '').replace(/<[^>]+>/g, '').trim().length > 0);
  return result(next, events.length - next.length);
}

export function sortByStart(events) {
  const sorted = [...events].sort((a, b) => startOf(a) - startOf(b));
  const changed = sorted.some((e, i) => e !== events[i]) ? sorted.length : 0;
  return result(changed ? sorted : events, changed);
}

/** Snap every in/out point to the nearest frame. */
export function snapToFrames(events, fps) {
  const rate = fps > 0 ? fps : 24;
  const snap = (t) => round3(Math.round(t * rate) / rate);
  let changed = 0;
  const next = events.map((ev) => {
    const s = snap(startOf(ev));
    const e = Math.max(snap(endOf(ev)), s + 1 / rate);
    if (Math.abs(s - startOf(ev)) < 0.0005 && Math.abs(e - endOf(ev)) < 0.0005) return ev;
    changed += 1;
    return withTimes(ev, s, e);
  });
  return result(next, changed);
}

/**
 * Enforce a minimum gap between neighbours by pulling the earlier subtitle's out point back
 * (Netflix asks for at least 2 frames). Only touches gaps that are smaller than the minimum.
 */
export function enforceMinGap(events, fps, frames = 2) {
  const rate = fps > 0 ? fps : 24;
  const minGap = frames / rate;
  let changed = 0;
  const next = events.map((ev) => ev);
  for (let i = 0; i < next.length - 1; i += 1) {
    const cur = next[i];
    const nxt = next[i + 1];
    const gap = startOf(nxt) - endOf(cur);
    if (gap < minGap - 0.0005 && startOf(nxt) - minGap > startOf(cur) + 0.1) {
      next[i] = withTimes(cur, startOf(cur), startOf(nxt) - minGap);
      changed += 1;
    }
  }
  return result(next, changed);
}

/** Stretch one subtitle's out point to just before the next subtitle starts. */
export function extendToNext(events, id, fps) {
  const rate = fps > 0 ? fps : 24;
  const i = events.findIndex((e) => idOf(e) === id);
  if (i < 0 || i >= events.length - 1) return result(events, 0);
  const target = startOf(events[i + 1]) - 2 / rate;
  if (target <= endOf(events[i]) + 0.0005) return result(events, 0);
  const next = [...events];
  next[i] = withTimes(events[i], startOf(events[i]), target);
  return result(next, 1);
}

/** Merge subtitles whose text is identical and that follow each other closely. */
export function mergeDuplicates(events, maxGap = 0.5) {
  const out = [];
  let changed = 0;
  for (const ev of events) {
    const prev = out[out.length - 1];
    if (prev && prev.text === ev.text && startOf(ev) - endOf(prev) <= maxGap) {
      out[out.length - 1] = withTimes(prev, startOf(prev), Math.max(endOf(prev), endOf(ev)));
      changed += 1;
    } else {
      out.push(ev);
    }
  }
  return result(changed ? out : events, changed);
}

/** Strip <i>/<b>/<u>/<font> tags and {\an8}-style overrides. */
export function stripTags(events, ids = null) {
  let changed = 0;
  const next = events.map((ev) => {
    if (!inScope(ev, ids) || !ev.text) return ev;
    const text = ev.text.replace(/<\/?[a-z][^>]*>/gi, '').replace(/\{\\[^}]*\}/g, '');
    if (text === ev.text) return ev;
    changed += 1;
    return { ...withText(ev, text), is_italic: false };
  });
  return result(next, changed);
}

/** Count how many subtitles contain `find` (used for the live match count in Find & Replace). */
export function countMatches(events, find, { matchCase = false, wholeWord = false } = {}) {
  if (!find) return { subtitles: 0, occurrences: 0 };
  let pattern = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (wholeWord) pattern = `\\b${pattern}\\b`;
  let re;
  try { re = new RegExp(pattern, matchCase ? 'g' : 'gi'); } catch (_) { return { subtitles: 0, occurrences: 0 }; }
  let subtitles = 0;
  let occurrences = 0;
  for (const ev of events) {
    const m = (ev.text || '').match(re);
    if (m) { subtitles += 1; occurrences += m.length; }
  }
  return { subtitles, occurrences };
}

/** Parse "12.5", "-0.4", "1:02.500", "00:01:02:12" (frames need fps) into seconds, or null. */
export function parseTimeInput(raw, fps = 24) {
  const t = String(raw ?? '').trim().replace(',', '.');
  if (!t) return null;
  if (/^-?\d+(\.\d+)?$/.test(t)) return parseFloat(t);
  const neg = t.startsWith('-');
  const parts = t.replace(/^-/, '').split(':');
  if (parts.length < 2 || parts.length > 4 || parts.some((p) => p === '' || Number.isNaN(Number(p)))) return null;
  let seconds;
  if (parts.length === 4) {
    const [h, m, s, f] = parts.map(Number);
    seconds = h * 3600 + m * 60 + s + f / (fps > 0 ? fps : 24);
  } else if (parts.length === 3) {
    const [h, m, s] = parts.map(Number);
    seconds = h * 3600 + m * 60 + s;
  } else {
    const [m, s] = parts.map(Number);
    seconds = m * 60 + s;
  }
  return neg ? -seconds : seconds;
}

/** Build a RegExp for a plain-text search, or null when it can't be built. */
export function makeMatcher(find, { matchCase = false, wholeWord = false, global = false } = {}) {
  if (!find) return null;
  let pattern = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (wholeWord) pattern = `\b${pattern}\b`;
  try { return new RegExp(pattern, `${global ? 'g' : ''}${matchCase ? '' : 'i'}`); } catch (_) { return null; }
}

/** Replace every occurrence of `find` in the subtitle text. */
export function replaceInEvents(events, find, replacement, opts = {}) {
  const re = makeMatcher(find, { ...opts, global: true });
  if (!re) return result(events, 0);
  let changed = 0;
  const next = events.map((ev) => {
    if (!ev.text) return ev;
    const text = ev.text.replace(re, () => replacement);
    if (text === ev.text) return ev;
    changed += 1;
    return withText(ev, text);
  });
  return result(next, changed);
}
