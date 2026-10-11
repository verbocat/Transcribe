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
  // Leave <i>, <b>, <font …> and {\anN} tags untouched
  return text
    .split(/(<[^>]+>|\{\\an[1-9]\})/)
    .map((part) => {
      if ((part.startsWith('<') && part.endsWith('>')) || /^\{\\an[1-9]\}$/.test(part)) return part;
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

/** Guideline rules a one-click QC fix can repair by re-breaking the lines. */
export const QC_REBREAK_RULES = new Set([
  'NF-CPL', 'NF-MAX-LINES', 'NF-LINE-BREAK', 'NF-ORPHAN',
  'NF-LINE-BREAK-ARTICLE', 'NF-LINE-BREAK-PRONOUN', 'NF-LINE-BREAK-TITLE', 'NF-LINE-BREAK-POSTPOSITION', 'NF-LINE-BREAK-NUMBER',
]);

/** Guideline rules that have a one-click fix at all. Whether the fix is possible for a given subtitle is decided by planQcFixes. */
export function isQcFixable(ruleId) {
  const r = String(ruleId || '').toUpperCase();
  return r === 'NF-DURATION-SHORT' || r.startsWith('NF-CPS') || r.startsWith('NF-GAP') || r === 'NF-OVERLAP'
    || r === 'NF-PUNCT-SPACE' || r === 'NF-ELLIPSIS' || r === 'NF-DUAL-SPEAKER-SPACE' || QC_REBREAK_RULES.has(r);
}

const stripMarkup = (t) => String(t || '').replace(/<[^>]*>/g, '').replace(/\{\\an[1-9]\}/g, '');

/** Characters that count towards reading speed (same counting as the backend linter). */
export function readingChars(text) {
  return stripMarkup(text).replace(/[♪♫]/g, '').split('\n').map((l) => l.trim().replace(/^-\s*/, '')).join(' ').replace(/\s+/g, ' ').trim().length;
}

/** Do all lines fit the characters-per-line and line-count limits? (A leading speaker dash is not counted.) */
export function fitsLines(text, cplLimit, maxLines = 2) {
  const lines = String(text || '').split('\n');
  return lines.length <= maxLines && lines.every((l) => stripMarkup(l).trim().replace(/^-\s*/, '').length <= cplLimit);
}

/**
 * Work out what each one-click QC fix would do, without touching the input.
 *   items: [{ key, eventId, ruleId }]
 *   ctx:   { fps, cplLimit, cpsLimit, minDuration, maxDuration, maxLines, rebroke: Map(eventId -> re-broken text) }
 * Items are applied one after another on a copy, so a batch behaves exactly like "fix all".
 * A fix that cannot be done (no free gap, would break another rule, text too long) comes back with
 * ok:false and the reason, so the UI can ask for a human instead of counting it as fixable.
 * Returns { events, results: [{ key, ok, message }] }.
 */
export function planQcFixes(events, items, ctx) {
  const fps = ctx.fps > 0 ? ctx.fps : 24;
  const gap = 2 / fps;
  const { cplLimit, cpsLimit, minDuration, maxDuration } = ctx;
  const maxLines = ctx.maxLines || 2;
  const rebroke = ctx.rebroke || new Map();
  const eps = 0.005;
  const work = events.map((e) => ({ ...e }));
  const results = [];
  const fail = (item, message) => results.push({ key: item.key, ok: false, message });
  const done = (item, message) => results.push({ key: item.key, ok: true, message });

  for (const item of items) {
    const idx = work.findIndex((e) => idOf(e) === item.eventId);
    if (idx < 0) { fail(item, 'This subtitle no longer exists.'); continue; }
    const e = work[idx];
    const start = startOf(e);
    const end = endOf(e);
    const text = e.text || '';
    const next = work.reduce((best, o, j) => (j !== idx && startOf(o) > start + 1e-6 && (!best || startOf(o) < startOf(best)) ? o : best), null);
    const roomEnd = next ? startOf(next) - gap : Infinity;
    const chars = readingChars(text);
    const rule = String(item.ruleId || '').toUpperCase();
    // A gap of 3 to 11 frames flickers, so an extended subtitle that would leave one is chained to 2 frames instead
    const setEnd = (t) => {
      const left = next ? startOf(next) - t : Infinity;
      const chained = next && left * fps < 12 && roomEnd > t && roomEnd - start <= maxDuration + eps ? roomEnd : t;
      work[idx] = withTimes(e, start, round3(chained));
    };

    if (rule === 'NF-DURATION-SHORT') {
      const target = round3(start + minDuration + 0.001);
      if (end - start >= minDuration - eps) { done(item, 'Already long enough'); continue; }
      if (target > roomEnd + 1e-6) { fail(item, 'No free time after this subtitle to make it longer. Merge it with a neighbour or move the next one.'); continue; }
      setEnd(target);
      done(item, `Now ${(endOf(work[idx]) - start).toFixed(2)}s long`);
    } else if (rule.startsWith('NF-CPS')) {
      const warnCps = cpsLimit - 2;
      const dur = end - start;
      if (chars / Math.max(dur, 1e-6) <= (rule === 'NF-CPS-WARNING' ? warnCps : cpsLimit) + 1e-6) { done(item, 'Reading speed is already fine'); continue; }
      const durFor = (cps) => Math.ceil((chars / cps) * 1000) / 1000 + 0.002;
      const best = round3(start + Math.max(durFor(warnCps), minDuration));
      const least = round3(start + Math.max(durFor(cpsLimit), minDuration));
      const cap = Math.min(roomEnd, start + maxDuration);
      let target = null;
      if (best <= cap + 1e-6) target = best;
      else if (rule !== 'NF-CPS-WARNING' && least <= cap + 1e-6) target = least;
      if (target == null || target <= end + eps) {
        fail(item, next && roomEnd - start < maxDuration
          ? 'No free time after this subtitle to slow the reading speed. Shorten the text or move the next subtitle.'
          : 'Cannot be slowed enough within the maximum duration. Shorten the text or split the subtitle.');
        continue;
      }
      setEnd(target);
      const got = endOf(work[idx]) - start;
      done(item, `Now ${got.toFixed(2)}s long (${(chars / got).toFixed(1)} chars/s)`);
    } else if (rule.startsWith('NF-GAP') || rule === 'NF-OVERLAP') {
      // The linter flags the LATER subtitle; the cure is to move the EARLIER subtitle's out point
      const pi = work.reduce((best, o, j) => (j !== idx && startOf(o) < start - 1e-6 && (best < 0 || startOf(o) > startOf(work[best])) ? j : best), -1);
      if (pi < 0) { fail(item, 'There is no earlier subtitle to space this one from.'); continue; }
      const prev = work[pi];
      const ps = startOf(prev);
      const pe = endOf(prev);
      const target = round3(start - gap);
      if (Math.abs(target - pe) < 0.0005) { done(item, 'Gap is already 2 frames'); continue; }
      const dur = target - ps;
      const pchars = readingChars(prev.text);
      const who = `Subtitle #${idOf(prev)}`;
      if (dur < 0.1) { fail(item, `No space between these subtitles: closing the gap would leave #${idOf(prev)} almost no time on screen. Re-time one of them.`); continue; }
      if (dur < minDuration - eps && pe - ps >= minDuration - eps) { fail(item, `No space between these subtitles: closing the gap would make #${idOf(prev)} shorter than the minimum duration. Re-time one of them.`); continue; }
      if (dur > maxDuration + eps && pe - ps <= maxDuration + eps) { fail(item, `Chaining would make ${who} longer than the maximum duration. Re-time it by hand.`); continue; }
      if (target < pe && pchars / dur > cpsLimit && pchars / (pe - ps) <= cpsLimit) { fail(item, `Closing the gap would make ${who} too fast to read. Shorten its text or re-time it.`); continue; }
      work[pi] = withTimes(prev, ps, target);
      done(item, `${who} now ends 2 frames before this one`);
    } else if (QC_REBREAK_RULES.has(rule)) {
      const t = rebroke.get(item.eventId);
      const hard = rule === 'NF-CPL' || rule === 'NF-MAX-LINES';
      if (t === undefined || t === text || (hard && !fitsLines(t, cplLimit, maxLines))) {
        fail(item, hard ? `The text is too long to fit ${maxLines} lines of ${cplLimit} characters. Shorten it or split the subtitle.` : 'The lines cannot be broken any better. Edit the text by hand.');
        continue;
      }
      work[idx] = withText(e, t);
      done(item, 'Lines re-broken to fit');
    } else if (rule === 'NF-PUNCT-SPACE' || rule === 'NF-ELLIPSIS' || rule === 'NF-DUAL-SPEAKER-SPACE') {
      let t = text;
      if (rule === 'NF-PUNCT-SPACE') t = text.replace(/(?<=\S)[ \t]+([,.!?;:।॥…])/g, '$1');
      else if (rule === 'NF-ELLIPSIS') t = text.replace(/\.{3}/g, '…');
      else t = text.split('\n').map((l) => l.replace(/^(\s*(?:<[^>]+>)*[-–—])\s+/, '$1')).join('\n');
      if (t === text) { fail(item, 'Edit this one by hand in the editor.'); continue; }
      work[idx] = withText(e, t);
      done(item, rule === 'NF-ELLIPSIS' ? 'Three dots replaced with …' : 'Spacing fixed');
    } else {
      fail(item, 'This one needs a manual edit.');
    }
  }
  return { events: work, results };
}
