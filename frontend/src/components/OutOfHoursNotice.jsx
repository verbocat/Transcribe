import React, { useEffect, useState } from 'react';
import { Clock, X } from 'lucide-react';
import { formatHours } from './UsageBadge';

/** Shown whenever the server answers "Out of hours" (HTTP 402), whichever tool made the request. */
export default function OutOfHoursNotice() {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    const onEvent = (e) => setInfo(e.detail || {});
    window.addEventListener('lt-out-of-hours', onEvent);
    return () => window.removeEventListener('lt-out-of-hours', onEvent);
  }, []);
  if (!info) return null;
  const what = info.kind === 'translate' ? 'translation' : 'transcription';
  return (
    <div className="fixed inset-0 z-[1000] bg-black/70 backdrop-blur-xs flex items-center justify-center p-4" role="alertdialog" aria-labelledby="oh-title">
      <div className="w-full max-w-md rounded-2xl border border-[var(--kt-s4)] bg-[var(--kt-s1)] text-slate-200 shadow-2xl p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-300"><Clock size={18} /></div>
            <h2 id="oh-title" className="text-base font-bold text-white">Out of hours</h2>
          </div>
          <button type="button" onClick={() => setInfo(null)} className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-[var(--kt-s3)] cursor-pointer" aria-label="Close"><X size={16} /></button>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-slate-300">
          This {what} needs <strong className="text-white">{formatHours(info.needed_hours)}</strong>, but your account has only{' '}
          <strong className="text-white">{formatHours(info.remaining_hours)}</strong> of {what} time left. Nothing was started and nothing was charged.
        </p>
        <p className="mt-2 text-xs text-slate-400">Ask your administrator to add hours to your account.</p>
        <div className="mt-4 flex justify-end">
          <button type="button" onClick={() => setInfo(null)} className="px-4 py-2 rounded-lg bg-[var(--kt-accent)] text-[var(--kt-accent-ink)] text-xs font-bold cursor-pointer">OK</button>
        </div>
      </div>
    </div>
  );
}
