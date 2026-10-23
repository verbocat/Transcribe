// Pure helpers for the linguist review editor (kept apart from the component so they can be tested).

export const fmtTime = (sec) => {
  const t = Math.max(0, Number(sec) || 0);
  const ms = Math.round(t * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${p(h)}:${p(m)}:${p(s)}.${p(r, 3)}`;
};

/** "1:02.5", "00:01:02.500", "62.5", "00:01:02,500" -> seconds, or null when it isn't a time. */
export const parseTime = (text) => {
  const raw = String(text ?? '').trim().replace(',', '.');
  if (!raw) return null;
  const parts = raw.split(':');
  if (parts.length > 3 || parts.some((x) => !/^\d+(\.\d+)?$/.test(x))) return null;
  return parts.reduce((acc, x) => acc * 60 + Number(x), 0);
};

const srtTime = (sec) => fmtTime(sec).replace('.', ',');

/** Plain SRT from a list of cues. Formatting tags the studio keeps in the text are left as they are. */
export const toSrt = (events) =>
  events
    .filter((e) => String(e.text ?? '').trim())
    .map((e, i) => `${i + 1}\n${srtTime(e.start_time ?? e.start)} --> ${srtTime(e.end_time ?? e.end)}\n${String(e.text).replace(/\r?\n/g, '\n')}\n`)
    .join('\n');

/** Characters per second of a cue, ignoring line breaks and simple tags. */
export const cps = (e) => {
  const dur = (e.end_time ?? e.end ?? 0) - (e.start_time ?? e.start ?? 0);
  const chars = String(e.text ?? '').replace(/<[^>]*>|\{[^}]*\}|\s/g, '').length;
  return dur > 0 ? chars / dur : 0;
};

/** Which cue is on screen at `t` (seconds), or -1. */
export const cueAt = (events, t) => events.findIndex((e) => t >= (e.start_time ?? e.start) && t < (e.end_time ?? e.end));

/**
 * Tracks the linguist can switch between. A draft with language tracks has `tracks`; an older or single-track
 * draft has only `events`, shown as one track.
 */
export const trackSet = (draft) => {
  const tracks = draft?.tracks && typeof draft.tracks === 'object' ? { ...draft.tracks } : {};
  const codes = Object.keys(tracks).filter((c) => Array.isArray(tracks[c]));
  if (codes.length === 0) return { codes: ['__main'], tracks: { __main: Array.isArray(draft?.events) ? draft.events : [] }, active: '__main' };
  const active = codes.includes(draft.activeTrack) ? draft.activeTrack : codes[0];
  return { codes, tracks, active };
};

/** Put the edited tracks back into the draft the way the studio expects it (events = the active track). */
export const buildSavedDraft = (draft, tracks, issues) => {
  const qc = draft.qc && issues ? { ...draft.qc, issues } : draft.qc;
  const base = qc ? { ...draft, qc } : draft;
  if (tracks.__main) return { ...base, events: tracks.__main, timestamp: new Date().toISOString() };
  const active = draft.activeTrack && tracks[draft.activeTrack] ? draft.activeTrack : Object.keys(tracks)[0];
  return { ...base, tracks, events: tracks[active], activeTrack: active, timestamp: new Date().toISOString() };
};

/**
 * The coordinator's QC findings that travel with a shared project: [{index, severity, title, ..., track, status}].
 * `track` is the language track the finding is about ('__main' for a single-track draft).
 */
export const qcIssues = (draft) => (Array.isArray(draft?.qc?.issues) ? draft.qc.issues : []);

/** Text a finding proposes for its cue, when it proposes one (the linguist decides whether to use it). */
export const suggestionText = (issue) => (typeof issue?.suggestion === 'string' && issue.suggestion.trim() ? issue.suggestion : null);

// ── Editing operations for the linguist timeline and list. Each takes the events of the active track and returns
//    { events, issueMap } where issueMap(oldIndex) gives the new 1-based position of a QC finding (or null when its line is gone).

const startOf = (e) => e.start_time ?? e.start ?? 0;
const endOf = (e) => e.end_time ?? e.end ?? 0;
const round3 = (n) => Math.round(n * 1000) / 1000;
const withTimes = (e, s, t) => ({ ...e, start_time: round3(s), end_time: round3(t), start: round3(s), end: round3(t), duration: round3(Math.max(0.1, t - s)) });
const same = (n) => n;

/** Every cue gets a numeric id, so the timeline can select and drag it. */
export const ensureIds = (events) => {
  let next = Math.max(0, ...events.map((e) => Number(e.id) || 0)) + 1;
  return events.map((e) => (Number.isFinite(Number(e.id)) && e.id !== null && e.id !== '' ? e : { ...e, id: next++ }));
};

export const setTimes = (events, id, start, end) => ({ events: events.map((e) => (e.id === id ? withTimes(e, start, end) : e)), issueMap: same });

/** Split the cue under `t` in two, at the nearest space to the middle of its text. */
export const splitAt = (events, t, preferId = null) => {
  let i = events.findIndex((e) => t > startOf(e) && t < endOf(e));
  if (i < 0 && preferId != null) i = events.findIndex((e) => e.id === preferId);
  if (i < 0) return null;
  const ev = events[i];
  const s = startOf(ev);
  const en = endOf(ev);
  if (t <= s + 0.1 || t >= en - 0.1) return null;
  const text = String(ev.text ?? '');
  const mid = Math.floor(text.length / 2);
  const sp = text.lastIndexOf(' ', mid) > -1 ? text.lastIndexOf(' ', mid) : mid;
  const cut = sp > 0 ? sp : mid;
  const a = text.slice(0, cut).trim();
  const b = text.slice(cut).trim();
  const at = round3(t);
  const second = round3(at + 0.08);
  const newId = Math.max(0, ...events.map((e) => Number(e.id) || 0)) + 1;
  const first = { ...withTimes(ev, s, at), text: a, lines: a.split('\n') };
  const last = { ...withTimes(ev, second, en), id: newId, text: b, lines: b.split('\n') };
  const out = [...events];
  out.splice(i, 1, first, last);
  return { events: out, activeId: newId, issueMap: (n) => (n > i + 1 ? n + 1 : n) };
};

export const mergeWithNext = (events, id) => {
  const i = events.findIndex((e) => e.id === id);
  if (i < 0 || i >= events.length - 1) return null;
  const cur = events[i];
  const nxt = events[i + 1];
  const text = `${cur.text ?? ''}\n${nxt.text ?? ''}`.trim();
  const merged = { ...withTimes(cur, startOf(cur), endOf(nxt)), text, lines: text.split('\n') };
  const out = [...events];
  out.splice(i, 2, merged);
  return { events: out, activeId: cur.id, issueMap: (n) => (n === i + 2 ? i + 1 : n > i + 2 ? n - 1 : n) };
};

export const removeEvent = (events, id) => {
  const i = events.findIndex((e) => e.id === id);
  if (i < 0) return null;
  const out = events.filter((e) => e.id !== id);
  return { events: out, activeId: out.length ? out[Math.min(i, out.length - 1)].id : null, issueMap: (n) => (n === i + 1 ? null : n > i + 1 ? n - 1 : n) };
};

export const addEvent = (events, at, end, text = '') => {
  const s = Math.max(0, at);
  const e = Math.max(s + 0.2, end);
  const id = Math.max(0, ...events.map((x) => Number(x.id) || 0)) + 1;
  const fresh = { id, ...withTimes({}, s, e), text, lines: [text], speaker_count: 1, speakers: ['Speaker 1'], qc_errors: [], is_valid: true };
  const out = [...events, fresh].sort((a, b) => startOf(a) - startOf(b));
  const pos = out.findIndex((x) => x.id === id);
  return { events: out, activeId: id, issueMap: (n) => (n > pos ? n + 1 : n) };
};

/** Move the cue `id` and every cue after it so that this cue starts at `t`, keeping the gaps between them. */
export const shiftFollowing = (events, id, t) => {
  const i = events.findIndex((e) => e.id === id);
  if (i < 0) return null;
  const delta = t - startOf(events[i]);
  const first = events.slice(i).reduce((m, e) => Math.min(m, startOf(e)), Infinity);
  const d = Math.max(delta, -first);
  return { events: events.map((e, k) => (k >= i ? withTimes(e, startOf(e) + d, endOf(e) + d) : e)), issueMap: same };
};

/** Re-number a track's QC findings after a structural edit (split, merge, delete, add). */
export const remapIssues = (issues, trackCode, issueMap) =>
  issues.flatMap((q) => {
    if ((q.track || '__main') !== trackCode) return [q];
    const n = issueMap(q.index);
    return n === null ? [] : [{ ...q, index: n }];
  });
