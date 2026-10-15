import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, UploadCloud, Loader2, FileVideo, FileAudio, X, Zap, FolderOpen, Trash2 } from 'lucide-react';
import BrandLogo from '../BrandLogo';
import AccountMenuDropdown from '../AccountMenuDropdown';
import { xhrPostForm, formatBytes, formatSpeed, formatEta } from '../../utils/xhrUpload';
import { takeLaunchIntent } from '../../utils/launchIntent';
import { api, call, send, GRAD, MEDIA_RE, VIDEO_RE } from './dubApi';
import ProjectEditor from './ProjectEditor';
import QuickDub from './QuickDub';

function timeAgo(t) {
  const s = Math.max(0, Date.now() / 1000 - (t || 0));
  return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 86400)} d ago`;
}

export default function DubbingStudio({ onBackToHome, user, onOpenLogoutModal }) {
  const [view, setView] = useState('home'); // home | project | quick
  const [projectId, setProjectId] = useState(null);
  const [projects, setProjects] = useState([]);
  const [file, setFile] = useState(null);
  const [sourceLang, setSourceLang] = useState('Auto-Detect');
  const [upload, setUpload] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);

  const load = useCallback(() => call('/projects').then((d) => setProjects(d.projects || [])).catch(() => {}), []);
  useEffect(() => { load(); }, [load, view]);
  useEffect(() => { const intent = takeLaunchIntent('dubbing'); if (intent?.file) setFile(intent.file); }, []);

  const accept = (f) => {
    if (!f) return;
    if (!MEDIA_RE.test(f.name || '') && !/^(audio|video)\//.test(f.type || '')) { setError('That file type is not supported. Try MP3, WAV, M4A, MP4, MKV or MOV.'); return; }
    setError(''); setFile(f);
  };
  const create = async () => {
    setError(''); setBusy(true); setUpload({ percent: 0 });
    const fd = new FormData(); fd.append('file', file); fd.append('source_language', sourceLang);
    try {
      const res = await xhrPostForm(api('/projects'), fd, { onProgress: setUpload });
      if (!res.ok) {
        if (res.status === 402) return;
        throw new Error(typeof res.data?.detail === 'string' ? res.data.detail : `Upload failed (${res.status}).`);
      }
      setFile(null); setProjectId(res.data.id); setView('project');
    } catch (e) { setError(e.message); } finally { setBusy(false); setUpload(null); }
  };
  const remove = async (id) => {
    if (!window.confirm('Delete this project and its files?')) return;
    await send('DELETE', `/projects/${id}`).catch(() => {});
    load();
  };
  const FileIcon = file && VIDEO_RE.test(file.name) ? FileVideo : FileAudio;

  return (
    <div className="min-h-screen flex flex-col bg-[var(--kt-s0)] text-[var(--kt-text)]" style={{ fontFamily: 'var(--kt-font-ui)' }}>
      <header className="h-14 px-4 sm:px-6 flex items-center justify-between border-b border-[var(--kt-s4)]/70 sticky top-0 z-30 bg-[var(--kt-s1)]">
        <div className="flex items-center gap-3">
          <button type="button" onClick={view === 'home' ? onBackToHome : () => setView('home')} aria-label="Back" title="Back"
            className="h-8 w-8 rounded-lg grid place-items-center text-[var(--kt-muted)] hover:text-white hover:bg-[var(--kt-s3)] cursor-pointer"><ArrowLeft size={16} /></button>
          <BrandLogo size={26} />
          <span className="font-semibold text-sm">Dubbing Studio</span>
        </div>
        <AccountMenuDropdown user={user} onOpenLogoutModal={onOpenLogoutModal} />
      </header>

      <main className={`flex-1 w-full ${view === 'project' ? 'max-w-6xl' : 'max-w-3xl'} mx-auto px-4 sm:px-6 py-6`}>
        {view === 'project' ? <ProjectEditor projectId={projectId} onClose={() => setView('home')} /> : null}
        {view === 'quick' ? <QuickDub /> : null}
        {view === 'home' ? (
          <div className="flex flex-col gap-5">
            {error ? <div className="rounded-lg border border-[var(--kt-danger)]/40 bg-[var(--kt-danger)]/10 px-4 py-3 text-sm">{error}</div> : null}
            <section
              onDragEnter={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={(e) => { e.preventDefault(); setDragging(false); }}
              onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); setDragging(false); accept(e.dataTransfer.files?.[0]); }}
              className={`rounded-2xl border-2 border-dashed ${dragging ? 'border-[#5b3cff] bg-[#5b3cff]/10' : 'border-[var(--kt-s5)] bg-[var(--kt-s1)]/70'}`}>
              <input ref={inputRef} type="file" accept="audio/*,video/*,.mkv,.wma,.ts" className="hidden" onChange={(e) => { accept(e.target.files?.[0]); e.target.value = ''; }} />
              {!file ? (
                <button type="button" onClick={() => inputRef.current?.click()} className="w-full px-6 py-12 flex flex-col items-center gap-3 text-center cursor-pointer">
                  <span className="h-12 w-12 rounded-xl grid place-items-center text-white" style={{ background: GRAD }}><UploadCloud size={22} /></span>
                  <span className="text-base font-medium">Start a dubbing project</span>
                  <span className="text-xs text-[var(--kt-faint)]">Drop a video or audio file. You edit the transcript, speakers, voices and translation before anything is spoken.</span>
                </button>
              ) : (
                <div className="p-5 flex flex-col gap-3">
                  <div className="flex items-center gap-3">
                    <span className="h-10 w-10 rounded-lg grid place-items-center bg-[var(--kt-s3)] text-[var(--kt-accent)]"><FileIcon size={18} /></span>
                    <div className="min-w-0 flex-1"><div className="text-sm font-medium truncate">{file.name}</div><div className="text-xs text-[var(--kt-faint)]">{formatBytes(file.size)}</div></div>
                    {!busy ? <button type="button" onClick={() => setFile(null)} aria-label="Remove file" className="h-7 w-7 grid place-items-center rounded-md text-[var(--kt-faint)] hover:text-white hover:bg-[var(--kt-s3)] cursor-pointer"><X size={14} /></button> : null}
                  </div>
                  <label className="flex items-center gap-2 text-sm"><span className="text-[var(--kt-muted)]">Spoken language</span>
                    <select value={sourceLang} onChange={(e) => setSourceLang(e.target.value)} disabled={busy} className="h-8 rounded-md bg-[var(--kt-s2)] border border-[var(--kt-s5)] px-2">
                      <option>Auto-Detect</option><option>Hindi</option><option>English</option>
                    </select></label>
                  <p className="text-xs text-[var(--kt-faint)]">Transcribing uses your hours for the full length of the file. They are held now and charged once the transcript is ready.</p>
                  {upload ? <div><div className="h-2 rounded-full bg-[var(--kt-s3)] overflow-hidden"><div className="h-full" style={{ width: `${upload.percent || 2}%`, background: GRAD }} /></div>
                    <div className="mt-1 text-xs text-[var(--kt-faint)]">Uploading {formatSpeed(upload.speed)} {formatEta(upload.eta)}</div></div> : null}
                  <div><button type="button" onClick={create} disabled={busy} className="h-9 px-4 rounded-lg text-[13px] font-semibold text-white flex items-center gap-1.5 cursor-pointer disabled:opacity-50" style={{ background: GRAD }}>
                    {busy ? <Loader2 size={14} className="animate-spin" /> : null}Create project</button></div>
                </div>
              )}
            </section>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--kt-faint)]"><FolderOpen size={13} /> Your projects</div>
              <button type="button" onClick={() => setView('quick')} className="text-xs text-[var(--kt-muted)] hover:text-white flex items-center gap-1 cursor-pointer"><Zap size={12} /> Quick dub (one click, less control)</button>
            </div>
            {projects.length ? (
              <ul className="rounded-xl border border-[var(--kt-s4)] bg-[var(--kt-s1)] divide-y divide-[var(--kt-s4)]">
                {projects.map((p) => (
                  <li key={p.id} className="flex items-center">
                    <button type="button" onClick={() => { setProjectId(p.id); setView('project'); }} className="flex-1 min-w-0 text-left px-3.5 py-2.5 hover:bg-[var(--kt-s2)] cursor-pointer">
                      <div className="text-sm font-medium truncate">{p.filename}</div>
                      <div className="text-xs text-[var(--kt-faint)]">{[p.source_language, p.target_language ? `to ${p.target_language}` : null, `${p.lines} lines`, p.status, timeAgo(p.updated)].filter(Boolean).join(' · ')}</div>
                    </button>
                    <button type="button" onClick={() => remove(p.id)} aria-label="Delete project" title="Delete project" className="h-8 w-8 mr-2 grid place-items-center rounded-md text-[var(--kt-faint)] hover:text-[var(--kt-danger)] hover:bg-[var(--kt-s3)] cursor-pointer"><Trash2 size={14} /></button>
                  </li>
                ))}
              </ul>
            ) : <div className="rounded-xl border border-dashed border-[var(--kt-s4)] px-4 py-6 text-sm text-[var(--kt-faint)]">No projects yet.</div>}
          </div>
        ) : null}
      </main>
    </div>
  );
}
