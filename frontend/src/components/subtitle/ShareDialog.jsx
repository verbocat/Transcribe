import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { X, Loader2, Share2, Download, Trash2, Users } from 'lucide-react';
import { API_BASE } from '../../config';

// Coordinator-only: share the subtitles on screen with linguist accounts so they can review and edit them.
// The server keeps one copy per shared project; saving here replaces it, "Load" brings the linguists' edits back.

const idKey = (name) => `lt_shared_project_${name || 'untitled'}`;

async function call(path, options) {
  const res = await fetch(`${API_BASE}/api/shares${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options && options.headers) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Something went wrong');
  return data;
}

export default function ShareDialog({ filename, videoId, getDraft, onLoadVersion, onClose }) {
  const [linguists, setLinguists] = useState([]);
  const [project, setProject] = useState(null);
  const [picked, setPicked] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [title, setTitle] = useState((filename || 'Untitled project').replace(/\.[^.]+$/, ''));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [l, mine] = await Promise.all([call('/linguists'), call('/projects/mine')]);
      setLinguists(l.linguists || []);
      let remembered = null;
      try { remembered = localStorage.getItem(idKey(filename)); } catch { /* private mode */ }
      const found = (mine.projects || []).find((p) => p.id === remembered) || (mine.projects || []).find((p) => p.filename && p.filename === filename);
      setProject(found || null);
      if (found) { setPicked(new Set(found.linguists.map((x) => x.id))); setTitle(found.title); }
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [filename]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toggle = (id) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const editedByOthers = project && !project.updated_by_owner;

  const run = async (fn) => {
    setBusy(true); setError(''); setNote('');
    try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const publish = () => run(async () => {
    if (editedByOthers && !window.confirm(`${project.updated_by} edited the shared copy. Sharing again replaces their edits with what is on your screen. Load their version first if you want to keep it. Continue?`)) return;
    const draft = getDraft();
    if (!draft || !Array.isArray(draft.events) || draft.events.length === 0) throw new Error('There are no subtitles to share yet.');
    const data = await call('/projects', {
      method: 'POST',
      body: JSON.stringify({ id: project?.id, title: title.trim() || filename || 'Untitled project', filename, video_id: videoId || null, draft, linguist_ids: [...picked] }),
    });
    setProject(data.project);
    try { localStorage.setItem(idKey(filename), data.project.id); } catch { /* private mode */ }
    setNote(picked.size ? `Shared with ${picked.size} linguist${picked.size === 1 ? '' : 's'}. They see it under "Shared with me".` : 'Saved. Pick linguists to let them open it.');
  });

  const loadTheirs = () => run(async () => {
    const data = await call(`/projects/${project.id}`);
    onLoadVersion(data.draft);
    setNote(`Loaded ${data.project.updated_by || 'the shared'} version (revision ${data.project.revision}) into the editor.`);
  });

  const stop = () => run(async () => {
    if (!window.confirm('Stop sharing? Linguists lose access immediately and the shared copy is deleted. Your own work here stays.')) return;
    await call(`/projects/${project.id}`, { method: 'DELETE' });
    try { localStorage.removeItem(idKey(filename)); } catch { /* ignore */ }
    setProject(null); setPicked(new Set()); setNote('Sharing stopped.');
  });

  const when = useMemo(() => (project?.updated_at ? new Date(project.updated_at + (project.updated_at.endsWith('Z') ? '' : 'Z')).toLocaleString() : ''), [project]);
  const field = 'w-full h-9 rounded-lg border border-[var(--ss-line)] bg-[var(--ss-bg)] px-3 text-[13px] text-slate-100 focus:outline-none focus:border-[var(--ss-accent)]';

  return (
    <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Share with linguist" className="w-full max-w-lg max-h-[90vh] flex flex-col rounded-xl border border-[var(--ss-line)] bg-[var(--ss-raised)] text-slate-200 shadow-2xl">
        <header className="flex items-center justify-between px-5 py-4 border-b border-[var(--ss-line)]">
          <h3 className="flex items-center gap-2 text-sm font-bold text-white"><Share2 size={15} /> Share with linguist</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 rounded text-slate-400 hover:text-white cursor-pointer"><X size={16} /></button>
        </header>

        <div className="p-5 space-y-4 overflow-y-auto text-xs">
          {loading ? <div className="py-8 text-center"><Loader2 className="animate-spin inline" size={18} /></div> : (
            <>
              <p className="text-slate-400">Linguists open the subtitles in a review editor with the video, fix text and timing, and save back to the same project. They cannot upload, generate or translate, and they use none of your hours.</p>
              <div>
                <label className="block font-semibold mb-1">Project name</label>
                <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} className={field} />
              </div>
              <div>
                <label className="flex items-center gap-1.5 font-semibold mb-1"><Users size={13} /> Linguists who can open it</label>
                {linguists.length === 0 ? (
                  <p className="text-slate-400">There are no linguist accounts yet. Ask your administrator to create them.</p>
                ) : (
                  <div className="max-h-44 overflow-y-auto rounded-lg border border-[var(--ss-line)] divide-y divide-[var(--ss-line)]">
                    {linguists.map((l) => (
                      <label key={l.id} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-[var(--ss-hover)]">
                        <input type="checkbox" checked={picked.has(l.id)} onChange={() => toggle(l.id)} />
                        <span className="font-medium text-slate-100">{l.name}</span>
                        <span className="text-slate-500 truncate">{l.email}</span>
                      </label>
                    ))}
                  </div>
                )}
                {project && <p className="mt-1 text-slate-500">Untick a person and press the button to revoke their access.</p>}
              </div>
              {project && (
                <div className="rounded-lg border border-[var(--ss-line)] p-3 space-y-1">
                  <div>Shared copy: revision <strong>{project.revision}</strong>{when ? `, saved ${when}` : ''}{project.updated_by ? ` by ${project.updated_by_owner ? 'you' : project.updated_by}` : ''}.</div>
                  {editedByOthers && <div className="text-amber-300">{project.updated_by} has edited it. Load their version before sharing again, or their changes are replaced.</div>}
                  {!project.has_video && <div className="text-slate-500">No video is attached, so linguists see the subtitles without picture.</div>}
                </div>
              )}
              {error && <div className="text-rose-400">{error}</div>}
              {note && <div className="text-emerald-400">{note}</div>}
            </>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 px-5 py-4 border-t border-[var(--ss-line)]">
          <div className="flex gap-2">
            {project && <button type="button" disabled={busy} onClick={loadTheirs} className="px-3 py-2 rounded-lg bg-[var(--ss-hover)] hover:bg-[var(--ss-line)] flex items-center gap-1.5 cursor-pointer disabled:opacity-50"><Download size={13} /> Load shared version</button>}
            {project && <button type="button" disabled={busy} onClick={stop} className="px-3 py-2 rounded-lg text-rose-300 hover:bg-rose-950/40 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"><Trash2 size={13} /> Stop sharing</button>}
          </div>
          <button type="button" disabled={busy || loading} onClick={publish} className="px-4 py-2 rounded-lg font-bold bg-[var(--ss-accent)] hover:bg-[var(--ss-accent-hover)] text-black cursor-pointer disabled:opacity-50 flex items-center gap-1.5">
            {busy && <Loader2 size={13} className="animate-spin" />} {project ? 'Update shared copy' : 'Share'}
          </button>
        </footer>
      </div>
    </div>
  );
}
