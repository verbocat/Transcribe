import { TRANSLATE_LANGUAGES } from '../../data/languageCatalog';

/** Languages Centroid can translate between (shared by the Translate drawer and the language tracks bar). */
export const COMMON_LANGS = [
  ['en', 'English'], ['hi', 'Hindi'], ['bn', 'Bengali'], ['ta', 'Tamil'], ['te', 'Telugu'], ['mr', 'Marathi'],
  ['gu', 'Gujarati'], ['kn', 'Kannada'], ['ml', 'Malayalam'], ['pa', 'Punjabi'],
  ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'],
];

// Everything else Centroid is asked to translate into: the same alphabetical list Transcribe Studio offers.
const COMMON_CODES = new Set(COMMON_LANGS.map(([c]) => c));
export const OTHER_LANGS = TRANSLATE_LANGUAGES.filter(([c]) => !COMMON_CODES.has(c));

export const ALL_LANGS = [...COMMON_LANGS, ...OTHER_LANGS];

export const langName = (code) => (ALL_LANGS.find(([c]) => c === code) || [code, code])[1];
