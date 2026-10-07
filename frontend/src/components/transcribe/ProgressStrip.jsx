import React from 'react';
import { Check, Loader2, Square } from 'lucide-react';

const STEPS = ['Ingest', 'Upload', 'Speakers', 'Gender', 'Confidence', 'QC'];

export default function ProgressStrip({ stage, detail, percent, stepIndex, elapsedSeconds, onCancel }) {
  return (
    <div role="status" aria-live="polite" className="shrink-0 px-4 py-3" style={{ background: 'var(--ts-panel)', borderBottom: '1px solid var(--ts-line)' }}>
      <div className="flex items-center gap-3">
        <Loader2 size={15} className="animate-spin" style={{ color: 'var(--ts-accent)' }} />
        <span style={{ fontWeight: 600 }}>{stage}</span>
        <span className="truncate" style={{ color: 'var(--ts-muted)' }}>{detail}</span>
        <span className="flex-1" />
        <span className="ts-mono" style={{ color: 'var(--ts-muted)' }}>{elapsedSeconds.toFixed(0)}s</span>
        <span className="ts-mono" style={{ color: 'var(--ts-accent)', fontWeight: 600, minWidth: 40, textAlign: 'right' }}>{Math.round(percent)}%</span>
        {onCancel && (
          <button type="button" className="ts-btn ts-btn-sm" onClick={onCancel} title="Stop transcribing. Nothing is changed.">
            <Square size={11} /> Cancel
          </button>
        )}
      </div>
      <div className="ts-track mt-2.5"><div style={{ width: `${percent}%` }} /></div>
      <ol className="flex items-center gap-4 mt-2.5" style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 12 }}>
        {STEPS.map((label, i) => {
          const n = i + 1;
          const done = stepIndex > n;
          const current = stepIndex === n;
          return (
            <li key={label} className="flex items-center gap-1.5" style={{ color: done || current ? 'var(--ts-text)' : 'var(--ts-faint)' }}>
              <span
                style={{
                  width: 16, height: 16, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10,
                  background: done ? 'var(--ts-accent)' : 'transparent', color: done ? 'var(--ts-accent-ink)' : 'inherit',
                  border: `1px solid ${done || current ? 'var(--ts-accent)' : 'var(--ts-line)'}`,
                }}
              >
                {done ? <Check size={10} strokeWidth={3} /> : n}
              </span>
              {label}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
