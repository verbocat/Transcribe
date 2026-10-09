// Local (this browser) autosave drafts for the Transcribe Studio, keyed by media file name.
// App.jsx writes `karya_autosave_<file name>`; these helpers read them back so an old video can offer its draft.

import { normalizeDraft, removeDraftExtras } from './draftStore';

export const TRANSCRIBE_DRAFT_PREFIX = 'karya_autosave_';
export const transcribeDraftKey = (name) => `${TRANSCRIBE_DRAFT_PREFIX}${name || 'draft_audio'}`;

/** The saved draft for one media file name, or null (missing, empty or unreadable). */
export function readTranscribeDraft(name) {
  try {
    // normalizeDraft accepts every older version of the draft format
    const d = normalizeDraft(JSON.parse(localStorage.getItem(transcribeDraftKey(name)) || 'null'));
    return d && d.segments.length ? d : null;
  } catch { return null; }
}

/** Writes the lean draft; false when the browser's storage is full or unavailable. */
export function writeTranscribeDraft(name, draft) {
  try { localStorage.setItem(transcribeDraftKey(name), JSON.stringify(draft)); return true; } catch { return false; }
}

export function removeTranscribeDraft(name) {
  try { localStorage.removeItem(transcribeDraftKey(name)); } catch { /* storage unavailable */ }
  removeDraftExtras(name);
}

/** Every Transcribe draft in this browser, newest first. */
export function listTranscribeDrafts() {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i) || '';
      if (!key.startsWith(TRANSCRIBE_DRAFT_PREFIX)) continue;
      const name = key.slice(TRANSCRIBE_DRAFT_PREFIX.length);
      const d = readTranscribeDraft(name);
      if (d) out.push({ name, count: d.segments.length, timestamp: d.timestamp });
    }
  } catch { /* storage unavailable */ }
  return out.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
}
