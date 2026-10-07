import React, { useEffect, useState } from 'react';
import { Square, Check } from 'lucide-react';
import { formatBytes, formatSpeed, formatEta } from '../../utils/xhrUpload';

/**
 * Slim progress strip shared by media preparation and subtitle generation: one 32px row and a 2px bar.
 *
 * Everything shown is measured, except where it says otherwise:
 *  - upload / download bytes, speed and ETA come from the network transfer itself
 *  - "extract" percent is FFmpeg's own processed-media-time divided by the file's duration
 *  - generation stages report their own work (batches proofread, words processed)
 *  - the speech-recognition wait is ONE long request, so it is an estimate from the audio length and this server's measured
 *    speed. It is marked "≈" and never reaches 100% before the result arrives.
 *  - a stage with nothing measurable shows a moving bar and no number
 */

const VIDEO_STEPS = [
  { key: 'upload', label: 'Uploading file', stages: ['upload'] },
  { key: 'extract', label: 'Extracting audio', stages: ['saving', 'extract', 'waveform'] },
  { key: 'download', label: 'Downloading audio', stages: ['download'] },
  { key: 'send', label: 'Uploading audio', stages: ['send'] },
  { key: 'prepare', label: 'Preparing workspace', stages: ['prepare'] },
];
const LOCAL_STEPS = [
  { key: 'local', label: 'Extracting audio', stages: ['engine', 'local'] },
  { key: 'send', label: 'Uploading audio', stages: ['send'] },
  { key: 'prepare', label: 'Preparing workspace', stages: ['prepare'] },
];
const AUDIO_STEPS = [
  { key: 'decode', label: 'Decoding audio', stages: ['decode'] },
  { key: 'send', label: 'Uploading audio', stages: ['send'] },
  { key: 'prepare', label: 'Preparing workspace', stages: ['prepare'] },
];
const SERVER_STAGES = ['upload', 'saving', 'extract', 'waveform', 'download'];

const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

function useElapsed() {
  const [startedAt] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setElapsed((Date.now() - startedAt) / 1000), 500);
    return () => clearInterval(id);
  }, [startedAt]);
  return elapsed;
}

/** The strip itself. `percent` null means "working, no measurable progress". */
export function ProgressStrip({ label, step, steps, detail, percent, estimated = false, meta, elapsed, onCancel }) {
  const determinate = typeof percent === 'number' && Number.isFinite(percent);
  const pct = determinate ? Math.max(0, Math.min(100, percent)) : 0;
  const shown = determinate ? (pct >= 99.5 ? '100' : pct < 10 ? pct.toFixed(1) : String(Math.round(pct))) : null;

  return (
    <div className="relative shrink-0 border-b border-[var(--ss-line)] bg-[var(--ss-panel)]" role="status" aria-live="polite">
      <div className="flex items-center gap-2.5 h-8 px-3 text-[12px] leading-none min-w-0">
        <span className="relative flex w-2 h-2 shrink-0" aria-hidden="true">
          <span className="absolute inset-0 rounded-full bg-[var(--ss-accent)] opacity-60 animate-ping" />
          <span className="relative w-2 h-2 rounded-full bg-[var(--ss-accent)]" />
        </span>
        <span className="font-medium text-[var(--ss-text)] whitespace-nowrap">{label}</span>
        {steps > 1 && <span className="text-[var(--ss-faint)] tabular-nums whitespace-nowrap">{step}/{steps}</span>}
        {detail && <span className="text-[var(--ss-muted)] truncate min-w-0">{detail}</span>}
        <span className="ml-auto flex items-center gap-3 shrink-0 tabular-nums text-[var(--ss-muted)]">
          {meta && <span className="hidden sm:inline whitespace-nowrap">{meta}</span>}
          {elapsed != null && <span className="hidden md:inline text-[var(--ss-faint)]">{mmss(elapsed)}</span>}
          {shown != null && (
            <span className="font-semibold min-w-[3ch] text-right text-[var(--ss-accent)]" title={estimated ? 'Estimated from the audio length and this server’s speed' : undefined}>
              {estimated ? '≈' : ''}{shown}%
            </span>
          )}
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              title="Stop this and keep what you had"
              className="inline-flex items-center gap-1 h-6 px-2 rounded-md border border-[var(--ss-line)] text-[11.5px] font-medium text-[var(--ss-text)] hover:bg-[var(--ss-hover)] cursor-pointer"
            >
              <Square size={10} className="shrink-0" /> Cancel
            </button>
          )}
        </span>
      </div>
      <div
        className="h-[2px] bg-[var(--ss-line)]/70 overflow-hidden"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={determinate ? Math.round(pct) : undefined}
      >
        {determinate
          ? <div className="h-full bg-[var(--ss-accent)] transition-[width] duration-500 ease-out" style={{ width: `${pct}%` }} />
          : <div className="h-full w-full ss-indeterminate" />}
      </div>
    </div>
  );
}

/** Media preparation (upload, extract, waveform). */
export default function MediaProgress({ status, fileName, onCancel }) {
  const elapsed = useElapsed();
  const { stage, percent, detail, loaded, total, speed, eta } = status;
  const flow = status.flow || (SERVER_STAGES.includes(stage) ? 'video' : 'audio');
  const steps = flow === 'local' ? LOCAL_STEPS : flow === 'video' ? VIDEO_STEPS : AUDIO_STEPS;
  const activeIdx = Math.max(0, steps.findIndex((s) => s.stages.includes(stage)));
  const hasBytes = Number.isFinite(loaded) && Number.isFinite(total) && total > 0;
  const meta = [hasBytes && `${formatBytes(loaded)} of ${formatBytes(total)}`, formatSpeed(speed), formatEta(eta)].filter(Boolean).join(' · ');

  return (
    <ProgressStrip
      label={steps[activeIdx]?.label || 'Preparing media'}
      step={activeIdx + 1}
      steps={steps.length}
      detail={detail || fileName}
      percent={typeof percent === 'number' && Number.isFinite(percent) ? percent : null}
      meta={meta}
      elapsed={elapsed}
      onCancel={onCancel}
    />
  );
}

/** Subtitle generation: values come straight from the server's stage events. */
export function GenerateProgress({ progress, elapsed, onCancel }) {
  const { percent, stage, step, steps, detail, estimated, eta } = progress;
  const etaText = eta != null && eta > 0 ? `about ${eta >= 60 ? `${Math.floor(eta / 60)}m ${String(eta % 60).padStart(2, '0')}s` : `${eta}s`} left` : '';
  return (
    <ProgressStrip
      label={stage || 'Generating subtitles'}
      step={step || 1}
      steps={steps || 1}
      detail={detail}
      percent={percent}
      estimated={estimated}
      meta={etaText}
      elapsed={elapsed}
      onCancel={onCancel}
    />
  );
}

/** Other running tasks (QC fix, sync, auto-fix, re-break...) and the short "cancelled" note that follows a stop. */
export function TaskStrip({ tasks, notice, onCancel }) {
  return (
    <>
      {tasks.map((t) => (
        <ProgressStrip key={t.id} label={t.label} step={1} steps={1} detail={t.detail} percent={null} onCancel={() => onCancel(t.id)} />
      ))}
      {notice && (
        <div role="status" aria-live="polite" className="shrink-0 flex items-center gap-2 h-7 px-3 text-[12px] border-b border-[var(--ss-line)] bg-[var(--ss-panel)] text-[var(--ss-muted)]">
          <Check size={12} className="shrink-0" /> {notice}
        </div>
      )}
    </>
  );
}
