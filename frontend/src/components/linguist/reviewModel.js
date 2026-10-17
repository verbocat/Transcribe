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
export const buildSavedDraft = (draft, tracks) => {
  if (tracks.__main) return { ...draft, events: tracks.__main, timestamp: new Date().toISOString() };
  const active = draft.activeTrack && tracks[draft.activeTrack] ? draft.activeTrack : Object.keys(tracks)[0];
  return { ...draft, tracks, events: tracks[active], activeTrack: active, timestamp: new Date().toISOString() };
};
