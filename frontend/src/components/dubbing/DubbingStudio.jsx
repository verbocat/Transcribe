import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, UploadCloud, Loader2, Mic2, Languages, Wand2, Download, X, AlertTriangle, CheckCircle2,
  FileVideo, FileAudio, Play, RotateCcw, Users, FileText, Volume2,
} from 'lucide-react';
import BrandLogo from '../BrandLogo';
import AccountMenuDropdown from '../AccountMenuDropdown';
import { getApiBase } from '../../config';
import { xhrPostForm, formatBytes, formatSpeed, formatEta } from '../../utils/xhrUpload';
import { takeLaunchIntent } from '../../utils/launchIntent';

const GRAD = 'linear-gradient(100deg, #1a6dff 0%, #5b3cff 55%, #8a10ff 100%)';
const MEDIA_RE = /\.(mp3|wav|m4a|aac|flac|ogg|opus|wma|mp4|mkv|mov|webm|avi|flv|wmv|m4v|ts)$/i;
const VIDEO_RE = /\.(mp4|mkv|mov|webm|avi|flv|wmv|m4v|ts)$/i;
const RUNNING = new Set(['analyzing', 'translating', 'rendering']);
const CPS = { Hindi: 13, English: 15 };
const STEPS = ['Upload', 'Speakers', 'Translate', 'Dub'];

const api = (path) => `${getApiBase()}/api/dubbing${path}`;
const fmtTime = (s) => { const m = Math.floor(s / 60); return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`; };

async function call(path, opts) {
  const res = await fetch(api(path), opts);
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) {
    const e = new Error(typeof data?.detail === 'string' ? data.detail : data?.detail?.message || `Request failed (${res.status})`);
    e.status = res.status;
    throw e;
  }
  return data;
}
const post = (path, body) => call(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });

function stepOf(job) {
  if (!job) return 0;
  if (job.status === 'analyzing') return 0;
  if (job.status === 'analyzed') return 1;
  if (job.status === 'translating') return 2;
  if (job.status === 'translated') return 2;
  return 3; // rendering, done
}

function Bar({ percent, label, sub }) {
  return (
    <div className="rounded-xl border border-[var(--kt-s4)] bg-[var(--kt-s1)] p-5">
      <div className="flex items-center gap-2 text-sm font-medium"><Loader2 size={15} className="animate-spin text-[var(--kt-accent)]" />{label}</div>
      <div className="mt-3 h-2 rounded-full bg-[var(--kt-s3)] overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(3, Math.min(100, percent || 0))}%`, background: GRAD }} />
      </div>
      {sub ? <div className="mt-2 text-xs text-[var(--kt-faint)]">{sub}</div> : null}
    </div>
  );
}

function Chip({ children }) {
  return <span className="px-2 py-0.5 rounded-md text-[11px] bg-[var(--kt-s3)] text-[var(--kt-muted)] border border-[var(--kt-s4)]">{children}</span>;
}

