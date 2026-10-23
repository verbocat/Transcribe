import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Mic, Subtitles, AudioLines, UploadCloud, ArrowRight, X, FileAudio, FileVideo, Palette, FolderOpen,
} from 'lucide-react';
import BrandLogo from './BrandLogo';
import CaptionStage from './CaptionStage';
import './noun.css';
import AccountMenuDropdown from './AccountMenuDropdown';
import NotificationBellDropdown from './NotificationBellDropdown';
import { API_BASE } from '../config';
import { openAppearance } from '../theme/themeEngine';
import { setLaunchIntent } from '../utils/launchIntent';

const MEDIA_RE = /\.(mp3|wav|m4a|aac|flac|ogg|opus|wma|mp4|mkv|mov|webm|avi|flv|wmv|m4v|ts)$/i;
const VIDEO_RE = /\.(mp4|mkv|mov|webm|avi|flv|wmv|m4v|ts)$/i;

const TOOLS = [
  {
    id: 'transcribe',
    name: 'Transcribe Studio',
    blurb: 'Speaker-labelled transcripts with QC, ready as CSV, DOCX and XLSX.',
    art: 'transcribe',
    icon: Mic,
  },
  {
    id: 'subtitle',
    name: 'Subtitle Studio',
    blurb: 'Build, check, translate and export subtitles as SRT, VTT and more.',
    art: 'subtitle',
    icon: Subtitles,
  },
  {
    id: 'dubbing',
    name: 'Dubbing Studio',
    blurb: 'Dub a video or audio file into another language, in each speaker\'s own voice.',
    art: 'dubbing',
    icon: AudioLines,
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
        key, tool, draftName: tool === 'transcribe' ? name : undefined, filename: name.replace(/^draft_subtitle$/, 'Untitled subtitles'),
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

  const SLAB_BARS = useMemo(() => Array.from({ length: 96 }, (_, k) => 14 + Math.abs(Math.sin(k * 0.45) * 0.6 + Math.sin(k * 1.3 + 2) * 0.4) * 86), []);

  const dropzone = (
    <section {...dropProps} aria-label="Start from a media file" className={`nx-slab ${dragging ? 'drag' : ''}`}>
      <input ref={inputRef} type="file" accept="audio/*,video/*,.mkv,.wma,.ts" className="hidden"
        onChange={(e) => { accept(e.target.files?.[0]); e.target.value = ''; }} />
      <div className="nx-slab-ruler" aria-hidden />
      <div className="nx-slab-wave" aria-hidden>
        {SLAB_BARS.map((h, k) => (<span key={k} style={{ height: `${h}%` }} />))}
      </div>
      <div className="nx-slab-play" aria-hidden />
      {!file ? (
        <button type="button" onClick={() => (user ? inputRef.current?.click() : onOpenAuth?.('login'))}
          className="relative w-full px-6 sm:px-9 pt-9 pb-28 sm:pb-24 flex items-start gap-5 text-left cursor-pointer">
          <span className="nx-brand-grad h-12 w-12 rounded-2xl grid place-items-center text-white shrink-0 shadow-lg shadow-[#5b3cff]/40"><UploadCloud size={22} /></span>
          <span className="min-w-0">
            <span className="nx-display block text-[22px] sm:text-2xl font-semibold text-white leading-tight">
              {dragging ? 'Release to start' : user ? 'Drop a recording to begin' : 'Sign in to start with a file'}
            </span>
            <span className={`block mt-1.5 text-sm ${badFile ? 'text-[var(--kt-danger)]' : 'text-[var(--kt-muted)]'}`}>
              {badFile ? 'That file type is not supported. Try MP3, WAV, M4A, MP4, MKV or MOV.' : user ? 'Or click to browse. MP3, WAV, M4A, MP4, MKV, MOV and more.' : 'You will be able to drop your audio or video right after.'}
            </span>
          </span>
        </button>
      ) : (
        <div className="relative px-5 sm:px-7 pt-7 pb-24 flex flex-col gap-5">
          <div className="flex items-center gap-3 min-w-0">
            <span className="h-11 w-11 rounded-xl grid place-items-center bg-[var(--kt-s3)] text-[var(--kt-accent-soft)] shrink-0"><FileIcon size={19} /></span>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-semibold truncate">{file.name}</div>
              <div className="text-xs text-[var(--kt-muted)]">{(file.size / (1024 * 1024)).toFixed(1)} MB. Choose where to open it.</div>
            </div>
            <button type="button" onClick={() => setFile(null)} aria-label="Remove file" title="Remove file"
              className="h-8 w-8 rounded-lg grid place-items-center text-[var(--kt-faint)] hover:text-white hover:bg-[var(--kt-s3)] cursor-pointer shrink-0"><X size={15} /></button>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => open('transcribe', { file })} className="nx-primary nx-brand-grad"><Mic size={14} /> Transcribe</button>
            <button type="button" onClick={() => open('subtitle', { file })} className="nx-ghost"><Subtitles size={14} /> Subtitle</button>
            <button type="button" onClick={() => open('dubbing', { file })} className="nx-ghost"><AudioLines size={14} /> Dub</button>
          </div>
        </div>
      )}
    </section>
  );

  const studios = (
    <section className="grid grid-cols-1 sm:grid-cols-3 gap-3.5" aria-label="Studios">
      {TOOLS.map((t) => (
        <button key={t.id} type="button" onClick={() => open(t.id)} className="nx-tile group">
          <div className="nx-tile-art" aria-hidden><TileArt kind={t.art} /></div>
          <div className="p-4 flex flex-col gap-1.5 flex-1">
            <span className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-[15px] font-semibold"><t.icon size={16} className="text-[var(--kt-accent-soft)]" />{t.name}</span>
              <ArrowRight size={15} className="text-[var(--kt-faint)] group-hover:text-white group-hover:translate-x-0.5 transition-all" />
            </span>
            <span className="text-[13px] leading-snug text-[var(--kt-muted)]">{t.blurb}</span>
          </div>
        </button>
      ))}
    </section>
  );

  const recentPanel = user && (
    <section aria-label="Recent projects" className="min-w-0">
      <h2 className="nx-display text-lg font-semibold mb-3">Pick up where you left off</h2>
      {recents.length ? (
        <ul className="flex flex-col gap-0.5 -mx-2">
          {recents.map((r) => {
            const Icon = r.tool === 'subtitle' ? Subtitles : Mic;
            return (
              <li key={r.key}>
                <button type="button" onClick={() => open(r.tool, r.projectId ? { projectId: r.projectId } : r.draftName ? { draftName: r.draftName } : undefined)} className="nx-recent">
                  <span className="h-9 w-9 rounded-lg grid place-items-center bg-[var(--kt-s3)] text-[var(--kt-accent-soft)] shrink-0"><Icon size={16} /></span>
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
        <div className="rounded-xl border border-dashed border-[var(--kt-s5)] px-4 py-6 flex items-center gap-3 text-sm text-[var(--kt-muted)]">
          <FolderOpen size={18} className="shrink-0" /> Your projects will appear here after your first transcript.
        </div>
      )}
    </section>
  );

  return (
    <div className="min-h-screen flex flex-col bg-[var(--kt-s0)] text-[var(--kt-text)] relative overflow-hidden" style={{ fontFamily: 'var(--kt-font-ui)' }}>
      <div aria-hidden className="nx-home-bg" />

      <header className="relative z-30 h-16 px-4 sm:px-8 flex items-center justify-between max-w-[1280px] w-full mx-auto">
        <BrandLogo variant="wordmark" size={32} />
        <div className="flex items-center gap-2">
          <button type="button" onClick={openAppearance} title="Appearance" aria-label="Appearance"
            className="h-9 w-9 rounded-lg grid place-items-center text-[var(--kt-muted)] hover:text-white hover:bg-[var(--kt-s3)] transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--kt-accent-soft)]">
            <Palette size={16} />
          </button>
          {user ? (
            <>
              <NotificationBellDropdown />
              <AccountMenuDropdown user={user} onOpenLogoutModal={onLogout} />
            </>
          ) : (
            <>
              <button type="button" onClick={() => onOpenAuth?.('login')} className="nx-ghost !bg-transparent !border-transparent hover:!bg-[var(--kt-s3)]">Sign in</button>
              <button type="button" onClick={() => onOpenAuth?.('signup')} className="nx-primary nx-brand-grad">Create account</button>
            </>
          )}
        </div>
      </header>

      <main className="relative z-10 flex-1 w-full max-w-[1280px] mx-auto px-4 sm:px-8 pt-6 sm:pt-10 pb-12 flex flex-col gap-10">
        {user ? (
          <>
            <div>
              <h1 className="nx-display text-[34px] sm:text-5xl font-semibold leading-[1.05] text-white">
                {greeting()}{firstName ? `, ${firstName}` : ''}.
              </h1>
              <p className="text-base text-[var(--kt-muted)] mt-3">What are we working on today?</p>
            </div>
            <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-12 items-start">
              <div className="flex flex-col gap-7 min-w-0">
                {dropzone}
                {studios}
              </div>
              {recentPanel}
            </div>
          </>
        ) : (
          <>
            <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)] items-center pt-2 sm:pt-6">
              <div>
                <h1 className="nx-display text-[40px] sm:text-6xl font-semibold leading-[1.02] text-white max-w-xl">
                  Every word, timed and translated.
                </h1>
                <p className="text-base sm:text-lg text-[var(--kt-muted)] mt-5 max-w-lg leading-relaxed">
                  Transcribe speech, build broadcast-ready subtitles and dub into new languages, all in one workspace.
                </p>
                <div className="mt-8 flex flex-wrap gap-3">
                  <button type="button" onClick={() => onOpenAuth?.('signup')} className="nx-btn !w-auto px-7">Create account <ArrowRight size={16} /></button>
                  <button type="button" onClick={() => onOpenAuth?.('login')} className="nx-ghost !h-12 px-6 !text-[14.5px]">Sign in</button>
                </div>
              </div>
              <CaptionStage className="justify-self-center lg:justify-self-end" />
            </div>
            {dropzone}
            {studios}
          </>
        )}
      </main>

      <footer className="relative z-10 px-4 sm:px-8 py-5 text-xs text-[var(--kt-faint)] max-w-[1280px] w-full mx-auto flex items-center justify-between">
        <span>Noun by VerboLabs</span>
        <span className="hidden sm:inline">Next-gen AI media localization</span>
      </footer>
    </div>
  );
}

/** Small line illustrations for the studio tiles. */
function TileArt({ kind }) {
  if (kind === 'transcribe') {
    return (
      <svg viewBox="0 0 300 92" preserveAspectRatio="xMidYMid slice">
        {[[16, 22, 150], [16, 42, 210], [16, 62, 120]].map(([x, y, w], k) => (
          <g key={k} className={k === 1 ? 'hv' : ''}>
            <circle cx={x + 5} cy={y} r="5" className={k === 1 ? 'fillacc' : 'filldim'} />
            <rect x={x + 18} y={y - 3} width={w} height="6" rx="3" className="filldim" />
          </g>
        ))}
        <rect x="34" y="39" width="64" height="6" rx="3" className="fillacc" opacity=".9" />
      </svg>
    );
  }
  if (kind === 'subtitle') {
    return (
      <svg viewBox="0 0 300 92" preserveAspectRatio="xMidYMid slice">
        <path d="M0 70h300" className="dim" strokeWidth="1" />
        <g className="hv">
          <rect x="18" y="26" width="76" height="30" rx="6" className="filldim" />
          <rect x="104" y="26" width="92" height="30" rx="6" className="fillacc" />
          <rect x="206" y="26" width="68" height="30" rx="6" className="filldim" />
        </g>
        {[30, 44, 118, 134, 218].map((x, k) => (<rect key={k} x={x} y={k === 1 || k === 3 ? 44 : 35} width={k === 2 ? 60 : 36} height="4" rx="2" fill="#fff" opacity={k > 1 && k < 4 ? .85 : .25} />))}
        <path d="M150 12v70" className="acc" strokeWidth="1.5" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 300 92" preserveAspectRatio="xMidYMid slice">
      {[28, 62].map((cy, row) => (
        <g key={row} className={row === 1 ? 'hv' : ''}>
          {Array.from({ length: 34 }, (_, k) => {
            const h = 4 + Math.abs(Math.sin(k * (row ? 0.7 : 0.5) + row) * 15);
            return <rect key={k} x={20 + k * 8} y={cy - h / 2} width="4" height={h} rx="2" className={row ? 'fillacc' : 'filldim'} />;
          })}
        </g>
      ))}
    </svg>
  );
}
