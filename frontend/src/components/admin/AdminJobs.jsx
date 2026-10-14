import React, { useCallback, useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { useAuth } from '../../auth_views/AuthContext';
import { adminApi, hrs, ago, Panel, StatusPill, StudioTag, Segmented, Empty, Pager, th, td, searchInput } from './adminUi';

const LIMIT = 50;

/** Every metered job (transcription, subtitle generation, re-sync, translation) with filters. */
export default function AdminJobs({ refreshKey }) {
  const { token } = useAuth();
  const [studio, setStudio] = useState('');
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => { const t = setTimeout(() => setQuery(search.trim()), 300); return () => clearTimeout(t); }, [search]);
  useEffect(() => { setOffset(0); }, [studio, kind, status, query]);

  const load = useCallback(async () => {
    const p = new URLSearchParams({ limit: String(LIMIT), offset: String(offset) });
    if (studio) p.set('studio', studio);
    if (kind) p.set('kind', kind);
    if (status) p.set('status_filter', status);
    if (query) p.set('query', query);
    try { setData(await adminApi(token, `/jobs?${p}`)); setError(''); } catch (e) { setError(e.message); }
  }, [token, studio, kind, status, query, offset]);
  useEffect(() => { load(); }, [load, refreshKey]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[17px] font-semibold text-[var(--kt-text)]">Jobs</h2>
        <p className="mt-1 text-[13px] text-[var(--kt-muted)]">Every transcription and translation run, who started it and whether its hours were charged.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--kt-faint)]" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search user or file" className={searchInput} />
        </div>
        <Segmented value={studio} onChange={setStudio} options={[['', 'All studios'], ['transcribe', 'Transcribe'], ['subtitle', 'Subtitle']]} />
        <Segmented value={kind} onChange={setKind} options={[['', 'All types'], ['transcribe', 'Transcription'], ['translate', 'Translation']]} />
        <Segmented value={status} onChange={setStatus} options={[['', 'Any status'], ['running', 'Running'], ['charged', 'Charged'], ['refunded', 'Refunded']]} />
      </div>

      {error && <div className="rounded-xl border border-[var(--kt-danger)]/30 bg-[var(--kt-danger)]/10 px-4 py-3 text-[12px] text-[var(--kt-danger)]">{error}</div>}

      <Panel pad={false}>
        {!data ? <Empty>Loading…</Empty> : data.jobs.length === 0 ? <Empty>No jobs match these filters.</Empty> : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-[var(--kt-s3)]">
                  <tr><th className={th}>File</th><th className={th}>User</th><th className={th}>Studio</th><th className={th}>Length</th><th className={th}>Status</th><th className={th}>Started</th></tr>
                </thead>
                <tbody className="divide-y divide-[var(--kt-s3)]">
                  {data.jobs.map((j) => (
                    <tr key={j.id} className="hover:bg-[var(--kt-s2)]/60">
                      <td className={td}>
                        <div className="font-medium max-w-[280px] truncate" title={j.file || ''}>{j.file || j.action}</div>
                        <div className="text-[12px] text-[var(--kt-muted)]">{j.file ? j.action : j.detail || ''}</div>
                      </td>
                      <td className={td}>
                        <div>{j.user_name}</div>
                        <div className="text-[12px] text-[var(--kt-muted)]">{j.user_email || ''}</div>
                      </td>
                      <td className={td}><StudioTag studio={j.studio} /></td>
                      <td className={`${td} tabular-nums`}>{hrs(j.hours)}</td>
                      <td className={td}><StatusPill status={j.status} /></td>
                      <td className={`${td} text-[var(--kt-muted)] whitespace-nowrap`} title={j.created_at || ''}>
                        {ago(j.created_at)}
                        {j.seconds_taken != null && <div className="text-[11px] text-[var(--kt-faint)]">took {j.seconds_taken < 90 ? `${Math.round(j.seconds_taken)}s` : `${Math.round(j.seconds_taken / 60)}m`}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager offset={offset} limit={LIMIT} total={data.total} onPage={setOffset} />
          </>
        )}
      </Panel>
    </div>
  );
}
