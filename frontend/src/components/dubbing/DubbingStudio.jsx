import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, UploadCloud, Loader2, Languages, Download, X, AlertTriangle, CheckCircle2,
  FileVideo, FileAudio, Play, RotateCcw, AudioLines,
} from 'lucide-react';
import BrandLogo from '../BrandLogo';
import AccountMenuDropdown from '../AccountMenuDropdown';
import { getApiBase } from '../../config';
import { xhrPostForm, formatBytes, formatSpeed, formatEta } from '../../utils/xhrUpload';
import { takeLaunchIntent } from '../../utils/launchIntent';

const GRAD = 'linear-gradient(100deg, #1a6dff 0%, #5b3cff 55%, #8a10ff 100%)';
const MEDIA_RE = /\.(mp3|wav|m4a|aac|flac|ogg|opus|wma|mp4|mkv|mov|webm|avi|flv|wmv|m4v|ts)$/i;
const VIDEO_RE = /\.(mp4|mkv|mov|webm|avi|flv|wmv|m4v|ts)$/i;
const FALLBACK_LANGS = ['English', 'Hindi'];

const api = (path) => `${getApiBase()}/api/dubbing${path}`;
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

async function call(path, opts) {
  const res = await fetch(api(path), opts);
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) throw new Error(typeof data?.detail === 'string' ? data.detail : `Request failed (${res.status})`);
  return data;
}

function Btn({ children, onClick, disabled, primary, icon: Icon }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={`h-9 px-4 rounded-lg text-[13px] font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${primary ? 'text-white' : 'border border-[var(--kt-s5)] bg-[var(--kt-s2)] hover:bg-[var(--kt-s3)]'}`}
      style={primary ? { background: GRAD } : undefined}>
      {Icon ? <Icon size={14} /> : null}{children}
    </button>
  );
}

