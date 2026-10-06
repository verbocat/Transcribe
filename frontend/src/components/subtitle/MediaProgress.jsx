import React, { useEffect, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { formatBytes, formatSpeed, formatEta } from '../../utils/xhrUpload';

/**
 * Live media-preparation panel. Everything shown is measured:
 *  - bytes sent / received, speed and ETA come from the network transfer itself
 *  - "extract" percent is FFmpeg's own processed-media-time divided by the file's duration
 *  - stages with no measurable progress (saving, waveform, preparing) show an animated bar and no number
 */

const VIDEO_STEPS = [
  { key: 'upload', label: 'Upload file', stages: ['upload'] },
  { key: 'extract', label: 'Extract audio', stages: ['saving', 'extract', 'waveform'] },
  { key: 'download', label: 'Download audio', stages: ['download'] },
  { key: 'send', label: 'Upload audio', stages: ['send'] },
  { key: 'prepare', label: 'Prepare workspace', stages: ['prepare'] },
];
const AUDIO_STEPS = [
  { key: 'decode', label: 'Decode audio', stages: ['decode'] },
  { key: 'send', label: 'Upload audio', stages: ['send'] },
  { key: 'prepare', label: 'Prepare workspace', stages: ['prepare'] },
];
const SERVER_STAGES = ['upload', 'saving', 'extract', 'waveform', 'download'];

const mmss = (sec) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;

export default function MediaProgress({ status, fileName }) {
  const [startedAt] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  const { stage, percent, detail, loaded, total, speed, eta } = status;
  const flow = SERVER_STAGES.includes(stage) || status.flow === 'video' ? 'video' : 'audio';
  const steps = flow === 'video' ? VIDEO_STEPS : AUDIO_STEPS;
  const activeIdx = Math.max(0, steps.findIndex((s) => s.stages.includes(stage)));
  const determinate = typeof percent === 'number' && Number.isFinite(percent);
  const pct = determinate ? Math.max(0, Math.min(100, percent)) : 0;
  const hasBytes = Number.isFinite(loaded) && Number.isFinite(total) && total > 0;

  return (
    <div className="shrink-0 border-b border-[var(--ss-line)] bg-[var(--ss-panel)] px-4 py-3" role="status" aria-live="polite">
      <div className="flex items-center gap-3 mb-2.5">
        <Loader2 size={15} className="animate-spin text-[var(--ss-accent)] shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-[var(--ss-text)] truncate">
            Preparing {fileName ? <span className="font-normal text-[var(--ss-muted)]">{fileName}</span> : 'your media'}
          </div>
          <div className="text-[12px] text-[var(--ss-muted)] truncate">{detail}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[18px] leading-none font-semibold tabular-nums text-[var(--ss-accent)]">
            {determinate ? `${pct >= 99.5 ? 100 : pct.toFixed(pct < 10 ? 1 : 0)}%` : '…'}
          </div>
          <div className="text-[11px] text-[var(--ss-faint)] tabular-nums mt-0.5">Elapsed {mmss(elapsed)}</div>
        </div>
      </div>

      {/* the bar: real percentage when one can be measured, otherwise an honest "working" animation */}
      <div
        className="h-2 rounded-full bg-[var(--ss-raised)] overflow-hidden"
        role="progressbar"
        aria-label={steps[activeIdx]?.label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={determinate ? Math.round(pct) : undefined}
      >
        {determinate ? (
          <div className="h-full rounded-full bg-[var(--ss-accent)] transition-[width] duration-300 ease-out" style={{ width: `${pct}%` }} />
        ) : (
          <div className="h-full w-full ss-indeterminate" />
        )}
      </div>

      <div className="mt-2 flex items-center justify-between gap-3 text-[12px] text-[var(--ss-muted)] tabular-nums min-h-[18px]">
        <span className="truncate">
          {hasBytes && `${formatBytes(loaded)} of ${formatBytes(total)}`}
        </span>
        <span className="truncate text-right">
          {[formatSpeed(speed), formatEta(eta)].filter(Boolean).join(' · ')}
        </span>
      </div>

      <ol className="mt-2.5 flex items-center gap-1.5 overflow-x-auto" aria-label="Steps">
        {steps.map((step, i) => {
          const done = i < activeIdx;
          const active = i === activeIdx;
          return (
            <li key={step.key} className="flex items-center gap-1.5 shrink-0">
              <span
                className={`inline-flex items-center gap-1.5 h-6 px-2 rounded-full text-[11.5px] border ${
                  active
                    ? 'border-[var(--ss-accent)] text-[var(--ss-text)] bg-[var(--ss-accent)]/10'
                    : done
                      ? 'border-transparent text-[var(--ss-muted)]'
                      : 'border-transparent text-[var(--ss-faint)]'
                }`}
                aria-current={active ? 'step' : undefined}
              >
                <span className={`w-3.5 h-3.5 rounded-full inline-flex items-center justify-center text-[9px] font-bold ${done ? 'bg-emerald-500 text-black' : active ? 'bg-[var(--ss-accent)] text-[var(--ss-accent-ink)]' : 'bg-[var(--ss-line)] text-[var(--ss-muted)]'}`}>
                  {done ? <Check size={9} strokeWidth={3} /> : i + 1}
                </span>
                {step.label}
              </span>
              {i < steps.length - 1 && <span className="w-3 h-px bg-[var(--ss-line)]" aria-hidden="true" />}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