function Btn({ children, onClick, disabled, primary, icon: Icon, className = '' }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={`h-9 px-4 rounded-lg text-[13px] font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${primary ? 'text-white' : 'border border-[var(--kt-s5)] bg-[var(--kt-s2)] hover:bg-[var(--kt-s3)]'} ${className}`}
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
  const [targetLang, setTargetLang] = useState('');
  const [upload, setUpload] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [edits, setEdits] = useState({});
  const [modes, setModes] = useState({});
  const [consent, setConsent] = useState(false);
  const [audioUrl, setAudioUrl] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const inputRef = useRef(null);
  const jobId = job?.id;

  useEffect(() => {
    call('/config').then(setConfig).catch(() => setConfig({ languages: ['Hindi', 'English'] }));
    const intent = takeLaunchIntent('dubbing');
    if (intent?.file) setFile(intent.file);
  }, []);

  const refresh = useCallback(async (id) => {
    try { setJob(await call(`/jobs/${id}`)); } catch (e) { setError(e.message); }
  }, []);

  useEffect(() => {
    if (!jobId || !RUNNING.has(job?.status)) return undefined;
    const t = setInterval(() => refresh(jobId), 1500);
    return () => clearInterval(t);
  }, [jobId, job?.status, refresh]);

  // Fresh server data replaces local edits and choices
  useEffect(() => {
    if (!job) return;
    setEdits({});
    setModes((m) => ({ ...Object.fromEntries(Object.keys(job.profiles || {}).map((n) => [n, job.voice_modes?.[n] || m[n] || 'clone'])) }));
    if (!targetLang && job.source_language) setTargetLang(job.source_language === 'English' ? 'Hindi' : 'English');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.status, job?.id]);

  // Previews of the finished dub
  useEffect(() => {
    if (job?.status !== 'done') { setAudioUrl(''); setVideoUrl(''); return undefined; }
    let url = '';
    fetch(api(`/jobs/${job.id}/download/audio`)).then((r) => (r.ok ? r.blob() : null)).then((b) => { if (b) { url = URL.createObjectURL(b); setAudioUrl(url); } }).catch(() => {});
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [job?.status, job?.id]);
  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl); }, [videoUrl]);

  const accept = (f) => {
    if (!f) return;
    if (!MEDIA_RE.test(f.name || '') && !/^(audio|video)\//.test(f.type || '')) { setError('That file type is not supported. Try MP3, WAV, M4A, MP4, MKV or MOV.'); return; }
    setError('');
    setFile(f);
  };

  const start = async () => {
    setError(''); setBusy(true); setUpload({ percent: 0 });
    const fd = new FormData();
    fd.append('file', file);
    fd.append('source_language', sourceLang);
    try {
      const res = await xhrPostForm(api('/jobs'), fd, { onProgress: setUpload });
      if (!res.ok) {
        if (res.status === 402) return; // the out-of-hours notice is already showing
        throw new Error(typeof res.data?.detail === 'string' ? res.data.detail : `Upload failed (${res.status}).`);
      }
      await refresh(res.data.job_id);
    } catch (e) { setError(e.message); } finally { setBusy(false); setUpload(null); }
  };

  const run = async (fn) => {
    setError(''); setBusy(true);
    try { await fn(); await refresh(jobId); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const saveEdits = () => post(`/jobs/${jobId}/edit`, { lines: edits, voice_modes: modes });
  const translate = () => run(async () => { await saveEdits(); await post(`/jobs/${jobId}/translate`, { target_language: targetLang }); });
  const render = () => run(async () => { await saveEdits(); await post(`/jobs/${jobId}/render`, { consent: true, voice_modes: modes }); });
  const cancel = () => post(`/jobs/${jobId}/cancel`).then(() => refresh(jobId)).catch((e) => setError(e.message));
  const reset = async () => {
    if (jobId) fetch(api(`/jobs/${jobId}`), { method: 'DELETE' }).catch(() => {});
    setJob(null); setFile(null); setError(''); setEdits({}); setConsent(false); setTargetLang('');
  };

  const saveBlob = async (path, name) => {
    try {
      const res = await fetch(api(path));
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

  const step = stepOf(job);
  const status = job?.status;
  const lines = useMemo(() => job?.segments || [], [job]);
  const tooLong = useMemo(() => {
    if (!job?.translations || !job.target_language) return new Set();
    const cps = CPS[job.target_language] || 14;
    return new Set(lines.filter((s) => (edits[s.id] ?? job.translations[s.id] ?? '').length > (s.end - s.start) * cps * 1.15).map((s) => s.id));
  }, [job, lines, edits]);
  const isVideo = file && VIDEO_RE.test(file.name);
  const FileIcon = isVideo ? FileVideo : FileAudio;
  const ready = config?.elevenlabs_configured !== false;

  return (
    <div className="min-h-screen flex flex-col bg-[var(--kt-s0)] text-[var(--kt-text)]" style={{ fontFamily: 'var(--kt-font-ui)' }}>
      <header className="h-14 px-4 sm:px-6 flex items-center justify-between border-b border-[var(--kt-s4)]/70 sticky top-0 z-30 bg-[var(--kt-s1)]">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onBackToHome} aria-label="Back to home" title="Back to home"
            className="h-8 w-8 rounded-lg grid place-items-center text-[var(--kt-muted)] hover:text-white hover:bg-[var(--kt-s3)] cursor-pointer"><ArrowLeft size={16} /></button>
          <BrandLogo size={26} />
          <span className="font-semibold text-sm">Dubbing Studio</span>
          <span className="text-[10px] font-bold px-1.5 rounded bg-[var(--kt-accent)]/15 text-[var(--kt-accent)] border border-[var(--kt-accent)]/30 uppercase">Beta</span>
        </div>
        <AccountMenuDropdown user={user} onOpenLogoutModal={onOpenLogoutModal} />
      </header>

      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-6 flex flex-col gap-5">
        <ol className="flex items-center gap-2 text-xs">
          {STEPS.map((s, i) => (
            <li key={s} className="flex items-center gap-2">
              <span className={`h-6 min-w-6 px-2 rounded-full grid place-items-center font-semibold ${i < step ? 'bg-[var(--kt-success)]/20 text-[var(--kt-success)]' : i === step ? 'text-white' : 'bg-[var(--kt-s3)] text-[var(--kt-faint)]'}`}
                style={i === step ? { background: GRAD } : undefined}>{i < step ? <CheckCircle2 size={13} /> : i + 1}</span>
              <span className={i === step ? 'font-semibold' : 'text-[var(--kt-faint)]'}>{s}</span>
              {i < STEPS.length - 1 ? <span className="w-6 h-px bg-[var(--kt-s4)]" /> : null}
            </li>
          ))}
        </ol>

        {(error || job?.error) && status !== 'analyzing' ? (
          <div className="rounded-lg border border-[var(--kt-danger)]/40 bg-[var(--kt-danger)]/10 px-4 py-3 text-sm flex items-start gap-2">
            <AlertTriangle size={16} className="text-[var(--kt-danger)] mt-0.5 shrink-0" />
            <span className="flex-1">{error || job.error}</span>
            <button type="button" onClick={() => setError('')} aria-label="Dismiss" className="text-[var(--kt-faint)] hover:text-white cursor-pointer"><X size={14} /></button>
          </div>
        ) : null}

        {!ready && !job ? (
          <div className="rounded-lg border border-[var(--kt-warn)]/40 bg-[var(--kt-warn)]/10 px-4 py-3 text-sm">
            Dubbing needs the ElevenLabs key on the server. Ask your administrator to set ELEVENLABS_API_KEY (a paid ElevenLabs plan is needed for voice cloning).
          </div>
        ) : null}

        {/* 1. Upload */}
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
                <span className="text-xs text-[var(--kt-faint)]">or click to browse. We transcribe it first, learn how each speaker sounds, then dub it in another language.</span>
              </button>
            ) : (
              <div className="p-5 flex flex-col gap-4">
                <div className="flex items-center gap-3">
                  <span className="h-10 w-10 rounded-lg grid place-items-center bg-[var(--kt-s3)] text-[var(--kt-accent)]"><FileIcon size={18} /></span>
                  <div className="min-w-0 flex-1"><div className="text-sm font-medium truncate">{file.name}</div><div className="text-xs text-[var(--kt-faint)]">{formatBytes(file.size)}</div></div>
                  {!busy ? <button type="button" onClick={() => setFile(null)} aria-label="Remove file" className="h-7 w-7 grid place-items-center rounded-md text-[var(--kt-faint)] hover:text-white hover:bg-[var(--kt-s3)] cursor-pointer"><X size={14} /></button> : null}
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <span className="text-[var(--kt-muted)]">Spoken language</span>
                  <select value={sourceLang} onChange={(e) => setSourceLang(e.target.value)} disabled={busy}
                    className="h-8 rounded-md bg-[var(--kt-s2)] border border-[var(--kt-s5)] px-2 text-sm">
                    <option>Auto-Detect</option>
                    {(config?.languages || ['Hindi', 'English']).map((l) => <option key={l}>{l}</option>)}
                  </select>
                </label>
                <p className="text-xs text-[var(--kt-faint)]">Dubbing uses your hours for the full length of the file, the same as transcribing it. The hours are held now and only charged once the transcript is done.</p>
                {upload ? <Bar percent={upload.percent} label="Uploading" sub={`${formatSpeed(upload.speed)} ${formatEta(upload.eta)}`.trim()} /> : null}
                <div><Btn primary icon={Mic2} onClick={start} disabled={busy || !ready}>Analyse speakers</Btn></div>
              </div>
            )}
          </section>
        ) : null}

        {/* running */}
        {job && RUNNING.has(status) ? (
          <>
            <Bar percent={job.percent}
              label={status === 'analyzing' ? 'Transcribing and profiling the speakers' : status === 'translating' ? 'Translating for dubbing' : 'Generating the dubbed voices'}
              sub={job.detail} />
            <div><Btn onClick={cancel} icon={X}>Cancel</Btn></div>
          </>
        ) : null}

        {job && status === 'error' ? (
          <div className="flex gap-2"><Btn primary icon={RotateCcw} onClick={reset}>Start over</Btn></div>
        ) : null}

        {/* 2. Speakers */}
        {job && ['analyzed', 'translated', 'done'].includes(status) ? (
          <section>
            <div className="flex items-center gap-2 mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--kt-faint)]"><Users size={13} /> Speakers · {job.source_language}</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {Object.entries(job.profiles || {}).map(([name, p]) => (
                <div key={name} className="rounded-xl border border-[var(--kt-s4)] bg-[var(--kt-s1)] p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-semibold text-sm">{name}</div>
                    <div className="text-xs text-[var(--kt-faint)]">{fmtTime(p.talk_seconds || 0)} speaking · {p.lines} lines</div>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    <Chip>{p.gender}</Chip><Chip>{p.age_range}</Chip>
                    {(p.tone || []).map((t) => <Chip key={t}>{t}</Chip>)}
                    <Chip>{p.pace} pace · {Math.round(p.words_per_minute || 0)} wpm</Chip><Chip>{p.energy} energy</Chip>
                  </div>
                  <div className="text-xs text-[var(--kt-muted)] mt-2">Accent: {p.accent}</div>
                  {p.voice_description ? <div className="text-xs text-[var(--kt-faint)] mt-1">{p.voice_description}</div> : null}
                  {p.source === 'defaults' ? <div className="text-xs text-[var(--kt-warn)] mt-1">AI profiling was not available, so these are defaults.</div> : null}
                  <div className="mt-3 flex items-center gap-2 text-xs">
                    <span className="text-[var(--kt-muted)]">Voice</span>
                    {['clone', 'stock'].map((m) => (
                      <button key={m} type="button" disabled={status === 'analyzing' || busy} onClick={() => setModes((x) => ({ ...x, [name]: m }))}
                        className={`h-7 px-2.5 rounded-md border cursor-pointer ${modes[name] === m ? 'border-[var(--kt-accent)] bg-[var(--kt-accent)]/15 text-white' : 'border-[var(--kt-s5)] text-[var(--kt-muted)] hover:bg-[var(--kt-s3)]'}`}>
                        {m === 'clone' ? 'Clone their voice' : 'Stock voice'}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {/* 3. Translate */}
        {job && status === 'analyzed' ? (
          <section className="rounded-xl border border-[var(--kt-s4)] bg-[var(--kt-s1)] p-4 flex flex-wrap items-center gap-3">
            <Languages size={16} className="text-[var(--kt-accent)]" />
            <span className="text-sm">Dub into</span>
            <select value={targetLang} onChange={(e) => setTargetLang(e.target.value)} className="h-8 rounded-md bg-[var(--kt-s2)] border border-[var(--kt-s5)] px-2 text-sm">
              {(config?.languages || ['Hindi', 'English']).filter((l) => l !== job.source_language).map((l) => <option key={l}>{l}</option>)}
            </select>
            <Btn primary icon={Wand2} onClick={translate} disabled={busy || !targetLang}>Translate for dubbing</Btn>
            <Btn onClick={reset} icon={RotateCcw}>Different file</Btn>
          </section>
        ) : null}

        {/* review lines + render */}
        {job && ['translated', 'done'].includes(status) ? (
          <section>
            <div className="flex items-center gap-2 mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--kt-faint)]"><FileText size={13} /> Lines · {job.source_language} to {job.target_language}</div>
            <div className="rounded-xl border border-[var(--kt-s4)] bg-[var(--kt-s1)] divide-y divide-[var(--kt-s4)] max-h-[480px] overflow-auto">
              {lines.map((s) => (
                <div key={s.id} className="px-3.5 py-2.5 grid grid-cols-1 md:grid-cols-[150px_1fr_1fr] gap-2 text-sm">
                  <div className="text-xs text-[var(--kt-faint)]">{s.speaker}<br />{fmtTime(s.start)} · {(s.end - s.start).toFixed(1)}s</div>
                  <div className="text-[var(--kt-muted)]" style={{ fontFamily: 'var(--kt-font-script)' }}>{s.text}</div>
                  <div>
                    <textarea rows={2} value={edits[s.id] ?? job.translations[s.id] ?? ''} disabled={busy}
                      onChange={(e) => setEdits((x) => ({ ...x, [s.id]: e.target.value }))}
                      className={`w-full rounded-md bg-[var(--kt-s2)] border px-2 py-1 text-sm resize-y ${tooLong.has(s.id) ? 'border-[var(--kt-warn)]' : 'border-[var(--kt-s5)]'}`}
                      style={{ fontFamily: 'var(--kt-font-script)' }} />
                    {tooLong.has(s.id) ? <div className="text-[11px] text-[var(--kt-warn)]">Long for this slot. The voice may be sped up or the line shortened.</div> : null}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 rounded-xl border border-[var(--kt-s4)] bg-[var(--kt-s1)] p-4 flex flex-col gap-3">
              <label className="flex items-start gap-2 text-xs text-[var(--kt-muted)] cursor-pointer">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />
                <span>I have the right to clone the voices in this recording, and I understand the dubbed voices are AI-generated.</span>
              </label>
              <div className="flex flex-wrap gap-2">
                <Btn primary icon={Volume2} onClick={render} disabled={busy || !consent}>{status === 'done' ? 'Generate dub again' : 'Generate dub'}</Btn>
                <Btn icon={Languages} onClick={() => run(saveEdits)} disabled={busy || !Object.keys(edits).length}>Save edits</Btn>
                <Btn icon={RotateCcw} onClick={reset}>New file</Btn>
              </div>
            </div>
          </section>
        ) : null}

        {/* 4. Result */}
        {job && status === 'done' ? (
          <section className="rounded-xl border border-[var(--kt-success)]/40 bg-[var(--kt-s1)] p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold"><CheckCircle2 size={16} className="text-[var(--kt-success)]" /> Your dub is ready</div>
            {audioUrl ? <audio controls src={audioUrl} className="w-full" /> : <div className="text-xs text-[var(--kt-faint)]">Loading preview...</div>}
            {job.has_video ? (videoUrl ? <video controls src={videoUrl} className="w-full max-h-[420px] rounded-lg bg-black" /> : <div><Btn icon={Play} onClick={loadVideo} disabled={busy}>Preview the dubbed video</Btn></div>) : null}
            <div className="flex flex-wrap gap-2">
              <Btn primary icon={Download} onClick={() => saveBlob(`/jobs/${job.id}/download/audio`, `${job.filename.replace(/\.[^.]+$/, '')}.${job.target_language}.dub.mp3`)}>Dubbed audio</Btn>
              {job.outputs?.files?.video ? <Btn icon={Download} onClick={() => saveBlob(`/jobs/${job.id}/download/video`, `${job.filename.replace(/\.[^.]+$/, '')}.${job.target_language}.dub.mp4`)}>Video with new audio</Btn> : null}
              {Object.keys(job.outputs?.files?.speakers || {}).map((n) => (
                <Btn key={n} icon={Download} onClick={() => saveBlob(`/jobs/${job.id}/download/speaker?speaker=${encodeURIComponent(n)}`, `${n.replace(/\s+/g, '_')}.${job.target_language}.mp3`)}>{n} lines</Btn>
              ))}
            </div>
            {(job.outputs?.notes || []).map((n) => <div key={n} className="text-xs text-[var(--kt-warn)]">{n}</div>)}
            <div className="text-xs text-[var(--kt-faint)]">
              Voices used: {Object.entries(job.outputs?.voices || {}).map(([n, v]) => `${n} (${v.mode === 'clone' ? 'cloned' : 'stock'})`).join(', ')}. The dub replaces the original audio track.
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
