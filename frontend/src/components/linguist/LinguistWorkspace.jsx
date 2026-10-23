import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, FileText, RefreshCw } from 'lucide-react';
import { API_BASE } from '../../config';
import AccountMenuDropdown from '../AccountMenuDropdown';
import BrandLogo from '../BrandLogo';
import ReviewEditor from './ReviewEditor';
import '../noun.css';

const ago = (iso) => {
  if (!iso) return '';
  const t = new Date(iso + (String(iso).endsWith('Z') ? '' : 'Z')).getTime();
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return new Date(t).toLocaleDateString();
};

/** Everything a linguist account sees: the subtitle projects coordinators shared with them, and the review editor. */
export default function LinguistWorkspace({ user, onOpenLogoutModal }) {
  const [projects, setProjects] = useState(null);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState(() => {
    try { return new URLSearchParams(window.location.search).get('project'); } catch { return null; }
  });

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await fetch(`${API_BASE}/api/shares/with-me`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Could not load your projects');
      setProjects(data.projects || []);
    } catch (e) { setError(e.message); setProjects([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const open = (id) => { setOpenId(id); try { window.history.replaceState({}, '', id ? `/?project=${id}` : '/'); } catch { /* ignore */ } };
  const back = () => { open(null); load(); };

  if (openId) return <ReviewEditor projectId={openId} onBack={back} />;

  return (
    <div className="min-h-screen bg-[var(--kt-s0)] text-[var(--kt-text)]">
      <header className="flex items-center justify-between px-6 py-3 border-b border-[var(--kt-s3)] bg-[var(--kt-s1)]">
        <BrandLogo variant="wordmark" size={30} />
        <AccountMenuDropdown user={user} onOpenLogoutModal={onOpenLogoutModal} />
      </header>
      <main className="max-w-3xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-[26px] font-bold tracking-tight" style={{ fontFamily: "'Bricolage Grotesque', var(--kt-font-ui)" }}>Shared with me</h1>
            <p className="text-[13px] text-[var(--kt-muted)] mt-1">Subtitle projects coordinators have asked you to review.</p>
          </div>
          <button type="button" onClick={load} className="h-8 px-3 rounded-lg text-[13px] bg-[var(--kt-s2)] hover:bg-[var(--kt-s3)] cursor-pointer inline-flex items-center gap-1.5"><RefreshCw size={13} /> Refresh</button>
        </div>
        {error && <div className="mb-3 text-[13px] text-[var(--kt-danger)]">{error}</div>}
        {projects === null ? <Loader2 className="animate-spin text-[var(--kt-muted)]" /> : projects.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--kt-s4)] p-8 text-center text-[var(--kt-muted)] text-[14px]">
            Nothing has been shared with you yet. When a project coordinator shares subtitles with you, they appear here.
          </div>
        ) : (
          <ul className="divide-y divide-[var(--kt-s3)] rounded-xl border border-[var(--kt-s3)] bg-[var(--kt-s1)]">
            {projects.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => open(p.id)} className="w-full text-left flex items-center gap-3 px-4 py-3.5 hover:bg-[var(--kt-s2)] cursor-pointer">
                  <FileText size={18} className="text-[var(--kt-muted)] shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-medium truncate">{p.title}</div>
                    <div className="text-[12px] text-[var(--kt-muted)] truncate">{p.updated_by ? `Updated ${ago(p.updated_at)} by ${p.updated_by}` : `Shared ${ago(p.updated_at)} by ${p.owner?.name}`}</div>
                  </div>
                  <span className="nx-primary nx-brand-grad" style={{ height: 30 }}>Open</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
