import React, { useCallback, useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import { getApiBase } from '../config';

/** Remaining hours for the signed-in account: transcription and translation budgets. */
export function useUsage(enabled = true) {
  const [usage, setUsage] = useState(null);
  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${getApiBase()}/api/auth/me/usage`);
      if (res.ok) setUsage((await res.json()).usage);
    } catch { /* offline: keep the last numbers */ }
  }, []);
  useEffect(() => {
    if (!enabled) return undefined;
    refresh();
    window.addEventListener('lt-usage-refresh', refresh);
    window.addEventListener('lt-out-of-hours', refresh);
    const id = setInterval(refresh, 60000);
    return () => {
      window.removeEventListener('lt-usage-refresh', refresh);
      window.removeEventListener('lt-out-of-hours', refresh);
      clearInterval(id);
    };
  }, [enabled, refresh]);
  return usage;
}

export function formatHours(h) {
  if (h === null || h === undefined) return 'Unlimited';
  const total = Math.max(0, Math.round(h * 3600));
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  if (hh === 0 && mm === 0) return total > 0 ? `${total}s` : '0h';
  return hh > 0 ? `${hh}h ${String(mm).padStart(2, '0')}m` : `${mm}m`;
}

/** Compact header chip. Hidden when both budgets are unlimited. */
export default function UsageBadge({ className = '' }) {
  const usage = useUsage(true);
  if (!usage || (usage.transcribe.unlimited && usage.translate.unlimited)) return null;
  const low = (b) => !b.unlimited && b.remaining_hours <= 0.25;
  const tone = (b) => (b.unlimited ? 'text-slate-300' : b.remaining_hours <= 0 ? 'text-rose-400' : low(b) ? 'text-amber-400' : 'text-emerald-400');
  return (
    <div
      className={`hidden min-[1600px]:flex items-center gap-2 h-8 px-2.5 rounded-lg border border-[var(--kt-s4)] bg-[var(--kt-s1)] text-[11px] font-mono ${className}`}
      title="Hours left on your account"
      data-testid="usage-badge"
    >
      <Clock size={12} className="text-slate-400" />
      <span className="text-slate-400">Transcribe</span>
      <span className={`font-bold ${tone(usage.transcribe)}`}>{formatHours(usage.transcribe.remaining_hours)}</span>
      <span className="text-slate-600">·</span>
      <span className="text-slate-400">Translate</span>
      <span className={`font-bold ${tone(usage.translate)}`}>{formatHours(usage.translate.remaining_hours)}</span>
    </div>
  );
}
