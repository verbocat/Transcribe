import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  X, Languages, ShieldCheck, Download, Upload, Check, AlertTriangle, Wand2, Loader2, ChevronDown,
  ChevronRight, Package, FileInput, ArrowLeftRight, BadgeCheck, Eye, EyeOff, Crosshair, Plus,
} from 'lucide-react';
import { API_BASE } from '../../config';
import { parseSrtText, cuesToSrt, downloadBlob, buildZip } from '../../utils/centroidSrt';
import { Button, IconButton, Segmented, Select, TextInput, Switch, Badge } from './ui/controls';

const COMMON = [
  ['en', 'English'], ['hi', 'Hindi'], ['bn', 'Bengali'], ['ta', 'Tamil'], ['te', 'Telugu'], ['mr', 'Marathi'],
  ['gu', 'Gujarati'], ['kn', 'Kannada'], ['ml', 'Malayalam'], ['pa', 'Punjabi'], ['ur', 'Urdu'],
  ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['ar', 'Arabic'],
];
const OTHERS = [
  ['ne', 'Nepali'], ['it', 'Italian'], ['pt', 'Portuguese'], ['pt-br', 'Portuguese (Brazil)'], ['ru', 'Russian'],
  ['tr', 'Turkish'], ['fa', 'Persian'], ['he', 'Hebrew'], ['zh', 'Chinese (Simplified)'], ['zht', 'Chinese (Traditional)'],
  ['ja', 'Japanese'], ['ko', 'Korean'], ['th', 'Thai'], ['vi', 'Vietnamese'], ['id', 'Indonesian'], ['ms', 'Malay'],
  ['nl', 'Dutch'], ['pl', 'Polish'], ['sv', 'Swedish'], ['uk', 'Ukrainian'], ['el', 'Greek'],
];
const ALL_LANGS = [...COMMON, ...OTHERS];
const langName = (code) => (ALL_LANGS.find(([c]) => c === code) || [code, code])[1];
const langOptions = (exclude) => [
  { group: 'Common', items: COMMON.filter(([c]) => c !== exclude) },
  { group: 'All languages', items: OTHERS.filter(([c]) => c !== exclude) },
];

const CONTENT_TYPES = ['Film', 'TV series', 'Documentary', 'Reality / unscripted', 'Animation / kids', 'Advertisement', 'E-learning / training', 'News / interview', 'Stand-up / comedy'];
const TONES = ['Neutral', 'Casual / colloquial', 'Formal', 'Humorous', 'Dramatic / emotional', 'Technical'];

// The editor's language setting uses a few codes Centroid doesn't know
const toCentroidLang = (code) => ({ auto: 'en', hinglish: 'hi' }[code] || code);

const fmtTime = (s) => {
  const t = Math.max(0, Number(s) || 0);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${(t % 60).toFixed(1).padStart(4, '0')}`;
};

async function api(path, body) {
  const res = await fetch(`${API_BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || data.error || `Request failed (${res.status})`);
  return data;
}

function parseGlossary(text) {
  return text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const [src, ...rest] = l.split(/\s*(?:=|->|=>)\s*/);
    const target = rest.join(' = ').trim();
    return { source: src.trim(), target: target || null, do_not_translate: !target };
  }).filter((g) => g.source);
}

const readStore = (key, fallback) => { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (_) { return fallback; } };
const writeStore = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* storage unavailable */ } };

