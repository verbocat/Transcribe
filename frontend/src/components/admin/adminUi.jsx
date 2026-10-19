import React from 'react';
import { API_BASE } from '../../config';

/** Shared bits for the admin tabs: API helper, formatting and a few small, flat building blocks. */

export const adminApi = async (token, path) => {
  const res = await fetch(`${API_BASE}/api/admin${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : `Request failed (${res.status})`);
  return data;
};

export function hrs(h) {
  if (h == null) return '—';
  if (h === 0) return '0h';
  if (h < 1 / 60) return `${Math.max(1, Math.round(h * 3600))}s`;
  if (h < 1) return `${Math.round(h * 60)}m`;
  return h >= 100 ? `${Math.round(h)}h` : `${h.toFixed(1).replace(/\.0$/, '')}h`;
}

/** Minutes only: "55 min", "1,250 min", "40s" for under a minute. */
export function mins(h) {
  if (h == null) return '—';
  const total = Math.max(0, Math.round(h * 3600));
  if (total > 0 && total < 60) return `${total}s`;
  return `${Math.round(total / 60).toLocaleString('en-US')} min`;
}

/** Exact duration from milliseconds (or hours): "1h 02m 05s", "3m 12s", "45s". */
export function exact(ms, { fromHours = false } = {}) {
  if (ms == null) return '—';
  const total = Math.max(0, Math.round((fromHours ? ms * 3600000 : ms) / 1000));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  if (h) return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
  if (m) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

export function ago(iso) {
  if (!iso) return '—';
  const t = new Date(iso.endsWith('Z') || /[+-]\d\d:\d\d$/.test(iso) ? iso : `${iso}Z`).getTime();
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function Panel({ title, action, children, className = '', pad = true }) {
  return (
    <section className={`rounded-2xl border border-[var(--kt-s3)] bg-[var(--kt-s1)] ${className}`}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 px-5 pt-4 pb-3">
          {title && <h3 className="text-[13px] font-semibold text-[var(--kt-text)]">{title}</h3>}
          {action}
        </header>
      )}
      <div className={pad ? 'px-5 pb-5' : ''}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub, icon: Icon }) {
  return (
    <div className="rounded-2xl border border-[var(--kt-s3)] bg-[var(--kt-s1)] p-5">
      <div className="flex items-center justify-between text-[12px] text-[var(--kt-muted)]">
        <span>{label}</span>
        {Icon && <Icon size={15} strokeWidth={1.75} className="text-[var(--kt-faint)]" />}
      </div>
      <div className="mt-3 text-[28px] leading-none font-semibold tracking-tight text-[var(--kt-text)] tabular-nums">{value}</div>
      {sub && <div className="mt-2 text-[12px] text-[var(--kt-muted)]">{sub}</div>}
    </div>
  );
}

const PILL = {
  charged: 'text-[var(--kt-success)] bg-[var(--kt-success)]/12',
  running: 'text-[var(--kt-accent)] bg-[var(--kt-accent)]/12',
  refunded: 'text-[var(--kt-muted)] bg-[var(--kt-s3)]',
};
export function StatusPill({ status }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium ${PILL[status] || PILL.refunded}`}>
      {status === 'running' && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />}
      {status ? status[0].toUpperCase() + status.slice(1) : '—'}
    </span>
  );
}

export function StudioTag({ studio }) {
  const label = studio === 'transcribe' ? 'Transcribe' : studio === 'subtitle' ? 'Subtitle' : 'Other';
  return <span className="text-[11px] px-1.5 py-0.5 rounded-md border border-[var(--kt-s4)] text-[var(--kt-muted)]">{label}</span>;
}

export function Segmented({ value, onChange, options }) {
  return (
    <div className="inline-flex p-0.5 rounded-lg bg-[var(--kt-s2)] border border-[var(--kt-s3)]">
      {options.map(([v, label]) => (
        <button
          key={v} type="button" onClick={() => onChange(v)}
          className={`px-2.5 py-1 rounded-md text-[12px] font-medium cursor-pointer transition-colors ${
            value === v ? 'bg-[var(--kt-s4)] text-[var(--kt-text)]' : 'text-[var(--kt-muted)] hover:text-[var(--kt-text)]'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ children }) {
  return <div className="py-10 text-center text-[12px] text-[var(--kt-muted)]">{children}</div>;
}

export function Pager({ offset, limit, total, onPage }) {
  if (total <= limit) return null;
  const btn = 'px-2.5 py-1 rounded-md border border-[var(--kt-s4)] text-[12px] text-[var(--kt-muted)] hover:text-[var(--kt-text)] hover:bg-[var(--kt-s2)] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer';
  return (
    <div className="flex items-center justify-between px-5 py-3 border-t border-[var(--kt-s3)] text-[12px] text-[var(--kt-muted)]">
      <span>{offset + 1}–{Math.min(offset + limit, total)} of {total}</span>
      <div className="flex gap-1.5">
        <button type="button" className={btn} disabled={offset === 0} onClick={() => onPage(Math.max(0, offset - limit))}>Previous</button>
        <button type="button" className={btn} disabled={offset + limit >= total} onClick={() => onPage(offset + limit)}>Next</button>
      </div>
    </div>
  );
}

export const th = 'px-5 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-[var(--kt-faint)]';
export const td = 'px-5 py-3 text-[12.5px] text-[var(--kt-text)]';
export const searchInput = 'w-full pl-9 pr-3 py-2 rounded-lg border border-[var(--kt-s3)] bg-[var(--kt-s1)] text-[13px] text-[var(--kt-text)] placeholder:text-[var(--kt-faint)] focus:outline-none focus:border-[var(--kt-accent)]';
