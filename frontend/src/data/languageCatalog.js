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

/**
 * Subtitle Studio's spoken-language list: the same list plus the Portuguese regional variants.
 * The speech engine has a single Portuguese, so a variant is sent to it as "Portuguese" and kept
 * separately (spokenVariantCode) for translation and rule-book steps.
 */
const PT_VARIANTS = { 'Portuguese (Portugal)': 'pt-pt', 'Portuguese (Brazil)': 'pt-br' };
export const SUBTITLE_SOURCE_LANGUAGES = TRANSCRIBE_LANGUAGES.flatMap(([v, l]) =>
  v === 'Portuguese' ? [[v, l], ['Portuguese (Portugal)', 'Portuguese (Portugal)'], ['Portuguese (Brazil)', 'Portuguese (Brazil)']] : [[v, l]]);
/** The name the transcription engine takes for a picker value */
export const engineLanguage = (v) => (PT_VARIANTS[v] ? 'Portuguese' : v || AUTO_DETECT);
/** Regional variant code (for translation) when the picker value is one, else null */
export const spokenVariantCode = (v) => PT_VARIANTS[v] || null;

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
