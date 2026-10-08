import React, { useMemo } from 'react';
import { X, ShieldCheck, BadgeCheck, AlertCircle, AlertTriangle, CheckCircle2, Crosshair } from 'lucide-react';
import { Segmented, IconButton } from '../subtitle/ui/controls';
import { formatStamp } from './speakerUtils';
import '../qc/qc.css';

/** Karya rule findings for the transcript, one card per problem. */
function KaryaChecks({ segments, score, errors, warnings, onJump }) {
  const rows = useMemo(() => segments.flatMap((s) => (s.qc_errors || []).map((e, i) => ({ seg: s, err: e, key: `${s.segment_id}-${i}` }))), [segments]);
  const tone = score == null ? '' : score >= 98 ? 'qc-good' : score >= 80 ? 'qc-warn' : 'qc-bad';
  const verdict = score == null ? 'Not checked yet' : score >= 98 ? 'Passing' : score >= 80 ? 'Needs fixes' : 'Failing';
  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3">
      <div className="qc-score shrink-0">
        <span className={`qc-score-num ${tone}`}>{score != null ? `${score.toFixed(1)}%` : '–'}</span>
        <div className="min-w-0">
          <div className={`qc-score-label ${tone}`}>{verdict}</div>
          <div className="qc-score-sub">{errors} {errors === 1 ? 'error' : 'errors'}, {warnings} {warnings === 1 ? 'warning' : 'warnings'}. Target 98%</div>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3 pr-1" data-lenis-prevent>
        {rows.length === 0 ? (
          <div className="qc-score" style={{ justifyContent: 'center', textAlign: 'center' }}>
            <CheckCircle2 size={22} className="qc-good" /> <span>No rule problems in this transcript.</span>
          </div>
        ) : rows.map(({ seg, err, key }) => (
          <article key={key} className="qc-finding" data-sev={err.severity === 'error' ? 'error' : 'warning'}>
            <div className="qc-finding-meta">
              {err.severity === 'error' ? <AlertCircle size={16} className="qc-bad" /> : <AlertTriangle size={16} className="qc-warn" />}
              <span>Segment #{seg.segment_id}</span><span>{formatStamp(seg.start_time)}</span>{seg.speaker && <span>{seg.speaker}</span>}
            </div>
            <p className="qc-finding-msg">{err.message}</p>
            <div className="qc-finding-actions">
              <button type="button" className="qc-btn" onClick={() => onJump(seg)}><Crosshair size={16} /> Go to segment</button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

/** One QC view with two tabs, like Subtitle Studio's: Karya rules, and Centroid's check of a translation. */
export default function QcDrawer({ view, onView, centroidIssues, onClose, setHost, segments, score, errors, warnings, onJump }) {
  return (
    <aside
      aria-label="QC" className="qc-panel shrink-0 min-h-0 flex flex-col p-4 gap-3"
      style={{ width: 460, background: 'var(--ts-panel)', borderLeft: '1px solid var(--ts-line)' }}
    >
      <div className="shrink-0 flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <Segmented
            label="QC panel" value={view} onChange={onView}
            options={[
              { value: 'karya', label: 'Karya checks', icon: ShieldCheck },
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