function LangSelect({ value, onChange, exclude, label }) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 w-full min-w-0 rounded-lg border border-[var(--ss-line)] bg-[var(--ss-bg)] px-2.5 text-[13px] text-[var(--ss-text)] hover:border-[var(--ss-muted)] focus:border-[var(--ss-accent)] focus:outline-none cursor-pointer"
    >
      {langOptions(exclude).map((g) => (
        <optgroup key={g.group} label={g.group}>
          {g.items.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

function Field({ label, children, className = '' }) {
  return (
    <label className={`block ${className}`}>
      <span className="block mb-1 text-[11.5px] text-[var(--ss-muted)]">{label}</span>
      {children}
    </label>
  );
}

function Collapsible({ title, hint, open, setOpen, children }) {
  return (
    <section className="rounded-xl border border-[var(--ss-line)] bg-[var(--ss-raised)]/40">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="w-full h-10 px-3 flex items-center gap-2 text-left cursor-pointer">
        {open ? <ChevronDown size={14} className="text-[var(--ss-muted)]" /> : <ChevronRight size={14} className="text-[var(--ss-muted)]" />}
        <span className="text-[12.5px] font-medium text-[var(--ss-text)]">{title}</span>
        <span className="ml-auto text-[11.5px] text-[var(--ss-faint)] truncate">{hint}</span>
      </button>
      {open && <div className="px-3 pb-3 pt-1 border-t border-[var(--ss-line)]/70">{children}</div>}
    </section>
  );
}

function Stat({ label, value, tone }) {
  const color = tone === 'good' ? 'text-emerald-400' : tone === 'warn' ? 'text-[var(--ss-warn)]' : 'text-[var(--ss-danger)]';
  return (
    <div className="rounded-lg border border-[var(--ss-line)] bg-[var(--ss-raised)]/50 px-3 py-2">
      <div className="text-[11px] text-[var(--ss-faint)]">{label}</div>
      <div className={`text-[20px] font-semibold leading-tight ${color}`}>{value}</div>
    </div>
  );
}

const Notice = ({ tone = 'danger', children }) => {
  const tones = {
    danger: 'border-[var(--ss-danger)]/40 bg-[var(--ss-danger)]/10 text-[var(--ss-danger)]',
    warn: 'border-[var(--ss-warn)]/40 bg-[var(--ss-warn)]/10 text-[var(--ss-warn)]',
    good: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  };
  return <div role="status" className={`rounded-lg border px-3 py-2 text-[12px] leading-snug ${tones[tone]}`}>{children}</div>;
};

/**
 * Translate + Centroid QC drawer.
 * Flow: pick source and target language -> Translate -> "Run Centroid QC" appears on the result
 * (and on the tool rail) -> review issues, apply Centroid's fixes, download or open in the editor.
 * Stays mounted while closed so results survive.
 */
export default function CentroidModal({
  isOpen, onClose, events = [], glossaryTerms = [], cplLimit = 42, maxLines = 2, cpsLimit = 20,
  fileName = 'subtitles', defaultSourceLang = 'en', startTab = 'translate', startTabNonce = 0,
  onLoadEvents, onUpdateEvent, onJumpToEvent, onStateChange,
}) {
  const [tab, setTab] = useState('translate');
  const [status, setStatus] = useState(null);

  // ---- translate inputs ----
  const [sourceMode, setSourceMode] = useState('editor'); // 'editor' | 'upload'
  const [uploaded, setUploaded] = useState({ name: '', cues: [] });
  const [snapshot, setSnapshot] = useState([]); // source cues used for the last run (QC reference)
  const [sourceLang, setSourceLang] = useState(() => readStore('centroid_src_v2', null) || toCentroidLang(defaultSourceLang));
  const [targetLang, setTargetLang] = useState(() => readStore('centroid_tgt_v2', null) || 'hi');
  const [extraTargets, setExtraTargets] = useState([]);
  const [showMore, setShowMore] = useState(false);
  const [ctx, setCtx] = useState({ title: '', content_type: '', tone: '', synopsis: '', characters: '', notes: '' });
  const [glossaryText, setGlossaryText] = useState('');
  const [keepNames, setKeepNames] = useState(true);
  const [limits, setLimits] = useState({ max_cpl: cplLimit, max_lines: maxLines, max_cps: cpsLimit });
  const [autoQc, setAutoQc] = useState(() => readStore('centroid_autoqc_v2', false));
  const [open, setOpen] = useState({ ctx: false, gloss: false, limits: false });
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  const [results, setResults] = useState({}); // lang -> {cues, srt, warnings, stats}
  const [failedLangs, setFailedLangs] = useState({});
  const [previewLang, setPreviewLang] = useState(null);
  const fileRef = useRef(null);

  // ---- QC ----
  const [qcTarget, setQcTarget] = useState(''); // 'editor' | lang code
  const [qcBusy, setQcBusy] = useState(false);
  const [qc, setQc] = useState(null); // {summary, issues, target}
  const [qcFilter, setQcFilter] = useState('all');
  const [qcError, setQcError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    fetch(`${API_BASE}/api/centroid/status`).then((r) => r.json()).then(setStatus).catch(() => setStatus({ configured: false, reachable: false, error: 'Backend unreachable' }));
  }, [isOpen]);

  useEffect(() => { setLimits((l) => ({ ...l, max_cpl: cplLimit, max_lines: maxLines, max_cps: cpsLimit })); }, [cplLimit, maxLines, cpsLimit]);
  useEffect(() => { writeStore('centroid_src_v2', sourceLang); writeStore('centroid_tgt_v2', targetLang); }, [sourceLang, targetLang]);
  useEffect(() => { writeStore('centroid_autoqc_v2', autoQc); }, [autoQc]);

  // The rail asks for a specific tab ("Translate" vs "Centroid QC")
  useEffect(() => { if (isOpen) setTab(startTab); }, [startTab, startTabNonce, isOpen]);

  useEffect(() => {
    if (!busy) return undefined;
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 500);
    return () => { clearInterval(id); setElapsed(0); };
  }, [busy]);

  const resultLangs = Object.keys(results);
  const hasResults = resultLangs.length > 0;
  useEffect(() => { onStateChange?.({ hasResults, qcIssues: qc ? qc.issues.length : null }); }, [hasResults, qc, onStateChange]);

  const sourceCues = useMemo(() => {
    const raw = sourceMode === 'upload' ? uploaded.cues : events;
    return raw.filter((e) => (e.text || '').trim());
  }, [sourceMode, uploaded, events]);

  const targets = useMemo(() => [targetLang, ...extraTargets.filter((t) => t !== targetLang)].filter((t) => t !== sourceLang), [targetLang, extraTargets, sourceLang]);

  const buildContext = () => {
    const out = {};
    Object.entries(ctx).forEach(([k, v]) => { if (String(v).trim()) out[k] = String(v).trim(); });
    return out;
  };
  const buildGlossary = () => {
    const manual = parseGlossary(glossaryText);
    if (!keepNames) return manual;
    const have = new Set(manual.map((g) => g.source.toLowerCase()));
    const names = glossaryTerms
      .map((t) => (typeof t === 'string' ? t : t.term || t.source || ''))
      .filter((t) => t && !have.has(t.toLowerCase()))
      .map((t) => ({ source: t, target: null, do_not_translate: true }));
    return [...manual, ...names];
  };
  const buildLimits = () => ({ max_cpl: Number(limits.max_cpl) || 42, max_lines: Number(limits.max_lines) || 2, max_cps: Number(limits.max_cps) || 20 });

  const handleUpload = async (file) => {
    if (!file) return;
    const cues = parseSrtText(await file.text());
    if (!cues.length) { setError('That file has no readable subtitle cues. Use an .srt or .vtt file.'); return; }
    setError('');
    setUploaded({ name: file.name, cues });
    setSourceMode('upload');
  };

  const swapLanguages = () => {
    const s = sourceLang;
    setSourceLang(targetLang);
    setTargetLang(s);
  };

  /** Build source/target pairs for QC from a language result, or from the editor. */
  const pairsFor = useCallback((code, res, snap) => {
    if (!code || !snap.length) return { pairs: [], error: 'Translate first, so Centroid has the source text to compare against.' };
    if (code === 'editor') {
      const cur = events.filter((e) => (e.text || '').trim());
      if (cur.length !== snap.length) return { pairs: [], error: `The editor has ${cur.length} subtitles but the source has ${snap.length}. QC needs the same number of cues.` };
      return { pairs: snap.map((s, i) => ({ id: s.id, start: s.start_time, end: s.end_time, source: s.text, target: cur[i].text, editorId: cur[i].id ?? cur[i].event_id })) };
    }
    const r = res[code];
    if (!r) return { pairs: [], error: '' };
    return { pairs: r.cues.map((c, i) => ({ id: i + 1, start: c.start, end: c.end, source: c.source, target: c.target })) };
  }, [events]);

  const runQcFor = useCallback(async (code, res, snap) => {
    setQcError('');
    setTab('qc');
    setQcTarget(code);
    setQc(null);
    const { pairs, error: pe } = pairsFor(code, res, snap);
    if (pe) { setQcError(pe); return; }
    const lang = code === 'editor' ? targets[0] || sourceLang : code;
    setQcBusy(true);
    try {
      const data = await api('/api/centroid/qc', {
        cues: pairs, source_lang: sourceLang, target_lang: lang,
        context: buildContext(), glossary: buildGlossary(), constraints: buildLimits(), include_technical: true,
      });
      setQc({ ...data, target: code, issues: (data.issues || []).map((i, n) => ({ ...i, key: `${i.index}-${i.category}-${n}` })) });
    } catch (e) {
      setQcError(e.message);
    } finally {
      setQcBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairsFor, sourceLang, targets, ctx, glossaryText, keepNames, glossaryTerms, limits]);

  const runTranslate = async () => {
    setError('');
    if (!sourceCues.length) { setError('There are no subtitles to translate. Generate or import subtitles, or upload an SRT.'); return; }
    if (!targets.length) { setError('Pick a target language that differs from the source.'); return; }
    setBusy(true);
    try {
      const data = await api('/api/centroid/translate', {
        events: sourceCues.map((c) => ({ start_time: c.start_time ?? c.start, end_time: c.end_time ?? c.end, text: c.text })),
        source_lang: sourceLang, target_langs: targets, context: buildContext(), glossary: buildGlossary(), constraints: buildLimits(),
      });
      const snap = sourceCues.map((c, i) => ({ id: i + 1, editorId: c.id ?? c.event_id, start_time: c.start_time ?? c.start, end_time: c.end_time ?? c.end, text: c.text }));
      const res = data.results || {};
      setSnapshot(snap);
      setResults(res);
      setFailedLangs(data.errors || {});
      setQc(null);
      setQcError('');
      const first = Object.keys(res)[0] || '';
      setQcTarget(first);
      setPreviewLang(first || null);
      if (first && autoQc) runQcFor(first, res, snap);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const downloadLang = (code) => {
    const r = results[code];
    if (!r) return;
    downloadBlob(new Blob([r.srt], { type: 'text/plain;charset=utf-8' }), `${fileName.replace(/\.[^.]+$/, '')}.${code}.srt`);
  };
  const downloadAll = () => {
    const base = fileName.replace(/\.[^.]+$/, '');
    downloadBlob(buildZip(resultLangs.map((c) => ({ name: `${base}.${c}.srt`, content: results[c].srt }))), `${base}_translations.zip`);
  };
  const openInEditor = (code) => {
    const r = results[code];
    if (!r || !onLoadEvents) return;
    if (events.length && !window.confirm(`Replace the ${events.length} subtitles in the editor with the ${langName(code)} translation? You can undo this.`)) return;
    onLoadEvents(r.cues.map((c, i) => ({
      id: i + 1, event_id: i + 1, start_time: c.start, end_time: c.end, text: c.target || c.source,
      speaker: 'Speaker 1', qc_errors: [],
    })));
  };

  // ---- QC actions ----
  const qcPairs = useMemo(() => pairsFor(qcTarget, results, snapshot), [pairsFor, qcTarget, results, snapshot]);

  const dropIssue = (key) => setQc((q) => (q ? { ...q, issues: q.issues.filter((i) => i.key !== key) } : q));

  const applyFix = useCallback((issue) => {
    if (!issue.suggestion) return;
    if (qc?.target === 'editor') {
      const pair = qcPairs.pairs.find((p) => p.id === issue.index);
      if (pair && onUpdateEvent) onUpdateEvent(pair.editorId, 'text', issue.suggestion);
    } else {
      setResults((prev) => {
        const r = prev[qc.target];
        if (!r) return prev;
        const cues = r.cues.map((c) => (c.index === issue.index ? { ...c, target: issue.suggestion } : c));
        return { ...prev, [qc.target]: { ...r, cues, srt: cuesToSrt(cues.map((c) => ({ ...c, text: c.target || c.source })), 'text') } };
      });
    }
    // Other issues on the same cue were written against the old text.
    setQc((q) => (q ? { ...q, issues: q.issues.filter((i) => i.key !== issue.key && !(i.index === issue.index && i.suggestion)) } : q));
  }, [qc, qcPairs, onUpdateEvent]);

  const applyAll = () => {
    const seen = new Set();
    (qc?.issues || []).filter((i) => i.suggestion).forEach((i) => {
      if (seen.has(i.index)) return;
      seen.add(i.index);
      applyFix(i);
    });
  };

  const shownIssues = (qc?.issues || []).filter((i) => qcFilter === 'all' || i.severity === qcFilter);
  const fixable = (qc?.issues || []).filter((i) => i.suggestion).length;

  if (!isOpen) return null;

  const notReady = status && (!status.configured || !status.reachable);
  const editorCount = events.filter((e) => (e.text || '').trim()).length;
  const targetNames = targets.map(langName).join(', ');

  return (
    <aside
      role="dialog"
      aria-label="Translate with Centroid"
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}
      className="fixed top-0 bottom-0 right-0 z-[60] w-[560px] max-w-[96vw] flex flex-col border-l border-[var(--ss-line)] bg-[var(--ss-panel)] text-[var(--ss-text)] shadow-2xl"
    >
      {/* header */}
      <header className="shrink-0 flex items-center gap-2.5 px-5 h-14 border-b border-[var(--ss-line)]">
        <Languages size={17} className="text-[var(--ss-accent)]" />
        <div className="flex-1 min-w-0">
          <h2 className="text-[14px] font-semibold leading-tight">Translate</h2>
          <p className="text-[11.5px] text-[var(--ss-faint)]">Powered by Centroid</p>
        </div>
        {status?.reachable && <Badge tone="accent">Connected</Badge>}
        <IconButton icon={X} label="Close (Esc)" onClick={onClose} />
      </header>

      {/* steps: QC only appears once there is something to check */}
      {hasResults && (
      <div className="shrink-0 px-5 pt-3">
        <Segmented
          label="Step"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'translate', label: '1  Translate', icon: Languages },
            { value: 'qc', label: qc ? `2  Centroid QC · ${qc.issues.length}` : '2  Centroid QC', icon: BadgeCheck },
          ]}
        />
      </div>
      )}

      {notReady && (
        <div className="shrink-0 mx-5 mt-3">
          <Notice tone="warn">
            <span className="flex gap-2"><AlertTriangle size={14} className="shrink-0 mt-px" />
              {!status.configured
                ? 'Centroid is not connected. Add CENTROID_API_URL and CENTROID_API_KEY to backend/.env and restart the backend.'
                : `Centroid could not be reached${status.error ? ` (${status.error})` : ''}. Check CENTROID_API_URL and the API key.`}
            </span>
          </Notice>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4" data-lenis-prevent>
        {tab === 'translate' && (
          <>
            {/* source */}
            <section>
              <h3 className="text-[12.5px] font-semibold mb-2">What to translate</h3>
              <Segmented
                label="Source subtitles"
                value={sourceMode}
                onChange={(m) => { if (m === 'upload' && !uploaded.cues.length) fileRef.current?.click(); else setSourceMode(m); }}
                options={[
                  { value: 'editor', label: `Editor subtitles (${editorCount})` },
                  { value: 'upload', label: uploaded.name ? `${uploaded.name} (${uploaded.cues.length})` : 'Upload SRT / VTT', icon: FileInput },
                ]}
              />
              {uploaded.name && <button type="button" onClick={() => fileRef.current?.click()} className="mt-1.5 text-[11.5px] text-[var(--ss-muted)] hover:text-[var(--ss-text)] underline cursor-pointer">Choose a different file</button>}
              <input ref={fileRef} type="file" accept=".srt,.vtt,.txt" className="hidden" onChange={(e) => { handleUpload(e.target.files?.[0]); e.target.value = ''; }} />
            </section>

            {/* languages */}
            <section>
              <h3 className="text-[12.5px] font-semibold mb-2">Languages</h3>
              <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
                <Field label="From"><LangSelect label="Source language" value={sourceLang} onChange={setSourceLang} exclude={targetLang} /></Field>
                <IconButton icon={ArrowLeftRight} label="Swap languages" variant="secondary" size="lg" onClick={swapLanguages} />
                <Field label="To"><LangSelect label="Target language" value={targetLang} onChange={setTargetLang} exclude={sourceLang} /></Field>
              </div>
              <button type="button" onClick={() => setShowMore((v) => !v)} className="mt-2 text-[12px] text-[var(--ss-accent)] hover:underline cursor-pointer inline-flex items-center gap-1">
                <Plus size={12} /> {showMore ? 'Hide extra languages' : `Also translate into more languages${extraTargets.length ? ` (${extraTargets.length})` : ''}`}
              </button>
              {showMore && (
                <div className="mt-2 flex flex-wrap gap-1.5 max-h-36 overflow-y-auto">
                  {ALL_LANGS.filter(([c]) => c !== sourceLang && c !== targetLang).map(([c, n]) => {
                    const on = extraTargets.includes(c);
                    return (
                      <button
                        key={c}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setExtraTargets((t) => (t.includes(c) ? t.filter((x) => x !== c) : [...t, c]))}
                        className={`h-7 px-2.5 rounded-md border text-[12px] inline-flex items-center gap-1 cursor-pointer transition-colors ${on ? 'border-[var(--ss-accent)] bg-[var(--ss-accent)]/15 text-[var(--ss-text)]' : 'border-[var(--ss-line)] text-[var(--ss-muted)] hover:text-[var(--ss-text)]'}`}
                      >
                        {on && <Check size={11} />}{n}
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            {/* optional detail */}
            <Collapsible title="Context" hint="Optional · improves names, gender and tone" open={open.ctx} setOpen={(v) => setOpen((o) => ({ ...o, ctx: v }))}>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Title"><TextInput value={ctx.title} onChange={(e) => setCtx({ ...ctx, title: e.target.value })} placeholder="e.g. The Last Train" /></Field>
                <Field label="Content type"><Select label="Content type" value={ctx.content_type} onChange={(v) => setCtx({ ...ctx, content_type: v })} options={[{ value: '', label: 'Not specified' }, ...CONTENT_TYPES.map((t) => ({ value: t, label: t }))]} className="w-full" /></Field>
                <Field label="Tone / register" className="col-span-2"><Select label="Tone" value={ctx.tone} onChange={(v) => setCtx({ ...ctx, tone: v })} options={[{ value: '', label: 'Not specified' }, ...TONES.map((t) => ({ value: t, label: t }))]} className="w-full" /></Field>
                <Field label="Synopsis" className="col-span-2"><textarea rows={2} className="w-full rounded-lg border border-[var(--ss-line)] bg-[var(--ss-bg)] px-2.5 py-1.5 text-[12px] placeholder:text-[var(--ss-faint)] focus:border-[var(--ss-accent)] focus:outline-none" value={ctx.synopsis} onChange={(e) => setCtx({ ...ctx, synopsis: e.target.value })} placeholder="What is this about? Setting, plot, topic." /></Field>
                <Field label="Characters / speakers" className="col-span-2"><textarea rows={2} className="w-full rounded-lg border border-[var(--ss-line)] bg-[var(--ss-bg)] px-2.5 py-1.5 text-[12px] placeholder:text-[var(--ss-faint)] focus:border-[var(--ss-accent)] focus:outline-none" value={ctx.characters} onChange={(e) => setCtx({ ...ctx, characters: e.target.value })} placeholder="Raj (male, 30s, narrator); Meera (female, his boss, formal with Raj)" /></Field>
                <Field label="Extra instructions" className="col-span-2"><TextInput value={ctx.notes} onChange={(e) => setCtx({ ...ctx, notes: e.target.value })} placeholder="e.g. keep swear words mild, use ‘aap’ not ‘tum’" /></Field>
              </div>
            </Collapsible>

            <Collapsible title="Glossary" hint={`${buildGlossary().length} term${buildGlossary().length === 1 ? '' : 's'}`} open={open.gloss} setOpen={(v) => setOpen((o) => ({ ...o, gloss: v }))}>
              <div className="flex items-center justify-between gap-3 py-1.5">
                <div className="min-w-0">
                  <div className="text-[12.5px]">Keep my glossary names untranslated</div>
                  <div className="text-[11.5px] text-[var(--ss-faint)]">{glossaryTerms.length} term{glossaryTerms.length === 1 ? '' : 's'} from Settings → Glossary</div>
                </div>
                <Switch checked={keepNames} onChange={setKeepNames} label="Keep glossary names untranslated" />
              </div>
              <textarea
                rows={4}
                className="mt-1 w-full rounded-lg border border-[var(--ss-line)] bg-[var(--ss-bg)] px-2.5 py-1.5 font-mono text-[12px] placeholder:text-[var(--ss-faint)] focus:border-[var(--ss-accent)] focus:outline-none"
                value={glossaryText}
                onChange={(e) => setGlossaryText(e.target.value)}
                placeholder={'One per line.\nAcme Corp        (kept as is)\nsubscriber = सब्सक्राइबर   (forced translation)'}
                aria-label="Extra glossary terms"
              />
            </Collapsible>

            <Collapsible title="Subtitle limits" hint={`${limits.max_cpl} chars · ${limits.max_lines} lines · ${limits.max_cps} cps`} open={open.limits} setOpen={(v) => setOpen((o) => ({ ...o, limits: v }))}>
              <div className="grid grid-cols-3 gap-3">
                {[['max_cpl', 'Characters / line'], ['max_lines', 'Max lines'], ['max_cps', 'Max cps']].map(([k, l]) => (
                  <Field key={k} label={l}><TextInput type="number" value={limits[k]} onChange={(e) => setLimits({ ...limits, [k]: e.target.value })} /></Field>
                ))}
              </div>
              <p className="mt-2 text-[11.5px] text-[var(--ss-faint)]">Starts from your Settings → Timing &amp; QC values.</p>
            </Collapsible>

            <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--ss-line)] px-3 py-2.5">
              <div className="min-w-0">
                <div className="text-[12.5px]">Run Centroid QC automatically</div>
                <div className="text-[11.5px] text-[var(--ss-faint)]">Check the translation as soon as it finishes</div>
              </div>
              <Switch checked={autoQc} onChange={setAutoQc} label="Run Centroid QC automatically" />
            </div>

            {error && <Notice>{error}</Notice>}

            {/* results */}
            {hasResults && (
              <section className="space-y-2.5 pt-1">
                <div className="flex items-center justify-between">
                  <h3 className="text-[12.5px] font-semibold">Translation ready</h3>
                  {resultLangs.length > 1 && <Button size="sm" variant="ghost" icon={Package} onClick={downloadAll}>Download all (.zip)</Button>}
                </div>
                {resultLangs.map((code) => {
                  const r = results[code];
                  const showing = previewLang === code;
                  return (
                    <div key={code} className="rounded-xl border border-[var(--ss-line)] bg-[var(--ss-raised)]/50 p-3">
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-semibold">{langName(sourceLang)} → {langName(code)}</div>
                          <div className="text-[11.5px] text-[var(--ss-faint)]">
                            {r.stats.cues} cues{r.stats.failed ? ` · ${r.stats.failed} failed` : ''}{r.warnings.length ? ` · ${r.warnings.length} limit warnings` : ' · no limit warnings'}
                          </div>
                        </div>
                        <IconButton size="sm" icon={showing ? EyeOff : Eye} label={showing ? 'Hide preview' : 'Preview translation'} onClick={() => setPreviewLang(showing ? null : code)} />
                      </div>
                      {showing && (
                        <ul className="mt-2.5 max-h-52 overflow-y-auto rounded-lg border border-[var(--ss-line)] divide-y divide-[var(--ss-line)]/60 bg-[var(--ss-bg)]">
                          {r.cues.slice(0, 40).map((c, i) => (
                            <li key={i} className="px-2.5 py-1.5 text-[12px]">
                              <div className="text-[var(--ss-faint)]">{c.source}</div>
                              <div className="text-[var(--ss-text)] whitespace-pre-wrap">{c.target}</div>
                            </li>
                          ))}
                          {r.cues.length > 40 && <li className="px-2.5 py-1.5 text-[11.5px] text-[var(--ss-faint)]">+ {r.cues.length - 40} more. Open in editor to see them all.</li>}
                        </ul>
                      )}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button variant="primary" icon={BadgeCheck} onClick={() => runQcFor(code, results, snapshot)} disabled={qcBusy || notReady}>Run Centroid QC</Button>
                        <Button icon={Download} onClick={() => downloadLang(code)}>Download SRT</Button>
                        <Button icon={Upload} onClick={() => openInEditor(code)}>Open in editor</Button>
                      </div>
                    </div>
                  );
                })}
                {Object.entries(failedLangs).map(([c, m]) => <Notice key={c}>{langName(c)} failed: {m}</Notice>)}
              </section>
            )}
          </>
        )}

        {tab === 'qc' && (
          <>
            <section className="flex flex-wrap items-end gap-3">
              <Field label="Checking" className="flex-1 min-w-[200px]">
                <Select
                  label="Translation to check"
                  value={qcTarget}
                  onChange={(v) => { setQcTarget(v); setQc(null); setQcError(''); }}
                  className="w-full"
                  options={[
                    ...(qcTarget ? [] : [{ value: '', label: 'Choose…' }]),
                    ...resultLangs.map((c) => ({ value: c, label: `${langName(sourceLang)} → ${langName(c)}` })),
                    ...(snapshot.length ? [{ value: 'editor', label: 'Current editor subtitles' }] : []),
                  ]}
                />
              </Field>
              <Button variant="primary" size="lg" icon={qcBusy ? Loader2 : ShieldCheck} disabled={qcBusy || !qcTarget || notReady} onClick={() => runQcFor(qcTarget, results, snapshot)}>
                {qcBusy ? 'Checking…' : qc ? 'Run again' : 'Run Centroid QC'}
              </Button>
            </section>

            {qcBusy && <Notice tone="good"><span className="inline-flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Centroid is reviewing every cue against its source. This can take a minute.</span></Notice>}
            {qcError && <Notice>{qcError}</Notice>}

            {qc && (
              <>
                <div className="grid grid-cols-4 gap-2">
                  <Stat label="MQM score" value={qc.summary.mqm_score} tone={qc.summary.mqm_score >= 95 ? 'good' : qc.summary.mqm_score >= 85 ? 'warn' : 'bad'} />
                  <Stat label="Errors" value={qc.summary.error_count} tone={qc.summary.error_count ? 'bad' : 'good'} />
                  <Stat label="Warnings" value={qc.summary.warning_count} tone={qc.summary.warning_count ? 'warn' : 'good'} />
                  <Stat label="Clean cues" value={`${qc.summary.clean_percentage}%`} tone="good" />
                </div>
                {!qc.summary.ai_checked && <Notice tone="warn">The AI review didn’t complete for part of the file, so only rule-based checks are shown for it. Run QC again to retry.</Notice>}

                <div className="flex items-center gap-2">
                  <Segmented label="Filter issues" value={qcFilter} onChange={setQcFilter} className="w-60" options={[{ value: 'all', label: 'All' }, { value: 'error', label: 'Errors' }, { value: 'warning', label: 'Warnings' }]} />
                  <span className="flex-1" />
                  {fixable > 0 && <Button variant="primary" icon={Wand2} onClick={applyAll}>Apply all {fixable} fixes</Button>}
                </div>

                {qc.issues.length === 0 && <Notice tone="good">No issues left. The translation passed Centroid QC.</Notice>}

                <div className="space-y-2.5">
                  {shownIssues.map((i) => {
                    const pair = qc.target === 'editor' ? qcPairs.pairs.find((p) => p.id === i.index) : null;
                    return (
                      <article key={i.key} className="rounded-xl border border-[var(--ss-line)] bg-[var(--ss-raised)]/50 p-3 text-[12.5px] space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-[11.5px] text-[var(--ss-faint)]">#{i.index} · {fmtTime(i.start)}</span>
                          <Badge tone={i.severity === 'error' ? 'danger' : 'warn'}>{i.mqm_severity}</Badge>
                          <span className="font-medium">{i.title}</span>
                          {i.origin === 'ai' && <span className="text-[11px] text-[var(--ss-faint)]">AI review</span>}
                          {pair && onJumpToEvent && (
                            <IconButton size="sm" icon={Crosshair} label="Show this subtitle in the editor" className="ml-auto" onClick={() => onJumpToEvent(pair.editorId)} />
                          )}
                        </div>
                        <p className="text-[var(--ss-muted)] leading-snug">{i.description}</p>
                        <div className="grid grid-cols-2 gap-2">
                          <div><div className="text-[11px] text-[var(--ss-faint)]">Source</div><div className="whitespace-pre-wrap">{i.source}</div></div>
                          <div><div className="text-[11px] text-[var(--ss-faint)]">Current</div><div className="whitespace-pre-wrap text-[var(--ss-danger)]">{i.target || '(empty)'}</div></div>
                        </div>
                        {i.suggestion && (
                          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-2.5 py-2">
                            <div className="text-[11px] text-emerald-400">Suggested fix</div>
                            <div className="whitespace-pre-wrap text-emerald-100">{i.suggestion}</div>
                          </div>
                        )}
                        <div className="flex gap-2">
                          {i.suggestion && <Button size="sm" variant="primary" icon={Check} onClick={() => applyFix(i)}>Apply fix</Button>}
                          <Button size="sm" variant="ghost" onClick={() => dropIssue(i.key)}>Dismiss</Button>
                        </div>
                      </article>
                    );
                  })}
                </div>

                {qc.target !== 'editor' && results[qc.target] && (
                  <div className="flex gap-2 pt-1">
                    <Button icon={Download} onClick={() => downloadLang(qc.target)}>Download corrected SRT</Button>
                    <Button icon={Upload} onClick={() => openInEditor(qc.target)}>Open in editor</Button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* sticky primary action */}
      {tab === 'translate' && (
        <footer className="shrink-0 px-5 py-3 border-t border-[var(--ss-line)]">
          <Button variant="primary" size="lg" className="w-full" icon={busy ? Loader2 : Languages} disabled={busy || notReady || !sourceCues.length} onClick={runTranslate}>
            {busy
              ? `Translating ${sourceCues.length} subtitles… ${elapsed}s`
              : hasResults ? `Translate again · ${sourceCues.length} subtitles → ${targetNames || '…'}` : `Translate ${sourceCues.length} subtitles → ${targetNames || '…'}`}
          </Button>
          {!sourceCues.length && <p className="mt-1.5 text-center text-[11.5px] text-[var(--ss-faint)]">Generate or import subtitles first, or upload an SRT above.</p>}
        </footer>
      )}
    </aside>
  );
}
