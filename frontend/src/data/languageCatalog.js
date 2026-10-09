import catalog from './languages.json';

/**
 * One list behind both Transcribe Studio language pickers (mirrors backend/app/language_catalog.py):
 *  - transcription: every language ElevenLabs Scribe can transcribe, value = English name (what the API takes)
 *  - translation:   every language Centroid is asked to translate into, value = Centroid language code
 * Both are alphabetical; the transcription list starts with Auto-detect, the translation source list can too.
 */
const byName = (a, b) => a.name.localeCompare(b.name, 'en');
const label = (l) => (l.native ? `${l.name} (${l.native})` : l.name);

export const AUTO_DETECT = 'Auto-Detect';
export const AUTO_SOURCE = 'auto';

export const TRANSCRIBE_LANGUAGES = [
  [AUTO_DETECT, 'Auto-detect'],
  ...catalog.filter((l) => l.scribe).sort(byName).map((l) => [l.name, label(l)]),
];

/** [code, name] for the Centroid translate pickers, alphabetical */
export const TRANSLATE_LANGUAGES = catalog.filter((l) => l.translate).sort(byName).map((l) => [l.translate, l.name]);
export const TRANSLATE_SOURCE_LANGUAGES = [[AUTO_SOURCE, 'Auto-detect'], ...TRANSLATE_LANGUAGES];

const NAMES = new Map(TRANSLATE_LANGUAGES);
export const translateLangName = (code) => (code === AUTO_SOURCE ? 'Auto-detect' : NAMES.get(code) || code);

/** Centroid code for a transcription language name such as "Hindi" (null when Centroid has none) */
export function translateCodeForName(name) {
  const key = String(name || '').toLowerCase();
  const hit = catalog.find((l) => l.translate && l.name.toLowerCase() === key);
  return hit ? hit.translate : null;
}
