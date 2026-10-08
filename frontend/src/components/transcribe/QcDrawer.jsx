import React, { useMemo } from 'react';
import { X, ShieldCheck, BadgeCheck, AlertCircle, AlertTriangle, Crosshair } from 'lucide-react';
import { Segmented, IconButton } from '../subtitle/ui/controls';
import { formatStamp } from './speakerUtils';

/** Rule findings for the transcript, one row per problem. */
function KaryaChecks({ segments, score, errors, warnings, onJump }) {
  const rows = useMemo(() => segments.flatMap((s) => (s.qc_errors || []).map((e, i) => ({ seg: s, err: e, key: `${s.segment_id}-${i}` }))), [segments]);
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="shrink-0 flex items-center gap-3 pb-3" style={{ fontSize: 12 }}>
        <span className="ts-mono" style={{ fontSize: 22, fontWeight: 600, color: errors ? 'var(--ts-danger)' : 'var(--ts-accent)' }}>{score != null ? `${score.toFixed(1)}%` : '–'}</span>
        <span style={{ color: 'var(--ts-muted)' }}>compliance</span>
        <span className="flex-1" />
        <span className="ts-chip ts-chip-danger">{errors} errors</span>
        <span className="ts-chip ts-chip-warn">{warnings} warnings</span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto" data-lenis-prevent>
        {rows.length === 0 ? (
          <p style={{ color: 'var(--ts-muted)', padding: 24, textAlign: 'center' }}>No rule problems in this transcript.</p>
        ) : rows.map(({ seg, err, key }) => (
          <button
            key={key} type="button" onClick={() => onJump(seg)}
            className="w-full text-left flex items-start gap-2 px-2 py-2 rounded-lg hover:bg-[var(--ts-hover)] cursor-pointer"
            style={{ background: 'transparent', border: 0 }}
          >
            {err.severity === 'error' ? <AlertCircle size={14} style={{ color: 'var(--ts-danger)', marginTop: 2 }} /> : <AlertTriangle size={14} style={{ color: 'var(--ts-warn)', marginTop: 2 }} />}
            <span className="min-w-0 flex-1">
              <span className="block" style={{ lineHeight: 1.4 }}>{err.message}</span>
              <span className="ts-mono block" style={{ color: 'var(--ts-faint)', fontSize: 11.5 }}>#{seg.segment_id} · {formatStamp(seg.start_time)} · {seg.speaker}</span>
            </span>
            <Crosshair size={13} style={{ color: 'var(--ts-faint)', marginTop: 3 }} />
          </button>
        ))}
      </div>
    </div>
  );
}

/** One QC view with two tabs, like Subtitle Studio's: rule checks, and Centroid's check of a translation. */
export default function QcDrawer({ view, onView, centroidIssues, onClose, setHost, segments, score, errors, warnings, onJump }) {
  return (
    <aside
      aria-label="QC" className="shrink-0 min-h-0 flex flex-col p-4"
      style={{ width: 420, background: 'var(--ts-panel)', borderLeft: '1px solid var(--ts-line)' }}
    >
      <div className="shrink-0 flex items-center gap-2 pb-3">
        <div className="flex-1 min-w-0">
          <Segmented
            label="QC panel" value={view} onChange={onView}
            options={[
              { value: 'karya', label: 'Rule checks', icon: ShieldCheck },
              { value: 'centroid', label: centroidIssues != null ? `Centroid QC · ${centroidIssues}` : 'Centroid QC', icon: BadgeCheck },
            ]}
          />
        </div>
        <IconButton icon={X} label="Close QC" onClick={onClose} />
      </div>
      {view === 'centroid' && <div ref={setHost} className="flex-1 min-h-0 flex flex-col" />}
      {view === 'karya' && <KaryaChecks segments={segments} score={score} errors={errors} warnings={warnings} onJump={onJump} />}
    </aside>
  );
}
