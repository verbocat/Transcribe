import React, { useCallback, useEffect, useState } from 'react';
import { Users, AudioLines, Languages, Layers, ArrowRight } from 'lucide-react';
import { useAuth } from '../../auth_views/AuthContext';
import { adminApi, hrs, ago, Panel, Stat, StatusPill, StudioTag, Empty } from './adminUi';

function Meter({ label, value, detail, pct }) {
  const tone = pct > 85 ? 'bg-[var(--kt-danger)]' : pct > 65 ? 'bg-[var(--kt-warn)]' : 'bg-[var(--kt-accent)]';
  return (
    <div>
      <div className="flex items-baseline justify-between text-[12px]">
        <span className="text-[var(--kt-muted)]">{label}</span>
        <span className="font-medium text-[var(--kt-text)] tabular-nums">{value}</span>
      </div>
      <div className="mt-2 h-1.5 rounded-full bg-[var(--kt-s3)] overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${tone}`} style={{ width: `${Math.min(100, pct || 0)}%` }} />
      </div>
      {detail && <div className="mt-1.5 text-[11px] text-[var(--kt-faint)] tabular-nums">{detail}</div>}
    </div>
  );
}

/**
 * Overview: real usage from the metered-job log (hours charged, jobs, who uses it most),
 * plus account counts and live server health from the existing /overview call.
 */
export default function AdminOverview({ overview, hardware, onOpenTab, refreshKey }) {
  const { token } = useAuth();
  const [usage, setUsage] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try { setUsage(await adminApi(token, '/usage-overview')); setError(''); } catch (e) { setError(e.message); }
  }, [token]);
  useEffect(() => { load(); }, [load, refreshKey]);

  const u = usage;
  const link = (tab, label) => (
    <button type="button" onClick={() => onOpenTab(tab)} className="inline-flex items-center gap-1 text-[12px] text-[var(--kt-muted)] hover:text-[var(--kt-text)] cursor-pointer">
      {label} <ArrowRight size={13} />
    </button>
  );

  return (
    <div className="space-y-5">
      {error && <div className="rounded-xl border border-[var(--kt-danger)]/30 bg-[var(--kt-danger)]/10 px-4 py-3 text-[12px] text-[var(--kt-danger)]">{error}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat
          label="Accounts" icon={Users}
          value={overview ? overview.users.total : '—'}
          sub={overview ? <span className="inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-[var(--kt-success)]" />{overview.users.active_now} signed in now</span> : null}
        />
        <Stat label="Transcription hours" icon={AudioLines} value={u ? hrs(u.hours.transcribe_total) : '—'} sub={u ? `${hrs(u.hours.transcribe_30d)} in the last 30 days` : null} />
        <Stat label="Translation hours" icon={Languages} value={u ? hrs(u.hours.translate_total) : '—'} sub={u ? `${hrs(u.hours.translate_30d)} in the last 30 days` : null} />
        <Stat
          label="Jobs" icon={Layers} value={u ? u.jobs.total : '—'}
          sub={u ? (u.jobs.running > 0 ? <span className="text-[var(--kt-accent)]">{u.jobs.running} running now · {u.jobs.last_24h} today</span> : `${u.jobs.last_24h} in the last 24 hours`) : null}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <Panel title="Recent jobs" action={link('jobs', 'All jobs')} className="lg:col-span-3" pad={false}>
          {!u ? <Empty>Loading…</Empty> : u.recent_jobs.length === 0 ? <Empty>No jobs yet. They appear here as soon as someone transcribes or translates.</Empty> : (
            <ul className="divide-y divide-[var(--kt-s3)] border-t border-[var(--kt-s3)]">
              {u.recent_jobs.map((j) => (
                <li key={j.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-[13px] text-[var(--kt-text)]">
                      <span className="truncate font-medium">{j.file || j.action}</span>
                      <StudioTag studio={j.studio} />
                    </div>
                    <div className="mt-0.5 text-[12px] text-[var(--kt-muted)] truncate">{j.file ? `${j.action} · ` : j.detail ? `${j.detail} · ` : ''}{j.user_name} · {ago(j.created_at)}</div>
                  </div>
                  <span className="text-[12px] text-[var(--kt-muted)] tabular-nums">{hrs(j.hours)}</span>
                  <StatusPill status={j.status} />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Top users · last 30 days" action={link('accounts', 'Manage hours')} className="lg:col-span-2" pad={false}>
          {!u ? <Empty>Loading…</Empty> : u.top_users.length === 0 ? <Empty>No usage in the last 30 days.</Empty> : (
            <ul className="divide-y divide-[var(--kt-s3)] border-t border-[var(--kt-s3)]">
              {u.top_users.map((r) => (
                <li key={r.user_id} className="flex items-center gap-3 px-5 py-3">
                  <span className="w-8 h-8 rounded-full bg-[var(--kt-s3)] text-[var(--kt-text)] text-[12px] font-semibold flex items-center justify-center shrink-0">
                    {(r.user_name || '?').trim().charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-[var(--kt-text)] truncate">{r.user_name}</div>
                    <div className="text-[12px] text-[var(--kt-muted)] truncate">{r.jobs} {r.jobs === 1 ? 'job' : 'jobs'}</div>
                  </div>
                  <div className="text-right text-[12px] tabular-nums">
                    <div className="text-[var(--kt-text)]">{hrs(r.transcribe_hours)} <span className="text-[var(--kt-faint)]">transcribe</span></div>
                    <div className="text-[var(--kt-muted)]">{hrs(r.translate_hours)} <span className="text-[var(--kt-faint)]">translate</span></div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <Panel title="Studio activity · last 30 days" className="lg:col-span-2">
          {u ? (() => {
            const t = u.jobs.transcribe_studio_30d, s = u.jobs.subtitle_studio_30d, all = Math.max(1, t + s);
            return (
              <div className="space-y-4">
                <Meter label="Transcribe Studio" value={`${t} ${t === 1 ? 'job' : 'jobs'}`} pct={(t / all) * 100} />
                <Meter label="Subtitle Studio" value={`${s} ${s === 1 ? 'job' : 'jobs'}`} pct={(s / all) * 100} />
                <div className="text-[11px] text-[var(--kt-faint)]">{u.jobs.refunded_30d} {u.jobs.refunded_30d === 1 ? 'job' : 'jobs'} refunded (failed or cancelled before the work started)</div>
              </div>
            );
          })() : <Empty>Loading…</Empty>}
        </Panel>

        <Panel title="Server" action={link('hardware', 'Details')} className="lg:col-span-3">
          {hardware ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
              <Meter label="CPU" value={`${hardware.cpu_percent}%`} pct={hardware.cpu_percent} />
              <Meter label="Memory" value={`${hardware.memory_percent}%`} pct={hardware.memory_percent}
                detail={`${(hardware.memory_used_mb / 1024).toFixed(1)} / ${(hardware.memory_total_mb / 1024).toFixed(1)} GB`} />
              <Meter label="Disk" value={`${hardware.disk_percent}%`} pct={hardware.disk_percent}
                detail={`${hardware.disk_used_gb} / ${hardware.disk_total_gb} GB · uploads ${hardware.upload_folder_mb} MB`} />
            </div>
          ) : <Empty>Server stats unavailable.</Empty>}
        </Panel>
      </div>
    </div>
  );
}
