/** Languages Centroid can translate between (shared by the Translate drawer and the language tracks bar). */
export const COMMON_LANGS = [
  ['en', 'English'], ['hi', 'Hindi'], ['bn', 'Bengali'], ['ta', 'Tamil'], ['te', 'Telugu'], ['mr', 'Marathi'],
  ['gu', 'Gujarati'], ['kn', 'Kannada'], ['ml', 'Malayalam'], ['pa', 'Punjabi'], ['ur', 'Urdu'],
  ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['ar', 'Arabic'],
];

export const OTHER_LANGS = [
  ['ne', 'Nepali'], ['it', 'Italian'], ['pt', 'Portuguese'], ['pt-br', 'Portuguese (Brazil)'], ['ru', 'Russian'],
  ['tr', 'Turkish'], ['fa', 'Persian'], ['he', 'Hebrew'], ['zh', 'Chinese (Simplified)'], ['zht', 'Chinese (Traditional)'],
  ['ja', 'Japanese'], ['ko', 'Korean'], ['th', 'Thai'], ['vi', 'Vietnamese'], ['id', 'Indonesian'], ['ms', 'Malay'],
  ['nl', 'Dutch'], ['pl', 'Polish'], ['sv', 'Swedish'], ['uk', 'Ukrainian'], ['el', 'Greek'],
];

export const ALL_LANGS = [...COMMON_LANGS, ...OTHER_LANGS];

export const langName = (code) => (ALL_LANGS.find(([c]) => c === code) || [code, code])[1];
