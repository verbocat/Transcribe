import React from 'react';
import { Languages } from 'lucide-react';
import { TRANSCRIBE_LANGUAGES } from '../../data/languageCatalog';

/** The spoken-language picker for transcription: Auto-detect first, then every supported language A to Z. */
export default function LanguageSelect({ value, onChange, disabled }) {
  return (
    <label className="flex items-center gap-2" style={{ color: 'var(--ts-muted)' }}>
      <Languages size={15} className="shrink-0" />
      <span className="shrink-0">Spoken language</span>
      <select className="ts-field min-w-0" style={{ flex: 1 }} value={value} disabled={disabled}
        onChange={(e) => onChange(e.target.value)} aria-label="Spoken language">
        {TRANSCRIBE_LANGUAGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}
