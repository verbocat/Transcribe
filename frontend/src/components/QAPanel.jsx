import React from 'react';
import {
  ShieldCheck, Download, Volume2, AlertCircle, AlertTriangle, CheckCircle2, FileText
} from 'lucide-react';

export default function QAPanel({
  complianceScore,
  totalErrors,
  totalWarnings,
  audioInfo,
  onOpenExport,
  segments
}) {
  const isPassing = complianceScore >= 98.0;

  // Collect unique error categories for clear summary
  const issueSummary = React.useMemo(() => {
    const issues = [];
    if (!segments) return issues;
    segments.forEach((seg) => {
      if (seg.qc_errors) {
        seg.qc_errors.forEach((err) => {
          issues.push({
            segmentId: seg.segment_id,
            speaker: seg.speaker,
            message: err.message,
            severity: err.severity,
            errorType: err.error_type
          });
        });
      }
    });
    return issues;
  }, [segments]);

  return (
    <div className="bg-[var(--kt-s1)] border border-[var(--kt-s4)] rounded-lg p-3.5 shadow-sm flex flex-col gap-3 sticky top-[180px]">
      {/* Compliance Scorecard */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[var(--kt-accent)]" />
            <h3 className="font-bold text-xs text-slate-200 uppercase tracking-wider">Compliance Score</h3>
          </div>
          <span className="text-[11px] font-semibold text-slate-500">Target: ≥ 98%</span>
        </div>

        {/* Score Progress Box */}
        <div className={`p-3 rounded-lg border transition-all ${
          isPassing
            ? 'bg-[var(--kt-s2)] border-emerald-500/40'
            : complianceScore >= 80
            ? 'bg-[var(--kt-s2)] border-amber-500/40'
            : 'bg-[var(--kt-s2)] border-rose-500/40'
        }`}>
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-baseline gap-2">
                <span className={`text-2xl font-black font-mono ${
                  isPassing ? 'text-emerald-400' : complianceScore >= 80 ? 'text-amber-400' : 'text-rose-400'
                }`}>
                  {complianceScore !== null ? `${complianceScore}%` : '--'}
                </span>
                <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                  isPassing
                    ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                    : complianceScore >= 80
                    ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                    : 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                }`}>
                  {isPassing ? 'PASSED (≥98%)' : 'NEEDS QA'}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-1 font-medium">
                {totalErrors} Errors • {totalWarnings} Warnings
              </p>
            </div>

            {isPassing ? (
              <div className="h-8 w-8 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center justify-center">
                <CheckCircle2 className="w-5 h-5" />
              </div>
            ) : (
              <div className="h-8 w-8 rounded bg-rose-500/15 text-rose-400 border border-rose-500/30 flex items-center justify-center">
                <AlertCircle className="w-5 h-5" />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* QC Issues Summary List */}
      {issueSummary.length > 0 && (
        <div className="bg-[var(--kt-s2)] p-2.5 rounded-lg border border-[var(--kt-s4)] space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
              Compliance Issues ({issueSummary.length})
            </span>
          </div>

          <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1 text-xs">
            {issueSummary.slice(0, 15).map((item, idx) => (
              <div
                key={idx}
                className={`p-2 rounded border flex items-start gap-2 ${
                  item.severity === 'error'
                    ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                    : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                }`}
              >
                <span className="font-mono font-bold text-[10px] bg-[var(--kt-s3)] px-1.5 py-0.5 rounded border border-[var(--kt-s5)] text-slate-300 shrink-0">
                  Seg #{item.segmentId}
                </span>
                <span className="text-[11px] font-medium leading-tight">{item.message}</span>
              </div>
            ))}
            {issueSummary.length > 15 && (
              <p className="text-[11px] text-slate-500 text-center font-medium">
                + {issueSummary.length - 15} more issues in segments
              </p>
            )}
          </div>
        </div>
      )}

      {/* Acoustic Audio Specs */}
      {audioInfo && (
        <div className="bg-[var(--kt-s2)] p-2.5 rounded-lg border border-[var(--kt-s4)]">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-200 mb-2">
            <Volume2 className="w-3.5 h-3.5 text-[var(--kt-accent)]" />
            Acoustic Analysis
          </div>
          <div className="grid grid-cols-3 gap-1.5 text-center text-xs">
            <div className="p-1.5 rounded bg-[var(--kt-s3)] border border-[var(--kt-s5)]">
              <span className="text-[10px] text-slate-400 block font-medium">Duration</span>
              <span className="font-mono font-bold text-slate-200">{audioInfo.duration}s</span>
            </div>
            <div className="p-1.5 rounded bg-[var(--kt-s3)] border border-[var(--kt-s5)]">
              <span className="text-[10px] text-slate-400 block font-medium">Volume</span>
              <span className="font-mono font-bold text-slate-200">{audioInfo.rms_db} dB</span>
            </div>
            <div className="p-1.5 rounded bg-[var(--kt-s3)] border border-[var(--kt-s5)]">
              <span className="text-[10px] text-slate-400 block font-medium">Noise (SNR)</span>
              <span className="font-mono font-bold text-slate-200">{audioInfo.snr_db} dB</span>
            </div>
          </div>
        </div>
      )}

      {/* Export Deliverables Button */}
      <button
        onClick={onOpenExport}
        className="w-full py-2.5 px-3 bg-[var(--kt-accent)] hover:bg-[var(--kt-accent-strong)] active:bg-[var(--kt-accent-2)] text-black font-bold rounded shadow-[0_0_12px_rgba(var(--kt-accent-rgb),0.25)] flex items-center justify-center gap-2 transition-transform active:scale-95 cursor-pointer text-xs"
      >
        <Download className="w-4 h-4" />
        Export Deliverables (CSV, DOCX, XLSX, SRT)
      </button>
    </div>
  );
}
