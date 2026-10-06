import React, { useMemo, useRef, useState } from 'react';
import { Check, Download, Eye, EyeOff, FileUp, Search, Trash2, Upload, RotateCcw, X } from 'lucide-react';
import { API_BASE, setCustomApiBase, cleanUrl } from '../../../config';
import { Button, Segmented, Section, Row, SwitchRow, Slider, Select, TextInput, Badge, Kbd } from '../ui/controls';
import { SHORTCUT_GROUPS } from '../shortcuts';
import { AUTOSAVE_CHOICES, DEFAULT_PREFS } from '../prefs';

/* ─────────────────────────── Timing & QC ─────────────────────────── */

const QC_PRESETS = [
  { name: 'Netflix Latin / Indic', desc: '42 CPL · 20 CPS · 2 lines', cpl: 42, cps: 20, type: 'adult' },
  { name: 'Netflix Kids', desc: '42 CPL · 17 CPS · 2 lines', cpl: 42, cps: 17, type: 'children' },
  { name: 'Netflix Japanese', desc: '16 CPL · 7.5 CPS', cpl: 16, cps: 7.5, lang: 'ja' },
  { name: 'Netflix Korean', desc: '16 CPL · 10.5 CPS', cpl: 16, cps: 10.5, lang: 'ko' },
  { name: 'Netflix Chinese', desc: '16 CPL · 9.5 CPS', cpl: 16, cps: 9.5, lang: 'zh' },
];

const FPS_CHOICES = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60];

export const QC_DEFAULTS = { cpl: 42, cps: 20, maxLines: 2, minDur: 0.833, maxDur: 7.0, fps: 24, type: 'adult' };

export function resetQcDefaults(c) {
  c.setCplLimit(QC_DEFAULTS.cpl);
  c.setCpsLimit(QC_DEFAULTS.cps);
  c.setMaxLines(QC_DEFAULTS.maxLines);
  c.setMinDuration(QC_DEFAULTS.minDur);
  c.setMaxDuration(QC_DEFAULTS.maxDur);
  c.setContentType(QC_DEFAULTS.type);
  c.setSnapToShotChanges(true);
  c.setFrameRate(QC_DEFAULTS.fps);
}

