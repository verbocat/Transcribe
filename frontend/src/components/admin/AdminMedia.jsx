import React, { useCallback, useEffect, useState } from 'react';
import { Search, Copy } from 'lucide-react';
import { useAuth } from '../../auth_views/AuthContext';
import { adminApi, ago, Panel, Empty, Pager, th, td, searchInput } from './adminUi';

const LIMIT = 50;

const dur = (s) => {
  if (!s) return '—';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.round(s % 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}:${String(sec).padStart(2, '0')}`;
};

/** Every uploaded video/audio file across all users, with duplicate detection. */
export default function AdminMedia({ refreshKey }) {
  const { token } = useAuth();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => { const t = setTimeout(() => setQuery(search.trim()), 300); return () => clearTimeout(t); }, [search]);
  useEffect(() => { setOffset(0); }, [query]);

  const load = useCallback(async () => {
    const p = new URLSearchParams({ limit: String(LIMIT), offset: String(offset) });
    if (query) p.set('query', query);
    try { setData(await adminApi(token, `/uploads?${p}`)); setError(''); } catch (e) { setError(e.message); }
  }, [token, query, offset]);
  useEffect(() => { load(); }, [load, refreshKey]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[17px] font-semibold text-[var(--kt-text)]">Media</h2>
        <p className="mt-1 text-[13px] text-[var(--kt-muted)]">Every file uploaded to the studios. Files uploaded more than once (same content) are flagged.</p>
      </div>

      <div className="relative w-full sm:w-80">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--kt-faint)]" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search file name or user email" className={searchInput} />
      </div>

      {error && <div className="rounded-xl border border-[var(--kt-danger)]/30 bg-[var(--kt-danger)]/10 px-4 py-3 text-[12px] text-[var(--kt-danger)]">{error}</div>}

      <Panel pad={false}>
        {!data ? <Empty>Loading…</Empty> : data.uploads.length === 0 ? <Empty>No uploads found.</Empty> : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-[var(--kt-s3)]">
                  <tr><th className={th}>File</th><th className={th}>Uploaded by</th><th className={th}>Length</th><th className={th}>Size</th><th className={th}>Video</th><th className={th}>Uploaded</th></tr>
                </thead>
                <tbody className="divide-y divide-[var(--kt-s3)]">
                  {data.uploads.map((a) => (
                    <tr key={a.id} className="hover:bg-[var(--kt-s2)]/60">
                      <td className={td}>
                        <div className="flex items-center gap-2">
                          <span className="font-medium max-w-[300px] truncate" title={a.filename}>{a.filename}</span>
                          {a.has_duplicates && (
                            <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-md bg-[var(--kt-warn)]/12 text-[var(--kt-warn)]" title={`Same file uploaded ${a.duplicate_count} more time(s)`}>
                              <Copy size={11} /> {a.duplicate_count + 1}×
                            </span>
                          )}
                        </div>
                      </td>
                      <td className={td}>
                        <div>{a.user_name}</div>
                        <div className="text-[12px] text-[var(--kt-muted)]">{a.user_email}</div>
                      </td>
                      <td className={`${td} tabular-nums`}>{dur(a.duration_seconds)}</td>
                      <td className={`${td} tabular-nums text-[var(--kt-muted)]`}>{a.file_size_mb >= 1024 ? `${(a.file_size_mb / 1024).toFixed(2)} GB` : `${a.file_size_mb} MB`}</td>
                      <td className={`${td} text-[var(--kt-muted)]`}>{a.video_resolution || 'Audio'}</td>
                      <td className={`${td} text-[var(--kt-muted)] whitespace-nowrap`} title={a.created_at || ''}>{ago(a.created_at)}</td>
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
