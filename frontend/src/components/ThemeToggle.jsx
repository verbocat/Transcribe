import React from 'react';
import { Palette } from 'lucide-react';
import { openAppearance } from '../theme/themeEngine';

/** Opens the Appearance dashboard. (The app is dark-only; colours, fonts and shape are all editable there.) */
export default function ThemeToggle({ className = '', showLabel = false }) {
  return (
    <button
      type="button"
      onClick={openAppearance}
      className={`inline-flex items-center justify-center gap-2 h-[30px] px-2.5 rounded-full border border-[var(--kt-s4)] bg-[var(--kt-s2)] text-[var(--kt-muted)] hover:text-[var(--kt-text)] hover:border-[var(--kt-accent)] transition-colors cursor-pointer select-none shrink-0 ${className}`}
      title="Appearance: customise colours, fonts and layout"
      aria-label="Open appearance settings"
    >
      <Palette size={14} style={{ color: 'var(--kt-accent)' }} />
      {showLabel && <span className="text-[11px] font-semibold">Appearance</span>}
    </button>
  );
}