export default function DubbingStudio({ onBackToHome, user, onOpenLogoutModal }) {
  const [config, setConfig] = useState(null);
  const [job, setJob] = useState(null);
  const [file, setFile] = useState(null);
  const [sourceLang, setSourceLang] = useState('Auto-Detect');
  const [targetLang, setTargetLang] = useState('English');
  const [speakers, setSpeakers] = useState(0);
  const [consent, setConsent] = useState(false);
  const [upload, setUpload] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [audioUrl, setAudioUrl] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const inputRef = useRef(null);
  const jobId = job?.id;
  const langs = config?.languages || FALLBACK_LANGS;

  useEffect(() => {
    call('/config').then(setConfig).catch(() => setConfig({ languages: FALLBACK_LANGS }));
    const intent = takeLaunchIntent('dubbing');
    if (intent?.file) setFile(intent.file);
  }, []);

  const refresh = useCallback(async (id) => {
    try { setJob(await call(`/jobs/${id}`)); } catch (e) { setError(e.message); }
  }, []);

  useEffect(() => {
    if (!jobId || job?.status !== 'dubbing') return undefined;
    const t = setInterval(() => refresh(jobId), 3000);
    return () => clearInterval(t);
  }, [jobId, job?.status, refresh]);

  // Preview of the finished dub (audio is small; the video is loaded on request)
  useEffect(() => {
    if (job?.status !== 'done' || !job.files?.audio) { setAudioUrl(''); return undefined; }
    let url = '';
    fetch(api(`/jobs/${job.id}/download/audio`)).then((r) => (r.ok ? r.blob() : null))
      .then((b) => { if (b) { url = URL.createObjectURL(b); setAudioUrl(url); } }).catch(() => {});
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [job?.status, job?.id, job?.files]);
  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl); }, [videoUrl]);

  const accept = (f) => {
    if (!f) return;
    if (!MEDIA_RE.test(f.name || '') && !/^(audio|video)\//.test(f.type || '')) { setError('That file type is not supported. Try MP3, WAV, M4A, MP4, MKV or MOV.'); return; }
    setError(''); setFile(f);
  };

  const start = async () => {
    setError(''); setBusy(true); setUpload({ percent: 0 });
    const fd = new FormData();
    fd.append('file', file);
    fd.append('target_language', targetLang);
    fd.append('source_language', sourceLang);
    fd.append('num_speakers', String(speakers));
    try {
      const res = await xhrPostForm(api('/jobs'), fd, { onProgress: setUpload });
      if (!res.ok) {
        if (res.status === 402) return; // the out-of-hours notice is already showing
        throw new Error(typeof res.data?.detail === 'string' ? res.data.detail : `Upload failed (${res.status}).`);
      }
      await refresh(res.data.job_id);
    } catch (e) { setError(e.message); } finally { setBusy(false); setUpload(null); }
  };

  const reset = () => {
    if (jobId) fetch(api(`/jobs/${jobId}`), { method: 'DELETE' }).catch(() => {});
    setJob(null); setFile(null); setError(''); setConsent(false); setVideoUrl('');
  };
  const cancel = () => fetch(api(`/jobs/${jobId}/cancel`), { method: 'POST' }).then(() => refresh(jobId));

  const saveBlob = async (kind, name) => {
    try {
      const res = await fetch(api(`/jobs/${jobId}/download/${kind}`));
      if (!res.ok) throw new Error(`Download failed (${res.status}).`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url; a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) { setError(e.message); }
  };
  const loadVideo = async () => {
    setBusy(true);
    try {
      const res = await fetch(api(`/jobs/${jobId}/download/video`));
      if (!res.ok) throw new Error(`Could not load the video (${res.status}).`);
      setVideoUrl(URL.createObjectURL(await res.blob()));
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const ready = config?.elevenlabs_configured !== false;
  const FileIcon = file && VIDEO_RE.test(file.name) ? FileVideo : FileAudio;
  const base = job ? job.filename.replace(/\.[^.]+$/, '') : '';
  const expected = job ? Math.max(90, job.duration * 0.8 + 60) : 1;
  const pct = job && job.status === 'dubbing' ? Math.min(95, Math.max(4, (job.elapsed_sec / expected) * 100)) : 0;

  return (
    <div className="min-h-screen flex flex-col bg-[var(--kt-s0)] text-[var(--kt-text)]" style={{ fontFamily: 'var(--kt-font-ui)' }}>
      <header className="h-14 px-4 sm:px-6 flex items-center justify-between border-b border-[var(--kt-s4)]/70 sticky top-0 z-30 bg-[var(--kt-s1)]">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onBackToHome} aria-label="Back to home" title="Back to home"
            className="h-8 w-8 rounded-lg grid place-items-center text-[var(--kt-muted)] hover:text-white hover:bg-[var(--kt-s3)] cursor-pointer"><ArrowLeft size={16} /></button>
          <BrandLogo size={26} />
          <span className="font-semibold text-sm">Dubbing Studio</span>
        </div>
        <AccountMenuDropdown user={user} onOpenLogoutModal={onOpenLogoutModal} />
      </header>

      <main className="flex-1 w-full max-w-3xl mx-auto px-4 sm:px-6 py-6 flex flex-col gap-5">
        {(error || (job?.status === 'error' && job.error)) ? (
          <div className="rounded-lg border border-[var(--kt-danger)]/40 bg-[var(--kt-danger)]/10 px-4 py-3 text-sm flex items-start gap-2">
            <AlertTriangle size={16} className="text-[var(--kt-danger)] mt-0.5 shrink-0" />
            <span className="flex-1">{error || job.error}</span>
            {error ? <button type="button" onClick={() => setError('')} aria-label="Dismiss" className="text-[var(--kt-faint)] hover:text-white cursor-pointer"><X size={14} /></button> : null}
          </div>
        ) : null}
        {!ready && !job ? (
          <div className="rounded-lg border border-[var(--kt-warn)]/40 bg-[var(--kt-warn)]/10 px-4 py-3 text-sm">
            Dubbing needs the ElevenLabs key on the server (ELEVENLABS_API_KEY, on a plan that includes dubbing).
          </div>
        ) : null}

        {!job ? (
          <section
            onDragEnter={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={(e) => { e.preventDefault(); setDragging(false); }}
            onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); setDragging(false); accept(e.dataTransfer.files?.[0]); }}
            className={`rounded-2xl border-2 border-dashed ${dragging ? 'border-[#5b3cff] bg-[#5b3cff]/10' : 'border-[var(--kt-s5)] bg-[var(--kt-s1)]/70'}`}>
            <input ref={inputRef} type="file" accept="audio/*,video/*,.mkv,.wma,.ts" className="hidden" onChange={(e) => { accept(e.target.files?.[0]); e.target.value = ''; }} />
            {!file ? (
              <button type="button" onClick={() => inputRef.current?.click()} className="w-full px-6 py-14 flex flex-col items-center gap-3 text-center cursor-pointer">
                <span className="h-12 w-12 rounded-xl grid place-items-center text-white" style={{ background: GRAD }}><UploadCloud size={22} /></span>
                <span className="text-base font-medium">Drop a video or audio file to dub</span>
                <span className="text-xs text-[var(--kt-faint)]">Each speaker is dubbed in their own cloned voice, and the original music and sound effects stay.</span>
              </button>
            ) : (
              <div className="p-5 flex flex-col gap-4">
                <div className="flex items-center gap-3">
                  <span className="h-10 w-10 rounded-lg grid place-items-center bg-[var(--kt-s3)] text-[var(--kt-accent)]"><FileIcon size={18} /></span>
                  <div className="min-w-0 flex-1"><div className="text-sm font-medium truncate">{file.name}</div><div className="text-xs text-[var(--kt-faint)]">{formatBytes(file.size)}</div></div>
                  {!busy ? <button type="button" onClick={() => setFile(null)} aria-label="Remove file" className="h-7 w-7 grid place-items-center rounded-md text-[var(--kt-faint)] hover:text-white hover:bg-[var(--kt-s3)] cursor-pointer"><X size={14} /></button> : null}
                </div>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-3 text-sm">
                  <label className="flex items-center gap-2"><span className="text-[var(--kt-muted)]">Spoken language</span>
                    <select value={sourceLang} onChange={(e) => setSourceLang(e.target.value)} disabled={busy} className="h-8 rounded-md bg-[var(--kt-s2)] border border-[var(--kt-s5)] px-2">
                      <option>Auto-Detect</option>{langs.map((l) => <option key={l}>{l}</option>)}
                    </select></label>
                  <label className="flex items-center gap-2"><Languages size={14} className="text-[var(--kt-accent)]" /><span className="text-[var(--kt-muted)]">Dub into</span>
                    <select value={targetLang} onChange={(e) => setTargetLang(e.target.value)} disabled={busy} className="h-8 rounded-md bg-[var(--kt-s2)] border border-[var(--kt-s5)] px-2">
                      {langs.map((l) => <option key={l}>{l}</option>)}
                    </select></label>
                  <label className="flex items-center gap-2"><span className="text-[var(--kt-muted)]">Speakers</span>
                    <select value={speakers} onChange={(e) => setSpeakers(Number(e.target.value))} disabled={busy} className="h-8 rounded-md bg-[var(--kt-s2)] border border-[var(--kt-s5)] px-2">
                      <option value={0}>Auto</option>{[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
                    </select></label>
                </div>
                <label className="flex items-start gap-2 text-xs text-[var(--kt-muted)] cursor-pointer">
                  <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />
                  <span>I have the right to clone the voices in this recording, and I understand the dubbed voices are AI-generated.</span>
                </label>
                <p className="text-xs text-[var(--kt-faint)]">Dubbing uses your hours for the full length of the file. They are held now and charged only if the dub is delivered.</p>
                {upload ? (
                  <div>
                    <div className="h-2 rounded-full bg-[var(--kt-s3)] overflow-hidden"><div className="h-full" style={{ width: `${upload.percent || 2}%`, background: GRAD }} /></div>
                    <div className="mt-1 text-xs text-[var(--kt-faint)]">Uploading {formatSpeed(upload.speed)} {formatEta(upload.eta)}</div>
                  </div>
                ) : null}
                <div><Btn primary icon={AudioLines} onClick={start} disabled={busy || !ready || !consent || sourceLang === targetLang}>Dub it</Btn></div>
              </div>
            )}
          </section>
        ) : null}

        {job?.status === 'dubbing' ? (
          <>
            <div className="rounded-xl border border-[var(--kt-s4)] bg-[var(--kt-s1)] p-5">
              <div className="flex items-center gap-2 text-sm font-medium"><Loader2 size={15} className="animate-spin text-[var(--kt-accent)]" />Dubbing {job.filename} into {job.target_language}</div>
              <div className="mt-3 h-2 rounded-full bg-[var(--kt-s3)] overflow-hidden"><div className="h-full rounded-full transition-all duration-1000" style={{ width: `${pct}%`, background: GRAD }} /></div>
              <div className="mt-2 text-xs text-[var(--kt-faint)]">{job.detail}. {mmss(job.elapsed_sec)} so far. The engine does not report exact progress, and a long video can take several minutes. You can leave this page open.</div>
            </div>
            <div><Btn onClick={cancel} icon={X}>Cancel</Btn></div>
          </>
        ) : null}

        {job?.status === 'error' ? <div><Btn primary icon={RotateCcw} onClick={reset}>Try again</Btn></div> : null}

        {job?.status === 'done' ? (
          <section className="rounded-xl border border-[var(--kt-success)]/40 bg-[var(--kt-s1)] p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold"><CheckCircle2 size={16} className="text-[var(--kt-success)]" /> Your {job.target_language} dub is ready</div>
            {job.watermarked ? (
              <div className="rounded-md border border-[var(--kt-warn)]/40 bg-[var(--kt-warn)]/10 px-3 py-2 text-xs">
                This dub carries an ElevenLabs watermark because the ElevenLabs account is not on the Starter plan or above. Upgrade it to get dubs without a watermark.
              </div>
            ) : null}
            {job.files?.video ? (videoUrl
              ? <video controls src={videoUrl} className="w-full max-h-[460px] rounded-lg bg-black" />
              : <div><Btn icon={Play} onClick={loadVideo} disabled={busy}>Preview the dubbed video</Btn></div>) : null}
            {audioUrl ? <audio controls src={audioUrl} className="w-full" /> : null}
            <div className="flex flex-wrap gap-2">
              {job.files?.video ? <Btn primary icon={Download} onClick={() => saveBlob('video', `${base}.${job.target_language}.dub.mp4`)}>Dubbed video</Btn> : null}
              {job.files?.audio ? <Btn primary={!job.files?.video} icon={Download} onClick={() => saveBlob('audio', `${base}.${job.target_language}.dub.mp3`)}>Dubbed audio</Btn> : null}
              <Btn icon={RotateCcw} onClick={reset}>Dub another file</Btn>
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