export function QcPage({ c }) {
  const applyPreset = (p) => {
    c.setCplLimit(p.cpl);
    c.setCpsLimit(p.cps);
    c.setMaxLines(2);
    c.setMinDuration(QC_DEFAULTS.minDur);
    c.setMaxDuration(QC_DEFAULTS.maxDur);
    if (p.type) c.setContentType(p.type);
    if (p.lang) c.setLanguage(p.lang);
  };
  const activePreset = QC_PRESETS.find((p) => p.cpl === c.cplLimit && p.cps === c.cpsLimit);

  return (
    <>
      <Section title="Industry presets" description="One click sets line length and reading speed for a delivery spec.">
        <div className="p-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
          {QC_PRESETS.map((p) => {
            const on = activePreset?.name === p.name;
            return (
              <button
                key={p.name}
                type="button"
                onClick={() => applyPreset(p)}
                aria-pressed={on}
                className={`text-left rounded-lg border p-2.5 cursor-pointer transition-colors ${on ? 'border-[var(--ss-accent)] bg-[var(--ss-accent)]/10' : 'border-[var(--ss-line)] bg-[var(--ss-bg)] hover:border-[var(--ss-muted)]'}`}
              >
                <div className="text-[12px] font-semibold text-[var(--ss-text)]">{p.name}</div>
                <div className="text-[11px] text-[var(--ss-faint)] mt-0.5">{p.desc}</div>
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Reading comfort" description="Subtitles beyond these limits are flagged in the QC report.">
        <Slider label="Characters per line (CPL)" hint="Longest line allowed before it must wrap." value={c.cplLimit} min={28} max={50} step={1} unit="ch" defaultValue={QC_DEFAULTS.cpl} onChange={c.setCplLimit} ticks={['28 short', '42 Netflix', '50 wide']} />
        <Slider label="Reading speed (CPS)" hint="Characters per second. Above this, viewers can't keep up." value={c.cpsLimit} min={5} max={25} step={0.5} unit="cps" decimals={1} defaultValue={QC_DEFAULTS.cps} onChange={c.setCpsLimit} ticks={['5 CJK', '17 kids', '20 adult', '25']} />
        <Row label="Lines per subtitle">
          <Segmented label="Max lines" value={c.maxLines} onChange={c.setMaxLines} options={[{ value: 1, label: '1 line' }, { value: 2, label: '2 lines' }]} className="w-44" />
        </Row>
        <Row label="Audience" hint="Kids content uses a slower reading speed.">
          <Segmented label="Content type" value={c.contentType} onChange={c.setContentType} options={[{ value: 'adult', label: 'Adult' }, { value: 'children', label: 'Children' }]} className="w-44" />
        </Row>
      </Section>

      <Section title="Duration">
        <Slider label="Minimum duration" hint="Netflix default: 5/6 second (20 frames at 24 fps)." value={c.minDuration} min={0.5} max={1.5} step={0.05} unit="s" decimals={2} defaultValue={QC_DEFAULTS.minDur} onChange={c.setMinDuration} />
        <Slider label="Maximum duration" hint="Netflix default: 7 seconds." value={c.maxDuration} min={3} max={10} step={0.5} unit="s" decimals={1} defaultValue={QC_DEFAULTS.maxDur} onChange={c.setMaxDuration} />
      </Section>

      <Section title="Frame rate" description="Drives frame stepping, shot-change snapping and the 2-frame gap rule.">
        <Row label="Frames per second" hint={`Minimum gap between subtitles: ${(2 / (c.frameRate || 24)).toFixed(3)} s`}>
          <div className="flex items-center gap-2">
            <TextInput
              type="number"
              step="0.001"
              min="1"
              max="120"
              value={c.frameRate}
              onChange={(e) => { const v = parseFloat(e.target.value); if (v > 0) c.setFrameRate(v); }}
              className="w-24 text-right font-mono"
              aria-label="Frames per second"
            />
            <Badge tone="muted">auto-detected from media</Badge>
          </div>
        </Row>
        <div className="px-4 py-3 flex flex-wrap gap-1.5">
          {FPS_CHOICES.map((v) => {
            const on = Math.abs((c.frameRate || 24) - v) < 0.01;
            return (
              <button
                key={v}
                type="button"
                aria-pressed={on}
                onClick={() => c.setFrameRate(v)}
                className={`h-7 px-2.5 rounded-md border text-[12px] font-mono cursor-pointer transition-colors ${on ? 'bg-[var(--ss-accent)] border-[var(--ss-accent)] text-[var(--ss-accent-ink)] font-semibold' : 'border-[var(--ss-line)] bg-[var(--ss-bg)] text-[var(--ss-muted)] hover:text-[var(--ss-text)]'}`}
              >
                {v}
              </button>
            );
          })}
        </div>
        <SwitchRow label="Snap to shot changes" hint="Pull cuts that fall within 2–10 frames of a scene change onto it." checked={c.snapToShotChanges} onChange={c.setSnapToShotChanges} />
      </Section>
    </>
  );
}

/* ─────────────────────────── Language & script ─────────────────────────── */

const LANGUAGES = [
  ['auto', 'Auto-detect'], ['en', 'English'], ['hi', 'Hindi (हिंदी)'], ['hinglish', 'Hinglish (Hindi in Latin)'], ['bn', 'Bengali (বাংলা)'],
  ['ta', 'Tamil (தமிழ்)'], ['te', 'Telugu (తెలుగు)'], ['mr', 'Marathi (मराठी)'], ['gu', 'Gujarati (ગુજરાતી)'], ['pa', 'Punjabi (ਪੰਜਾਬੀ)'],
  ['kn', 'Kannada (ಕನ್ನಡ)'], ['ml', 'Malayalam (മലയാളം)'], ['ur', 'Urdu (اردو)'], ['es', 'Spanish (Español)'], ['fr', 'French (Français)'],
  ['de', 'German (Deutsch)'], ['it', 'Italian (Italiano)'], ['pt', 'Portuguese (Português)'], ['ja', 'Japanese (日本語) · 16 CPL'],
  ['ko', 'Korean (한국어) · 16 CPL'], ['zh', 'Chinese Simplified (中文 简体) · 16 CPL'], ['zht', 'Chinese Traditional (中文 繁體) · 16 CPL'],
  ['ar', 'Arabic (العربية)'], ['he', 'Hebrew (עברית)'], ['ru', 'Russian (Русский)'], ['uk', 'Ukrainian (Українська)'], ['tr', 'Turkish (Türkçe)'],
  ['th', 'Thai (ไทย) · 35 CPL'], ['vi', 'Vietnamese (Tiếng Việt)'], ['id', 'Indonesian (Bahasa Indonesia)'], ['pl', 'Polish (Polski)'],
  ['nl', 'Dutch (Nederlands)'], ['sv', 'Swedish (Svenska)'],
].map(([value, label]) => ({ value, label }));

export function LanguagePage({ c }) {
  return (
    <>
      <Section title="Language" description="Choosing a language also sets a sensible line length and reading speed for it.">
        <Row label="Spoken language" hint="Used for transcription and QC rules.">
          <Select label="Spoken language" value={c.language} onChange={c.setLanguage} options={LANGUAGES} className="w-64" />
        </Row>
        <Row label="Script / alphabet" hint="Writing system used for the output text.">
          <Select
            label="Script"
            value={c.script}
            onChange={c.setScript}
            className="w-64"
            options={[
              { value: 'auto', label: 'Native / auto script' },
              { value: 'devanagari', label: 'Devanagari (देवनागरी)' },
              { value: 'latin', label: 'Latin / romanised (Hinglish)' },
            ]}
          />
        </Row>
        <SwitchRow label="Strict target script" hint="Transliterate English loanwords into the target script, e.g. “competition” → “कंपटीशन”." checked={c.strictNativeScript} onChange={c.setStrictNativeScript} />
      </Section>

      <Section title="Dialogue style">
        <SwitchRow label="Sound descriptions (SDH)" hint="Add non-speech cues such as [door slams] for deaf and hard-of-hearing viewers." checked={c.sdhMode} onChange={c.setSdhMode} />
        <SwitchRow label="Speaker labels" hint="Include [Speaker 1] tags. Dual hyphens for two speakers always apply." checked={c.includeSpeakerTags} onChange={c.setIncludeSpeakerTags} />
      </Section>
    </>
  );
}

/* ─────────────────────────── Speech & AI ─────────────────────────── */

export function AiPage({ c }) {
  const [keyVisible, setKeyVisible] = useState(false);
  const [key, setKey] = useState(() => { try { return localStorage.getItem('elevenlabs_api_key') || ''; } catch (_) { return ''; } });
  const [saved, setSaved] = useState(false);

  const saveKey = (v) => {
    setKey(v);
    try { localStorage.setItem('elevenlabs_api_key', v.trim()); setSaved(true); setTimeout(() => setSaved(false), 1800); } catch (_) { /* storage unavailable */ }
  };

  return (
    <>
      <Section title="Transcription engine" description="ElevenLabs Scribe v2 with word timestamps and speaker diarization.">
        <Row label="Engine"><Badge>scribe_v2</Badge></Row>
        <Row label="Expected speakers" hint="A hint that helps Scribe split speaker turns accurately.">
          <Select
            label="Expected speakers"
            value={c.numSpeakers}
            onChange={(v) => c.setNumSpeakers(parseInt(v, 10))}
            className="w-56"
            options={[
              { value: 0, label: 'Auto-detect' },
              { value: 1, label: '1 speaker (monologue)' },
              { value: 2, label: '2 speakers (interview)' },
              { value: 3, label: '3 speakers (panel)' },
              { value: 4, label: '4 speakers (group)' },
              { value: 5, label: '5+ speakers (ensemble)' },
            ]}
          />
        </Row>
        <Row label="ElevenLabs API key" hint="Optional. Leave blank to use the key configured on the server. Stored only in this browser." stacked>
          <div className="flex gap-2">
            <TextInput type={keyVisible ? 'text' : 'password'} value={key} onChange={(e) => saveKey(e.target.value)} placeholder="sk_…" className="font-mono" autoComplete="off" spellCheck={false} aria-label="ElevenLabs API key" />
            <Button onClick={() => setKeyVisible((v) => !v)} icon={keyVisible ? EyeOff : Eye} aria-label={keyVisible ? 'Hide key' : 'Show key'} />
          </div>
          <p className="h-4 mt-1 text-[11.5px] text-[var(--ss-accent)]" role="status">{saved ? 'Saved' : ''}</p>
        </Row>
      </Section>

      <Section title="Quality control">
        <SwitchRow label="Gemini self-correction pass" hint="After generating, send QC errors back to Gemini to rewrite line breaks and split dense subtitles." checked={c.geminiAutoFix} onChange={c.setGeminiAutoFix} />
      </Section>
    </>
  );
}

/* ─────────────────────────── Glossary ─────────────────────────── */

export function GlossaryPage({ c }) {
  const [word, setWord] = useState('');
  const [filter, setFilter] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const terms = c.glossaryTerms;

  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(''), 4500); };
  const add = () => {
    const words = word.split(/[,;\n]+/).map((w) => w.trim()).filter(Boolean);
    if (!words.length) return;
    c.setGlossaryTerms(Array.from(new Set([...terms, ...words])));
    setWord('');
  };

  const importFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`${(API_BASE || '').replace(/\/$/, '')}/api/subtitle/extract_glossary_file`, { method: 'POST', body: form });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = await res.json();
      if (data.terms?.length) {
        c.setGlossaryTerms(Array.from(new Set([...terms, ...data.terms])));
        flash(`Imported ${data.terms.length} terms from ${file.name}`);
      } else flash(`No terms found in ${file.name}`);
    } catch (_) {
      try {
        const text = await file.text();
        const parts = text.split(/[\r\n,;\t|]+/).map((w) => w.trim().replace(/^["'`]|["'`]$/g, '')).filter((w) => w.length >= 2 && w.length <= 80);
        if (parts.length) {
          c.setGlossaryTerms(Array.from(new Set([...terms, ...parts])));
          flash(`Imported ${parts.length} terms from ${file.name}`);
        } else flash(`Could not read terms from ${file.name}`);
      } catch (err) {
        flash(`Failed to read file: ${err.message}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const visible = filter ? terms.filter((t) => t.toLowerCase().includes(filter.toLowerCase())) : terms;

  return (
    <Section
      title="Project glossary"
      description="Character names, places and slang that should be spelled exactly as written."
      action={<Badge>{terms.length} term{terms.length === 1 ? '' : 's'}</Badge>}
    >
      <div className="p-3 flex gap-2">
        <TextInput value={word} onChange={(e) => setWord(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } }} placeholder="Add terms, separated by commas, then press Enter" aria-label="New glossary term" />
        <Button variant="primary" onClick={add} disabled={!word.trim()}>Add</Button>
        <Button icon={FileUp} onClick={() => fileRef.current?.click()} disabled={busy} title="Import from Word, Excel, CSV or TXT">{busy ? 'Importing…' : 'Import'}</Button>
        <input ref={fileRef} type="file" accept=".docx,.xlsx,.xls,.csv,.txt,.tsv,.json" onChange={importFile} className="hidden" />
      </div>
      {msg && <p className="px-4 py-2 text-[12px] text-[var(--ss-accent)] flex items-center gap-1.5" role="status"><Check size={12} />{msg}</p>}
      {terms.length > 6 && (
        <div className="px-3 py-2"><TextInput value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter terms" aria-label="Filter glossary" /></div>
      )}
      <div className="p-3">
        {terms.length === 0 ? (
          <p className="text-[12px] text-[var(--ss-faint)]">No terms yet. Add names the transcript tends to get wrong.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5 max-h-72 overflow-y-auto">
            {visible.map((t) => (
              <span key={t} className="inline-flex items-center gap-1 h-6 pl-2 pr-1 rounded-md border border-[var(--ss-line)] bg-[var(--ss-bg)] text-[12px] text-[var(--ss-text)]">
                {t}
                <button type="button" onClick={() => c.setGlossaryTerms(terms.filter((x) => x !== t))} aria-label={`Remove ${t}`} className="p-0.5 rounded text-[var(--ss-faint)] hover:text-[var(--ss-danger)] cursor-pointer"><X size={11} /></button>
              </span>
            ))}
          </div>
        )}
      </div>
      {terms.length > 0 && (
        <div className="px-3 py-2.5 flex justify-end">
          <Button size="sm" variant="danger" icon={Trash2} onClick={() => { if (window.confirm(`Remove all ${terms.length} glossary terms?`)) c.setGlossaryTerms([]); }}>Clear all</Button>
        </div>
      )}
    </Section>
  );
}

/* ─────────────────────────── Editor ─────────────────────────── */

const AUTOSAVE_LABEL = { 0: 'Off', 30: 'Every 30 seconds', 60: 'Every minute', 120: 'Every 2 minutes', 300: 'Every 5 minutes' };

export function EditorPage({ c }) {
  const { prefs, setPref } = c;
  return (
    <>
      <Section title="Adding and generating">
        <Slider label="New subtitle length" hint="Default duration when you add a subtitle at the playhead." value={prefs.newSubDuration} min={0.5} max={10} step={0.1} unit="s" decimals={1} defaultValue={DEFAULT_PREFS.newSubDuration} onChange={(v) => setPref('newSubDuration', v)} />
        <Row label="Placeholder text" hint="What a freshly added subtitle says until you type.">
          <TextInput value={prefs.newSubText} onChange={(e) => setPref('newSubText', e.target.value)} className="w-64" maxLength={120} aria-label="Placeholder text" />
        </Row>
        <SwitchRow label="Confirm before generating" hint="Generating replaces the current subtitles and uses ElevenLabs credits." checked={prefs.confirmGenerate} onChange={(v) => setPref('confirmGenerate', v)} />
      </Section>

      <Section title="Large files">
        <Row
          label="Extract audio on this computer"
          hint="Uploads only the audio (about 2 MB per minute) instead of the whole video, which is far faster for big files. The audio can differ from the server's by 1 step in 65,536 on a tiny share of samples, so the default only uses it for videos of 100 MB or more."
          stacked
        >
          <Segmented
            label="Extract audio on this computer"
            value={prefs.localExtraction}
            onChange={(v) => setPref('localExtraction', v)}
            options={[
              { value: 'large', label: 'Large videos only' },
              { value: 'always', label: 'Always' },
              { value: 'never', label: 'Never (server)' },
            ]}
          />
        </Row>
      </Section>

      <Section title="Playback">
        <Slider label="Arrow-key seek step" hint="How far ← and → jump." value={prefs.seekStep} min={0.5} max={30} step={0.5} unit="s" decimals={1} defaultValue={DEFAULT_PREFS.seekStep} onChange={(v) => setPref('seekStep', v)} />
      </Section>

      <Section title="Display">
        <Row label="Timecode format" hint="Shown in the status bar.">
          <Segmented label="Timecode format" value={prefs.tcFormat} onChange={(v) => setPref('tcFormat', v)} options={[{ value: 'time', label: 'mm:ss.ms' }, { value: 'frames', label: 'hh:mm:ss:ff' }]} className="w-48" />
        </Row>
      </Section>

      <Section title="Drafts" description="A copy of your work is kept in this browser so a crash or closed tab doesn't lose it.">
        <Row label="Autosave">
          <Select label="Autosave interval" value={prefs.autosaveSec} onChange={(v) => setPref('autosaveSec', Number(v))} options={AUTOSAVE_CHOICES.map((v) => ({ value: v, label: AUTOSAVE_LABEL[v] }))} className="w-48" />
        </Row>
        <Row label="Save a draft now" hint="Shortcut: Ctrl+S">
          <Button onClick={c.onSaveDraft} disabled={!c.hasEvents}>Save draft</Button>
        </Row>
      </Section>
    </>
  );
}

/* ─────────────────────────── Connection ─────────────────────────── */

export function ConnectionPage() {
  const initial = useMemo(() => {
    try { return cleanUrl(localStorage.getItem('karya_api_url')) || cleanUrl(import.meta.env.VITE_API_URL) || ''; } catch (_) { return ''; }
  }, []);
  const [url, setUrl] = useState(initial);
  const [status, setStatus] = useState(null);

  const test = async () => {
    const raw = (url || '').trim().replace(/\/+$/, '').replace(/\/api\/?$/i, '');
    if (!raw) { setStatus({ ok: true, text: 'Empty: the built-in proxy / default server is used.' }); return; }
    setStatus({ ok: true, text: 'Testing…' });
    try {
      let res = await fetch(`${raw}/api/health`).catch(() => null);
      if (!res || !res.ok) res = await fetch(`${raw}/health`).catch(() => null);
      if (!res || !res.ok) res = await fetch(`${raw}/`).catch(() => null);
      if (res && res.ok) {
        const data = await res.json().catch(() => ({}));
        setStatus({ ok: true, text: `Connected${data.has_gemini_api_key === false ? ' · Gemini API key missing on the server' : ''}` });
      } else setStatus({ ok: false, text: res ? `Server answered ${res.status}` : 'Could not reach the server (cold start?)' });
    } catch (_) {
      setStatus({ ok: false, text: 'Failed: check the URL, HTTPS and CORS' });
    }
  };

  const save = () => {
    const next = cleanUrl(url);
    setCustomApiBase(next);
    if (next !== initial) window.location.reload();
    else setStatus({ ok: true, text: 'Saved' });
  };

  return (
    <Section title="Backend server" description="Required for live deployments. Enter the base URL without /api.">
      <Row label="Server URL" stacked hint={`Currently using ${API_BASE || 'the default proxy'}`}>
        <div className="flex gap-2">
          <TextInput value={url} onChange={(e) => { setUrl(e.target.value); setStatus(null); }} placeholder={import.meta.env.VITE_API_URL || 'https://your-backend.example.com'} className="font-mono" aria-label="Backend server URL" />
          <Button onClick={test}>Test</Button>
          <Button variant="primary" onClick={save}>Save</Button>
        </div>
        <p className={`h-4 mt-1.5 text-[11.5px] ${status && !status.ok ? 'text-[var(--ss-danger)]' : 'text-[var(--ss-accent)]'}`} role="status">{status?.text || ''}</p>
        <p className="text-[11.5px] text-[var(--ss-faint)]">Changing the server reloads the page. Unsaved subtitles are kept as a local draft.</p>
      </Row>
    </Section>
  );
}

/* ─────────────────────────── Shortcuts ─────────────────────────── */

export function ShortcutsPage() {
  const [q, setQ] = useState('');
  const groups = SHORTCUT_GROUPS
    .map((g) => ({ ...g, items: g.items.filter((i) => !q || `${i.keys} ${i.alt || ''} ${i.label}`.toLowerCase().includes(q.toLowerCase())) }))
    .filter((g) => g.items.length);
  return (
    <>
      <div className="relative mb-4">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--ss-faint)] pointer-events-none" />
        <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search shortcuts" className="pl-8" aria-label="Search shortcuts" />
      </div>
      {groups.length === 0 && <p className="text-[12px] text-[var(--ss-faint)]">No shortcut matches “{q}”.</p>}
      {groups.map((g) => (
        <Section key={g.title} title={g.title}>
          {g.items.map((i) => (
            <Row key={i.keys} label={i.label}>
              <span className="flex items-center gap-1.5">
                <Kbd>{i.keys}</Kbd>
                {i.alt && <><span className="text-[10px] text-[var(--ss-faint)]">or</span><Kbd>{i.alt}</Kbd></>}
              </span>
            </Row>
          ))}
        </Section>
      ))}
    </>
  );
}

/* ─────────────────────────── Data & reset ─────────────────────────── */

const BACKUP_KEYS = [/^karya_sub_/, /^karya_ss_/, /^karya_theme_v1$/, /^karya_subtitle_glossary$/, /^karya_subtitle_style$/, /^karya_num_speakers$/, /^karya_strict_native_script$/, /^karya_format_scope$/];
const isBackupKey = (k) => BACKUP_KEYS.some((re) => re.test(k));
const draftKeys = () => { try { return Object.keys(localStorage).filter((k) => k.startsWith('karya_subtitle_autosave_')); } catch (_) { return []; } };

export function DataPage({ c }) {
  const [drafts, setDrafts] = useState(draftKeys);
  const [msg, setMsg] = useState('');
  const fileRef = useRef(null);
  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(''), 4000); };

  const exportSettings = () => {
    const data = {};
    try { Object.keys(localStorage).filter(isBackupKey).forEach((k) => { data[k] = localStorage.getItem(k); }); } catch (_) { /* storage unavailable */ }
    const url = URL.createObjectURL(new Blob([JSON.stringify({ kind: 'karya-subtitle-settings', version: 1, data }, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'subtitle-studio-settings.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const importSettings = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (parsed?.kind !== 'karya-subtitle-settings' || typeof parsed.data !== 'object') throw new Error('bad file');
      const entries = Object.entries(parsed.data).filter(([k, v]) => isBackupKey(k) && typeof v === 'string');
      entries.forEach(([k, v]) => localStorage.setItem(k, v));
      flash(`Restored ${entries.length} settings. Reloading…`);
      setTimeout(() => window.location.reload(), 700);
    } catch (_) {
      flash('That file is not a settings backup.');
    }
  };

  const clearDrafts = () => {
    if (!window.confirm(`Delete ${drafts.length} saved draft${drafts.length === 1 ? '' : 's'} from this browser? This cannot be undone.`)) return;
    drafts.forEach((k) => { try { localStorage.removeItem(k); } catch (_) { /* ignore */ } });
    setDrafts([]);
    flash('Drafts deleted.');
  };

  return (
    <>
      <Section title="Back up and restore" description="Layout, appearance, QC rules, editor preferences and glossary. API keys are never included.">
        <Row label="Settings backup" hint="Move your setup to another browser or keep a copy.">
          <div className="flex gap-2">
            <Button icon={Download} onClick={exportSettings}>Export</Button>
            <Button icon={Upload} onClick={() => fileRef.current?.click()}>Import</Button>
            <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={importSettings} />
          </div>
        </Row>
        {msg && <p className="px-4 py-2 text-[12px] text-[var(--ss-accent)]" role="status">{msg}</p>}
      </Section>

      <Section title="Local drafts">
        <Row label="Saved drafts" hint="Autosaved copies of your subtitles, one per media file.">
          <div className="flex items-center gap-2">
            <Badge tone="muted">{drafts.length}</Badge>
            <Button variant="danger" icon={Trash2} onClick={clearDrafts} disabled={!drafts.length}>Delete all</Button>
          </div>
        </Row>
      </Section>

      <Section title="Reset">
        <Row label="QC rules" hint="Line length, reading speed, durations and frame rate."><Button icon={RotateCcw} onClick={() => { resetQcDefaults(c); flash('QC rules reset.'); }}>Reset</Button></Row>
        <Row label="Editor preferences"><Button icon={RotateCcw} onClick={() => { c.resetPrefs(); flash('Editor preferences reset.'); }}>Reset</Button></Row>
        <Row label="Layout"><Button icon={RotateCcw} onClick={() => { c.studioLayout.reset(); flash('Layout reset to Classic.'); }}>Reset</Button></Row>
        <Row label="Appearance" hint="Back to the default theme."><Button icon={RotateCcw} onClick={() => { c.resetAppearance(); flash('Appearance reset.'); }}>Reset</Button></Row>
      </Section>
    </>
  );
}
