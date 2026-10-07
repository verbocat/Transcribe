import React from 'react';

const STEPS = 3; // upload, transcribe, finish

const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

/**
 * Slim one-row progress strip, same as Subtitle Studio's. Upload bytes are measured; the server wait is an
 * estimate and is marked with "≈". A null percent shows a moving bar with no number.
 */
export default function ProgressStrip({ stage, detail, percent, estimated, meta, stepIndex, elapsedSeconds }) {
  const determinate = typeof percent === 'number' && Number.isFinite(percent);
  const pct = determinate ? Math.max(0, Math.min(100, percent)) : 0;
  const shown = determinate ? (pct >= 99.5 ? '100' : pct < 10 ? pct.toFixed(1) : String(Math.round(pct))) : null;

  return (
    <div role="status" aria-live="polite" className="relative shrink-0" style={{ background: 'var(--ts-panel)', borderBottom: '1px solid var(--ts-line)' }}>
      <div className="flex items-center gap-2.5 px-3 min-w-0" style={{ height: 32, fontSize: 12, lineHeight: 1 }}>
        <span className="relative flex shrink-0" style={{ width: 8, height: 8 }} aria-hidden="true">
          <span className="absolute inset-0 rounded-full animate-ping" style={{ background: 'var(--ts-accent)', opacity: 0.6 }} />
          <span className="relative rounded-full" style={{ width: 8, height: 8, background: 'var(--ts-accent)' }} />
        </span>
        <span style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>{stage}</span>
        <span className="ts-mono" style={{ color: 'var(--ts-faint)', whiteSpace: 'nowrap' }}>{stepIndex}/{STEPS}</span>
        {detail && <span className="truncate min-w-0" style={{ color: 'var(--ts-muted)' }}>{detail}</span>}
        <span className="flex-1" />
        {meta && <span className="ts-mono hidden sm:inline" style={{ color: 'var(--ts-muted)', whiteSpace: 'nowrap' }}>{meta}</span>}
        <span className="ts-mono hidden md:inline" style={{ color: 'var(--ts-faint)' }}>{mmss(elapsedSeconds)}</span>
        {shown != null && (
          <span
            className="ts-mono" style={{ color: 'var(--ts-accent)', fontWeight: 600, minWidth: '3ch', textAlign: 'right' }}
            title={estimated ? 'Estimated from the audio length and this server’s speed' : undefined}
          >
            {estimated ? '≈' : ''}{shown}%
          </span>
        )}
      </div>
      <div
        role="progressbar" aria-label={stage} aria-valuemin={0} aria-valuemax={100} aria-valuenow={determinate ? Math.round(pct) : undefined}
        style={{ height: 2, background: 'var(--ts-line)', overflow: 'hidden' }}
      >
        {determinate
          ? <div style={{ height: '100%', width: `${pct}%`, background: 'var(--ts-accent)', transition: 'width 0.5s ease-out' }} />
          : <div className="ts-indeterminate" style={{ height: '100%', width: '100%' }} />}
      </div>
    </div>
  );
}
