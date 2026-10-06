import React from 'react';
import { Languages } from 'lucide-react';
import { langName } from './languages';

/**
 * Language switcher shown once a translation exists. Each language is its own subtitle track:
 * picking one loads that language's subtitles into the list, the timeline and the video overlay.
 * Edits are kept per language when you switch.
 *
 * tracks: { [code]: events[] }   active: code   source: code of the original-language track
 */
export default function LanguageTracks({ tracks, active, source, onSwitch }) {
  const codes = Object.keys(tracks);
  if (codes.length < 2) return null;

  // original language first, then the translations in the order they were created
  const ordered = [source, ...codes.filter((c) => c !== source)].filter((c) => tracks[c]);

  return (
    <div className="shrink-0 flex items-center gap-2 px-3 h-10 border-b border-[var(--ss-line)] bg-[var(--ss-panel)] select-none overflow-x-auto" data-lenis-prevent>
      <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--ss-muted)] shrink-0">
        <Languages size={13} className="text-[var(--ss-accent)]" />
        Language
      </span>
      <div role="radiogroup" aria-label="Subtitle language" className="flex items-center gap-1">
        {ordered.map((code) => {
          const on = code === active;
          const count = (on ? null : tracks[code]?.length);
          return (
            <button
              key={code}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onSwitch(code)}
              title={code === source ? `${langName(code)} (original)` : `Edit the ${langName(code)} translation`}
              className={`h-7 px-2.5 rounded-lg inline-flex items-center gap-1.5 text-[12px] font-medium whitespace-nowrap border cursor-pointer transition-colors ${
                on
                  ? 'bg-[var(--ss-accent)] border-[var(--ss-accent)] text-[var(--ss-accent-ink)]'
                  : 'bg-[var(--ss-raised)] border-[var(--ss-line)] text-[var(--ss-muted)] hover:text-[var(--ss-text)] hover:bg-[var(--ss-hover)]'
              }`}
            >
              {langName(code)}
              {code === source && <span className={`text-[10px] ${on ? 'opacity-80' : 'text-[var(--ss-faint)]'}`}>original</span>}
              {count != null && <span className="text-[10px] tabular-nums text-[var(--ss-faint)]">{count}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
