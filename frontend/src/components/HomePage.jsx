import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Mic, Subtitles, UploadCloud, ArrowRight, X, FileAudio, FileVideo, Clock, Palette, FolderOpen,
} from 'lucide-react';
import BrandLogo from './BrandLogo';
import AccountMenuDropdown from './AccountMenuDropdown';
import NotificationBellDropdown from './NotificationBellDropdown';
import { API_BASE } from '../config';
import { openAppearance } from '../theme/themeEngine';
import { setLaunchIntent } from '../utils/launchIntent';

const GRAD = 'linear-gradient(100deg, #1a6dff 0%, #5b3cff 55%, #8a10ff 100%)';
const MEDIA_RE = /\.(mp3|wav|m4a|aac|flac|ogg|opus|wma|mp4|mkv|mov|webm|avi|flv|wmv|m4v|ts)$/i;
const VIDEO_RE = /\.(mp4|mkv|mov|webm|avi|flv|wmv|m4v|ts)$/i;

const TOOLS = [
  {
    id: 'transcribe',
    name: 'Transcribe Studio',
    blurb: 'Speaker-labelled transcripts with QC and CSV, DOCX and XLSX deliverables.',
    icon: Mic,
  },
  {
    id: 'subtitle',
    name: 'Subtitle Studio',
    blurb: 'Build, check, translate and export subtitle cards as SRT, VTT and more.',
    icon: Subtitles,
  },
];

function timeAgo(iso) {
  const t = iso ? new Date(iso).getTime() : NaN;
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

/** Drafts the studios autosave in this browser, newest first. */
function readLocalDrafts() {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i) || '';
      let tool = null;
      let name = '';
      if (key.startsWith('karya_subtitle_autosave_')) { tool = 'subtitle'; name = key.slice('karya_subtitle_autosave_'.length); }
      else if (key.startsWith('karya_autosave_')) { tool = 'transcribe'; name = key.slice('karya_autosave_'.length); }
      if (!tool) continue;
      const d = JSON.parse(localStorage.getItem(key) || 'null');
      const count = Array.isArray(d?.segments) ? d.segments.length : Array.isArray(d?.events) ? d.events.length : 0;
      if (!d || !count) continue;
      out.push({
        key, tool, filename: name.replace(/^draft_subtitle$/, 'Untitled subtitles'),
        meta: `${count} ${tool === 'subtitle' ? 'cards' : 'segments'} · draft on this device`, updatedAt: d.timestamp,
      });
    }
  } catch { /* storage unavailable */ }
  return out;
}

