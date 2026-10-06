import React, { useMemo, useState, useEffect } from 'react';
import { X, GitCompare, Check } from 'lucide-react';

export default function DiffModal({ isOpen, onClose, originalSegments, currentSegments }) {
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setIsClosing(false);
      return;
    }
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleDismiss();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const handleDismiss = () => {
    if (isClosing) return;
    setIsClosing(true);
    setTimeout(() => {
      setIsClosing(false);
      onClose();
    }, 220);
  };

  const diffs = useMemo(() => {
    if (!originalSegments || !currentSegments) return [];

    const origMap = new Map();
    originalSegments.forEach(s => origMap.set(s.segment_id, s));

    const changes = [];

    currentSegments.forEach(curr => {
      const orig = origMap.get(curr.segment_id);
      if (!orig) {
        changes.push({
          type: 'added',
          segment_id: curr.segment_id,
          curr,
          desc: 'Newly added segment'
        });
      } else {
        const textChanged = (orig.transcript || '').trim() !== (curr.transcript || '').trim();
        const speakerChanged = orig.speaker !== curr.speaker;
        const timeChanged = Math.abs(orig.start_time - curr.start_time) > 0.01 || Math.abs(orig.end_time - curr.end_time) > 0.01;

        if (textChanged || speakerChanged || timeChanged) {
          changes.push({
            type: 'modified',
            segment_id: curr.segment_id,
            orig,
            curr,
            textChanged,
            speakerChanged,
            timeChanged
          });
        }
      }
    });

    return changes;
  }, [originalSegments, currentSegments]);

  if (!isOpen) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md transition-opacity duration-200 ${
        isClosing ? 'animate-mac-backdrop-exit pointer-events-none' : 'animate-in fade-in'
      }`}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleDismiss();
      }}
    >
      <div className={`bg-[var(--kt-s1)] border border-[var(--kt-s4)] rounded-2xl w-full max-w-3xl p-6 shadow-2xl flex flex-col max-h-[90vh] text-slate-200 custom-scrollbar ${
        isClosing ? 'animate-mac-squish-exit' : 'animate-mac-squish'
      }`}>
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-[var(--kt-s4)]">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-[var(--kt-accent)]/15 text-[var(--kt-accent)] border border-[var(--kt-accent)]/30 rounded-xl">
              <GitCompare className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white">Audit Diff View</h2>
                <span className="text-[11px] bg-[var(--kt-s2)] text-[var(--kt-accent)] border border-[var(--kt-s4)] px-2 py-0.5 rounded-full font-mono font-bold">
                  {diffs.length} changed segments
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Side-by-side comparison of initial AI output vs. current human annotations
              </p>
            </div>
          </div>
          <button
            onClick={handleDismiss}
            className="p-2 text-slate-400 hover:text-white rounded-xl bg-[var(--kt-s2)] hover:bg-[var(--kt-s3)] border border-[var(--kt-s4)] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Changes List */}
        <div className="flex-1 overflow-y-auto mt-4 pr-1 space-y-3 custom-scrollbar">
          {diffs.length === 0 ? (
            <div className="py-16 text-center text-slate-400 text-xs">
              <Check className="w-8 h-8 mx-auto text-[var(--kt-accent)] mb-2 opacity-80" />
              <p className="font-bold text-slate-200">No edits recorded yet</p>
              <p className="text-slate-400 mt-1">Current segments match the original AI transcription identically.</p>
            </div>
          ) : (
            diffs.map((diff) => (
              <div key={diff.segment_id} className="p-3.5 bg-[var(--kt-s2)] border border-[var(--kt-s4)] rounded-xl space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold font-mono text-slate-200">Segment #{diff.segment_id}</span>
                  <div className="flex items-center gap-1.5">
                    {diff.textChanged && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[var(--kt-s3)] text-[var(--kt-info)] border border-[var(--kt-info)]/40">Text Modified</span>}
                    {diff.speakerChanged && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-950/60 text-amber-300 border border-amber-500/40">Speaker Changed</span>}
                    {diff.timeChanged && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[var(--kt-accent)]/20 text-[var(--kt-accent)] border border-[var(--kt-accent)]/40">Timing Adjusted</span>}
                  </div>
                </div>

                {diff.orig && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    {/* Before (Original AI) */}
                    <div className="p-2.5 bg-rose-950/30 border border-rose-900/50 rounded-xl">
                      <div className="flex items-center justify-between text-[10px] font-bold text-rose-400 mb-1">
                        <span>ORIGINAL AI</span>
                        <span className="font-mono">{diff.orig.start_time.toFixed(2)}s → {diff.orig.end_time.toFixed(2)}s ({diff.orig.speaker})</span>
                      </div>
                      <p className="text-slate-300 text-xs leading-relaxed font-sans">{diff.orig.transcript || <span className="italic text-slate-500">(Empty)</span>}</p>
                    </div>

                    {/* After (Current Annotated) */}
                    <div className="p-2.5 bg-[var(--kt-accent)]/10 border border-[var(--kt-accent)]/30 rounded-xl">
                      <div className="flex items-center justify-between text-[10px] font-bold text-[var(--kt-accent)] mb-1">
                        <span>CURRENT ANNOTATED</span>
                        <span className="font-mono">{diff.curr.start_time.toFixed(2)}s → {diff.curr.end_time.toFixed(2)}s ({diff.curr.speaker})</span>
                      </div>
                      <p className="text-slate-100 text-xs leading-relaxed font-sans font-medium">{diff.curr.transcript || <span className="italic text-slate-500">(Empty)</span>}</p>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="mt-4 pt-3 border-t border-[var(--kt-s4)] flex justify-end">
          <button
            onClick={handleDismiss}
            className="px-4 py-2 bg-[var(--kt-accent)] hover:bg-[var(--kt-accent-strong)] text-black font-bold rounded-xl text-xs transition-all shadow-[0_0_12px_rgba(var(--kt-accent-rgb),0.25)] cursor-pointer"
          >
            Close Diff View
          </button>
        </div>
      </div>
    </div>
  );
}