export default function HomePage({ onSelect, user, onLogout, onOpenAuth }) {
  const [file, setFile] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [badFile, setBadFile] = useState(false);
  const [serverProjects, setServerProjects] = useState([]);
  const inputRef = useRef(null);
  const dragDepth = useRef(0);
  const drafts = useMemo(() => (user ? readLocalDrafts() : []), [user]);

  useEffect(() => {
    if (!user) return undefined;
    const ctl = new AbortController();
    fetch(`${API_BASE}/api/projects`, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && Array.isArray(d.projects)) setServerProjects(d.projects); })
      .catch(() => { /* backend offline: recents just show local drafts */ });
    return () => ctl.abort();
  }, [user]);

  const recents = useMemo(() => {
    const server = serverProjects.map((p) => ({
      key: `p_${p.id}`, tool: 'transcribe', projectId: p.id, filename: p.filename || 'Untitled',
      meta: [p.language, p.segment_count ? `${p.segment_count} segments` : null].filter(Boolean).join(' · '),
      updatedAt: p.updated_at || p.created_at,
    }));
    return [...server, ...drafts]
      .sort((a, b) => (new Date(b.updatedAt || 0)) - (new Date(a.updatedAt || 0)))
      .slice(0, 6);
  }, [serverProjects, drafts]);

  const open = useCallback((tool, payload) => {
    if (!user) { onOpenAuth?.('login'); return; }
    if (payload) setLaunchIntent(tool, payload);
    onSelect(tool);
  }, [user, onOpenAuth, onSelect]);

  const accept = (f) => {
    if (!f) return;
    if (!MEDIA_RE.test(f.name || '') && !/^(audio|video)\//.test(f.type || '')) { setBadFile(true); return; }
    setBadFile(false);
    setFile(f);
  };

  const dropProps = {
    onDragEnter: (e) => { e.preventDefault(); dragDepth.current += 1; setDragging(true); },
    onDragLeave: (e) => { e.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); },
    onDragOver: (e) => e.preventDefault(),
    onDrop: (e) => { e.preventDefault(); dragDepth.current = 0; setDragging(false); accept(e.dataTransfer.files?.[0]); },
  };

  const isVideo = file && (VIDEO_RE.test(file.name) || file.type?.startsWith('video/'));
  const FileIcon = isVideo ? FileVideo : FileAudio;
  const firstName = (user?.name || user?.email?.split('@')[0] || '').split(' ')[0];

  return (
    <div className="min-h-screen flex flex-col bg-[var(--kt-s0)] text-[var(--kt-text)] relative overflow-hidden" style={{ fontFamily: 'var(--kt-font-ui)' }}>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[420px] opacity-[0.16]"
        style={{ background: 'radial-gradient(60% 100% at 50% 0%, #5b3cff 0%, rgba(26,109,255,0.4) 45%, transparent 75%)' }} />

      <header className="relative z-10 h-14 px-4 sm:px-6 flex items-center justify-between border-b border-[var(--kt-s4)]/70">
        <BrandLogo variant="wordmark" size={30} />
        <div className="flex items-center gap-2">
          <button type="button" onClick={openAppearance} title="Appearance" aria-label="Appearance"
            className="h-8 w-8 rounded-lg grid place-items-center text-[var(--kt-muted)] hover:text-white hover:bg-[var(--kt-s3)] transition-colors cursor-pointer">
            <Palette size={16} />
          </button>
          {user ? (
            <>
              <NotificationBellDropdown />
              <AccountMenuDropdown user={user} onOpenLogoutModal={onLogout} />
            </>
          ) : (
            <>
              <button type="button" onClick={() => onOpenAuth?.('login')}
                className="h-8 px-3 rounded-lg text-xs font-semibold text-[var(--kt-muted)] hover:text-white hover:bg-[var(--kt-s3)] transition-colors cursor-pointer">Sign in</button>
              <button type="button" onClick={() => onOpenAuth?.('signup')}
                className="h-8 px-3.5 rounded-lg text-xs font-bold text-white cursor-pointer" style={{ background: GRAD }}>Create account</button>
            </>
          )}
        </div>
      </header>

      <main className="relative z-10 flex-1 w-full max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-10 flex flex-col gap-7">
        <div>
          <h1 className="text-2xl sm:text-[28px] font-semibold tracking-tight">
            {greeting()}{firstName ? `, ${firstName}` : ''}
          </h1>
          <p className="text-sm text-[var(--kt-muted)] mt-1">{user ? 'Start with a file or pick up where you left off.' : 'Sign in to start transcribing and subtitling.'}</p>
        </div>

        {/* Drop to start */}
        <section {...dropProps} aria-label="Start from a media file"
          className={`rounded-2xl border-2 border-dashed transition-all ${dragging ? 'border-[#5b3cff] bg-[#5b3cff]/10 scale-[1.005]' : 'border-[var(--kt-s5)] bg-[var(--kt-s1)]/70'}`}>
          <input ref={inputRef} type="file" accept="audio/*,video/*,.mkv,.wma,.ts" className="hidden"
            onChange={(e) => { accept(e.target.files?.[0]); e.target.value = ''; }} />
          {!file ? (
            <button type="button" onClick={() => (user ? inputRef.current?.click() : onOpenAuth?.('login'))}
              className="w-full px-6 py-9 flex flex-col items-center gap-3 text-center cursor-pointer">
              <span className="h-11 w-11 rounded-xl grid place-items-center text-white" style={{ background: GRAD }}><UploadCloud size={20} /></span>
              <span className="text-[15px] font-medium">{dragging ? 'Drop to start' : 'Drop an audio or video file to start'}</span>
              <span className={`text-xs ${badFile ? 'text-[var(--kt-danger)]' : 'text-[var(--kt-faint)]'}`}>
                {badFile ? 'That file type is not supported. Try MP3, WAV, M4A, MP4, MKV or MOV.' : user ? 'or click to browse. MP3, WAV, M4A, MP4, MKV, MOV and more.' : 'Sign in first, then drop your file.'}
              </span>
            </button>
          ) : (
            <div className="px-5 py-5 flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <span className="h-10 w-10 rounded-lg grid place-items-center bg-[var(--kt-s3)] text-[var(--kt-accent)] shrink-0"><FileIcon size={18} /></span>
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{file.name}</div>
                  <div className="text-xs text-[var(--kt-faint)]">{(file.size / (1024 * 1024)).toFixed(1)} MB. Choose where to open it.</div>
                </div>
                <button type="button" onClick={() => setFile(null)} aria-label="Remove file" title="Remove file"
                  className="h-7 w-7 rounded-md grid place-items-center text-[var(--kt-faint)] hover:text-white hover:bg-[var(--kt-s3)] cursor-pointer shrink-0"><X size={14} /></button>
              </div>
              <div className="flex gap-2 shrink-0">
                <button type="button" onClick={() => open('transcribe', { file })}
                  className="h-9 px-4 rounded-lg text-[13px] font-semibold text-white flex items-center gap-1.5 cursor-pointer" style={{ background: GRAD }}>
                  <Mic size={14} /> Transcribe
                </button>
                <button type="button" onClick={() => open('subtitle', { file })}
                  className="h-9 px-4 rounded-lg text-[13px] font-semibold flex items-center gap-1.5 border border-[var(--kt-s5)] bg-[var(--kt-s2)] hover:bg-[var(--kt-s3)] cursor-pointer">
                  <Subtitles size={14} /> Subtitle
                </button>
              </div>
            </div>
          )}
        </section>

        {/* Studios */}
        <section className="grid grid-cols-1 sm:grid-cols-2 gap-3" aria-label="Studios">
          {TOOLS.map((t) => (
            <button key={t.id} type="button" onClick={() => open(t.id)}
              className="group text-left rounded-xl border border-[var(--kt-s4)] bg-[var(--kt-s1)] hover:bg-[var(--kt-s2)] hover:border-[var(--kt-accent)]/60 p-4 flex items-start gap-3.5 transition-colors cursor-pointer">
              <span className="h-10 w-10 rounded-lg grid place-items-center shrink-0 text-white" style={{ background: GRAD }}><t.icon size={18} /></span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="text-[15px] font-semibold">{t.name}</span>
                  <ArrowRight size={15} className="text-[var(--kt-faint)] group-hover:text-[var(--kt-accent)] group-hover:translate-x-0.5 transition-all" />
                </span>
                <span className="block text-[13px] leading-snug text-[var(--kt-muted)] mt-1">{t.blurb}</span>
              </span>
            </button>
          ))}
        </section>

        {/* Recent */}
        {user && (
          <section aria-label="Recent projects">
            <div className="flex items-center gap-2 mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--kt-faint)]">
              <Clock size={13} /> Recent
            </div>
            {recents.length ? (
              <ul className="rounded-xl border border-[var(--kt-s4)] bg-[var(--kt-s1)] divide-y divide-[var(--kt-s4)] overflow-hidden">
                {recents.map((r) => {
                  const Icon = r.tool === 'subtitle' ? Subtitles : Mic;
                  return (
                    <li key={r.key}>
                      <button type="button" onClick={() => open(r.tool, r.projectId ? { projectId: r.projectId } : undefined)}
                        className="w-full flex items-center gap-3 px-3.5 py-2.5 text-left hover:bg-[var(--kt-s2)] transition-colors cursor-pointer">
                        <span className="h-8 w-8 rounded-md grid place-items-center bg-[var(--kt-s3)] text-[var(--kt-accent)] shrink-0"><Icon size={15} /></span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium truncate">{r.filename}</span>
                          <span className="block text-xs text-[var(--kt-faint)] truncate">{r.meta}</span>
                        </span>
                        <span className="text-xs text-[var(--kt-faint)] shrink-0">{timeAgo(r.updatedAt)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="rounded-xl border border-dashed border-[var(--kt-s4)] px-4 py-6 flex items-center gap-3 text-sm text-[var(--kt-faint)]">
                <FolderOpen size={18} /> Projects you work on will show up here.
              </div>
            )}
          </section>
        )}
      </main>

      <footer className="relative z-10 px-6 py-4 text-[11px] text-[var(--kt-faint)] flex items-center justify-between">
        <span>Lower Third &middot; VerboLabs</span>
        <span className="hidden sm:inline">Next-gen AI subtitling platform</span>
      </footer>
    </div>
  );
}
