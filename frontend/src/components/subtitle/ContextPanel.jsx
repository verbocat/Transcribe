import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Square, Sparkles, Loader2, Plus, BookText, ChevronDown, ChevronRight, Wand2, Check, AlertTriangle, ArrowRight } from 'lucide-react';
import { API_BASE } from '../../config';
import { startJob, jobHeaders, isCancelError } from '../../utils/cancellable';
import { Button, IconButton, Select, TextInput, Switch, Badge } from './ui/controls';

/**
 * Context for the transcript. Speech recognition does not know who is speaking or what the video is about, so it mishears
 * names and terms. The context is used three ways, in this order of strength:
 *   1. key terms and names are sent to the speech engine itself (it hears them correctly),
 *   2. "often misheard -> correct" pairs are applied exactly,
 *   3. an AI proofreading pass fixes real recognition mistakes. It never rewrites, so natural spoken language stays as spoken.
 * Saved per video file and sent automatically with every Generate.
 */

const CONTENT_TYPES = [
  { value: '', label: 'Not specified' }, { value: 'interview', label: 'Interview' }, { value: 'film', label: 'Film / series' },
  { value: 'documentary', label: 'Documentary' }, { value: 'lecture', label: 'Lecture / talk' }, { value: 'news', label: 'News' },
  { value: 'podcast', label: 'Podcast / conversation' }, { value: 'ad', label: 'Advertisement' }, { value: 'kids', label: 'Kids / animation' },
  { value: 'tutorial', label: 'Tutorial / training' }, { value: 'other', label: 'Other' },
];
const WRITING_STYLES = [
  { value: 'spoken', label: 'Exactly as spoken (natural)' },
  { value: 'light', label: 'Light cleanup' },
  { value: 'clean', label: 'Clean written text' },
];
const FILLERS = [{ value: 'keep', label: 'Keep (um, uh, matlab…)' }, { value: 'remove', label: 'Remove' }];
const STUTTERS = [{ value: 'keep', label: 'Keep as spoken' }, { value: 'clean', label: 'Clean up repeats' }];
const NUMBERS = [
  { value: 'guide', label: '1 to 10 in words, 11+ digits' },
  { value: 'digits', label: 'Always digits' },
  { value: 'words', label: 'Words where natural' },
];
const PROFANITY = [{ value: 'keep', label: 'Keep as spoken' }, { value: 'mask', label: 'Mask (f***)' }];

export const EMPTY_CONTEXT = {
  title: '', content_type: '', topic: '', summary: '', region: '', language_mix: '', variety: '',
  speakers: [], key_terms: '', corrections: '',
  writing_style: 'spoken', fillers: 'keep', stutters: 'keep', numbers: 'guide', profanity: 'keep',
  dos: '', donts: '', notes: '', strict: true,
};

const storeKey = (fileName) => `ss_ctx_v1:${fileName || 'subtitles'}`;

export function loadContext(fileName) {
  try {
    const raw = localStorage.getItem(storeKey(fileName));
    return { ...EMPTY_CONTEXT, ...(raw ? JSON.parse(raw) : {}) };
  } catch (_) {
    return { ...EMPTY_CONTEXT };
  }
}

export function saveContext(fileName, ctx) {
  try { localStorage.setItem(storeKey(fileName), JSON.stringify(ctx)); } catch (_) { /* storage unavailable */ }
}

/** The context as sent to the server: empty fields and empty speaker rows are dropped. */
export function contextForRequest(ctx) {
  const out = {};
  Object.entries(ctx || {}).forEach(([k, v]) => {
    if (k === 'speakers') {
      const rows = (v || []).filter((s) => (s.name || '').trim());
      if (rows.length) out.speakers = rows;
    } else if (k === 'strict') {
      out.strict = !!v;
    } else if (String(v ?? '').trim()) {
      out[k] = String(v).trim();
    }
  });
  return out;
}

const hasContent = (ctx) => Object.keys(contextForRequest(ctx)).some((k) => !['strict', 'writing_style', 'fillers', 'stutters', 'numbers', 'profanity'].includes(k));

const AREA = 'w-full rounded-lg border border-[var(--ss-line)] bg-[var(--ss-bg)] px-2.5 py-1.5 text-[12px] placeholder:text-[var(--ss-faint)] focus:border-[var(--ss-accent)] focus:outline-none';

function Field({ label, children, className = '' }) {
  return (
    <label className={`block ${className}`}>
      <span className="block mb-1 text-[11.5px] text-[var(--ss-muted)]">{label}</span>
      {children}
    </label>
  );
}

function Group({ title, hint, defaultOpen = false, children }) {
  const [on, setOn] = useState(defaultOpen);
  return (
    <section className="rounded-xl border border-[var(--ss-line)] bg-[var(--ss-raised)]/40">
      <button type="button" aria-expanded={on} onClick={() => setOn(!on)} className="w-full h-10 px-3 flex items-center gap-2 text-left cursor-pointer">
        {on ? <ChevronDown size={14} className="text-[var(--ss-muted)]" /> : <ChevronRight size={14} className="text-[var(--ss-muted)]" />}
        <span className="text-[12.5px] font-medium text-[var(--ss-text)]">{title}</span>
        <span className="ml-auto text-[11.5px] text-[var(--ss-faint)] truncate">{hint}</span>
      </button>
      {on && <div className="px-3 pb-3 pt-1 border-t border-[var(--ss-line)]/70">{children}</div>}
    </section>
  );
}

const Notice = ({ tone = 'good', children }) => {
  const tones = {
    danger: 'border-[var(--ss-danger)]/40 bg-[var(--ss-danger)]/10 text-[var(--ss-danger)]',
    warn: 'border-[var(--ss-warn)]/40 bg-[var(--ss-warn)]/10 text-[var(--ss-warn)]',
    good: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  };
  return <div role="status" className={`rounded-lg border px-3 py-2 text-[12px] leading-snug ${tones[tone]}`}>{children}</div>;
};

async function post(path, body, job) {
  const res = await fetch(`${API_BASE}${path}`, { method: 'POST', headers: jobHeaders(job, { 'Content-Type': 'application/json' }), body: JSON.stringify(body), signal: job?.signal });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `Request failed (${res.status})`);
  return data;
}

const mergeLines = (current, extra) => {
  const have = new Set(String(current || '').split('\n').map((l) => l.trim().toLowerCase()).filter(Boolean));
  const add = (extra || []).filter((l) => l && !have.has(String(l).trim().toLowerCase()));
  return [String(current || '').trim(), ...add].filter(Boolean).join('\n');
};

export default function ContextPanel({
  isOpen, onClose, ctx, onChange, events = [], fileName, language = 'auto', cplLimit = 42, maxLines = 2,
  glossaryTerms = [], onApplyFixes, lastRun = null, onJumpToEvent,
}) {
  const [busy, setBusy] = useState(null); // 'fill' | 'polish'
  const [note, setNote] = useState(null); // { tone, text }
  const [fixes, setFixes] = useState(null);

  const patch = (k, v) => onChange({ ...ctx, [k]: v });
  const readable = useMemo(() => events.filter((e) => (e.text || '').trim()).length, [events]);
  const filled = hasContent(ctx);

  const jobRef = useRef(null);
  const cancelBusy = () => jobRef.current?.cancel();
  useEffect(() => () => jobRef.current?.cancel(), []);

  const autofill = async () => {
    setNote(null);
    setBusy('fill');
    const job = startJob(API_BASE);
    jobRef.current = job;
    try {
      const d = await post('/api/subtitle/context_autofill', {
        events: events.map((e) => ({ text: e.text, speaker: e.primary_speaker || e.speaker })),
        language,
      }, job);
      const next = { ...ctx };
      ['title', 'topic', 'summary', 'region', 'language_mix', 'variety'].forEach((k) => { if (!String(next[k]).trim() && d[k]) next[k] = d[k]; });
      if (!next.content_type && d.content_type) next.content_type = d.content_type;
      if (!(next.speakers || []).length && (d.speakers || []).length) next.speakers = d.speakers;
      next.key_terms = mergeLines(next.key_terms, d.key_terms);
      next.corrections = mergeLines(next.corrections, d.corrections);
      onChange(next);
      setNote({ tone: 'good', text: `Centroid read ${d.lines_read} of ${d.lines_total} subtitles and drafted the context: ${(d.speakers || []).length} speakers, ${(d.key_terms || []).length} key terms, ${(d.corrections || []).length} spelling fixes. Please check them. They are applied as rules.` });
    } catch (e) {
      setNote(isCancelError(e) ? { tone: 'warn', text: 'Cancelled. Nothing was changed.' } : { tone: 'danger', text: e.message });
    } finally {
      if (jobRef.current === job) jobRef.current = null;
      setBusy(null);
    }
  };

  const proofread = async () => {
    setNote(null);
    setFixes(null);
    setBusy('polish');
    const job = startJob(API_BASE);
    jobRef.current = job;
    try {
      const d = await post('/api/subtitle/context_polish', {
        events: events.map((e) => ({ id: e.id ?? e.event_id, text: e.text })),
        context: contextForRequest(ctx), glossary: glossaryTerms, language, cpl_limit: cplLimit, max_lines: maxLines,
      }, job);
      if (d.ai_error) setNote({ tone: 'warn', text: `The AI proofreading could not run (${d.ai_error}). Only your exact “misheard → correct” fixes were applied.` });
      if (!d.fixes.length) {
        if (!d.ai_error) setNote({ tone: 'good', text: 'No recognition mistakes found. The subtitles already match your context.' });
        return;
      }
      onApplyFixes?.(d.fixes);
      setFixes(d.fixes);
      if (!d.ai_error) setNote({ tone: 'good', text: `Fixed ${d.fixes.length} subtitle${d.fixes.length === 1 ? '' : 's'}. Timing is unchanged. Press Ctrl+Z to undo.` });
    } catch (e) {
      setNote(isCancelError(e) ? { tone: 'warn', text: 'Cancelled. Nothing was changed.' } : { tone: 'danger', text: e.message });
    } finally {
      if (jobRef.current === job) jobRef.current = null;
      setBusy(null);
    }
  };

  if (!isOpen) return null;

  return (
    <aside
      role="dialog"
      aria-label="Context"
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}
      className="fixed top-0 bottom-0 right-0 z-[60] w-[520px] max-w-[96vw] flex flex-col border-l border-[var(--ss-line)] bg-[var(--ss-panel)] text-[var(--ss-text)] shadow-2xl"
    >
      <header className="shrink-0 flex items-center gap-2.5 px-5 h-14 border-b border-[var(--ss-line)]">
        <BookText size={17} className="text-[var(--ss-accent)]" />
        <div className="flex-1 min-w-0">
          <h2 className="text-[14px] font-semibold leading-tight">Context</h2>
          <p className="text-[11.5px] text-[var(--ss-faint)] truncate">{fileName || 'This video'} · makes the transcript more accurate</p>
        </div>
        {filled && <Badge tone="accent">In use</Badge>}
        <IconButton icon={X} label="Close (Esc)" onClick={onClose} />
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-3" data-lenis-prevent>
        <div className="flex items-start gap-3 rounded-lg border border-[var(--ss-accent)]/30 bg-[var(--ss-accent)]/5 p-3">
          <p className="flex-1 min-w-0 text-[11.5px] leading-snug text-[var(--ss-muted)]">
            Tell the tool what the video is about, who speaks, and how names are spelled. The speech engine then hears them correctly, wrong spellings are fixed, and spoken language stays exactly as spoken. Saved for this video and used every time you generate.
          </p>
          {busy === 'fill' ? (
            <Button size="sm" variant="secondary" icon={Square} onClick={cancelBusy}>Cancel</Button>
          ) : (
            <Button size="sm" variant="primary" icon={Sparkles} disabled={!!busy || !readable} onClick={autofill} title={readable ? 'Read the current subtitles and draft the context' : 'Generate or import subtitles first'}>
              Auto-fill
            </Button>
          )}
        </div>
        {note && <Notice tone={note.tone}>{note.text}</Notice>}
        {lastRun && (lastRun.ai_fixes + lastRun.applied_corrections) > 0 && (
          <Notice tone="good">The last generation used this context and corrected {lastRun.ai_fixes + lastRun.applied_corrections} subtitles.</Notice>
        )}

        <Group title="About the video" hint={ctx.title || ctx.topic || 'What it is'} defaultOpen>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Title"><TextInput value={ctx.title} onChange={(e) => patch('title', e.target.value)} placeholder="e.g. Cricket World Cup review" /></Field>
            <Field label="Type of video"><Select label="Type of video" value={ctx.content_type} onChange={(v) => patch('content_type', v)} options={CONTENT_TYPES} className="w-full" /></Field>
            <Field label="Topic / domain" className="col-span-2"><TextInput value={ctx.topic} onChange={(e) => patch('topic', e.target.value)} placeholder="e.g. cricket, personal finance, kids fantasy cartoon" /></Field>
            <Field label="What it is about" className="col-span-2"><textarea rows={3} className={AREA} value={ctx.summary} onChange={(e) => patch('summary', e.target.value)} placeholder="Two or three sentences. Helps the AI choose the right word when two sound alike." /></Field>
            <Field label="Region / audience (optional)" className="col-span-2"><TextInput value={ctx.region} onChange={(e) => patch('region', e.target.value)} placeholder="e.g. Mumbai, North India, UK students" /></Field>
          </div>
        </Group>

        <Group title="People" hint={`${(ctx.speakers || []).filter((s) => s.name).length} added`} defaultOpen>
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-[11.5px] text-[var(--ss-faint)]">Names of the people who speak, spelled the way you want them.</p>
            <Button size="sm" variant="ghost" icon={Plus} onClick={() => patch('speakers', [...(ctx.speakers || []), { name: '', role: '', style: '' }])}>Add</Button>
          </div>
          <div className="space-y-2">
            {(ctx.speakers || []).map((s, i) => {
              const setRow = (p) => patch('speakers', ctx.speakers.map((r, j) => (j === i ? { ...r, ...p } : r)));
              return (
                <div key={i} className="rounded-lg border border-[var(--ss-line)] p-2 space-y-1.5">
                  <div className="grid grid-cols-[1fr_auto] gap-2 items-center">
                    <TextInput value={s.name} onChange={(e) => setRow({ name: e.target.value })} placeholder="Name" aria-label="Speaker name" />
                    <IconButton size="sm" icon={X} label="Remove speaker" onClick={() => patch('speakers', ctx.speakers.filter((_, j) => j !== i))} />
                  </div>
                  <TextInput value={s.role || ''} onChange={(e) => setRow({ role: e.target.value })} placeholder="Role, e.g. host, guest, the villain" aria-label="Speaker role" />
                  <TextInput value={s.style || ''} onChange={(e) => setRow({ style: e.target.value })} placeholder="How they talk, e.g. fast, slangy, strong accent" aria-label="Speaking style" />
                </div>
              );
            })}
          </div>
        </Group>

        <Group title="Names and terms" hint="Spelled exactly" defaultOpen>
          <Field label="Key terms: names, brands, places, technical words">
            <textarea rows={4} className={`${AREA} font-mono`} value={ctx.key_terms} onChange={(e) => patch('key_terms', e.target.value)} placeholder={'One per line.\nEldrador\nGanadore\nSuper Crystal'} />
          </Field>
          <p className="mt-1 mb-3 text-[11.5px] text-[var(--ss-faint)]">These are sent to the speech engine, so it hears them correctly in the first place{glossaryTerms.length ? `. Your ${glossaryTerms.length} glossary terms are included too.` : '.'}</p>
          <Field label="Often misheard: wrong spelling => correct spelling">
            <textarea rows={4} className={`${AREA} font-mono`} value={ctx.corrections} onChange={(e) => patch('corrections', e.target.value)} placeholder={'One per line.\nEl Rador => Eldrador\nGana door => Ganadore'} />
          </Field>
          <p className="mt-1 text-[11.5px] text-[var(--ss-faint)]">Applied exactly, every time, to whole words only.</p>
        </Group>

        <Group title="How to write it" hint={WRITING_STYLES.find((w) => w.value === ctx.writing_style)?.label} defaultOpen>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Writing style" className="col-span-2"><Select label="Writing style" value={ctx.writing_style} onChange={(v) => patch('writing_style', v)} options={WRITING_STYLES} className="w-full" /></Field>
            <Field label="Filler words"><Select label="Filler words" value={ctx.fillers} onChange={(v) => patch('fillers', v)} options={FILLERS} className="w-full" /></Field>
            <Field label="Stutters and repeats"><Select label="Stutters" value={ctx.stutters} onChange={(v) => patch('stutters', v)} options={STUTTERS} className="w-full" /></Field>
            <Field label="Numbers"><Select label="Numbers" value={ctx.numbers} onChange={(v) => patch('numbers', v)} options={NUMBERS} className="w-full" /></Field>
            <Field label="Profanity"><Select label="Profanity" value={ctx.profanity} onChange={(v) => patch('profanity', v)} options={PROFANITY} className="w-full" /></Field>
            <Field label="Spoken language and mixing" className="col-span-2"><TextInput value={ctx.language_mix} onChange={(e) => patch('language_mix', e.target.value)} placeholder="e.g. Hindi with many English words" /></Field>
            <Field label="Accent or dialect" className="col-span-2"><TextInput value={ctx.variety} onChange={(e) => patch('variety', e.target.value)} placeholder="e.g. everyday Mumbai Hindi, Indian English" /></Field>
          </div>
          <p className="mt-2 text-[11.5px] text-[var(--ss-faint)] leading-snug">With “Exactly as spoken”, everyday and slang words stay as the speaker said them. The AI is never allowed to swap them for formal or bookish words.</p>
        </Group>

        <Group title="Rules" hint="Always do, never do">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Always do"><textarea rows={2} className={AREA} value={ctx.dos} onChange={(e) => patch('dos', e.target.value)} placeholder="e.g. write numbers as digits" /></Field>
            <Field label="Never do"><textarea rows={2} className={AREA} value={ctx.donts} onChange={(e) => patch('donts', e.target.value)} placeholder="e.g. never translate names" /></Field>
            <Field label="Anything else" className="col-span-2"><TextInput value={ctx.notes} onChange={(e) => patch('notes', e.target.value)} placeholder="Any other instruction" /></Field>
          </div>
        </Group>

        <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--ss-line)] px-3 py-2.5">
          <div className="min-w-0">
            <div className="text-[12.5px]">Treat this context as strict rules</div>
            <div className="text-[11.5px] text-[var(--ss-faint)]">The AI must follow every field and may only fix real recognition mistakes</div>
          </div>
          <Switch checked={!!ctx.strict} onChange={(v) => patch('strict', v)} label="Strict context" />
        </div>

        {fixes && fixes.length > 0 && (
          <section className="rounded-xl border border-[var(--ss-line)] bg-[var(--ss-raised)]/40">
            <h3 className="px-3 pt-2.5 text-[12.5px] font-semibold">Changes made ({fixes.length})</h3>
            <ul className="max-h-64 overflow-y-auto divide-y divide-[var(--ss-line)]/60 mt-1.5">
              {fixes.slice(0, 60).map((f) => (
                <li key={f.id} className="px-3 py-2 text-[12px]">
                  <button type="button" className="text-[11px] font-mono text-[var(--ss-faint)] hover:text-[var(--ss-accent)] cursor-pointer" onClick={() => onJumpToEvent?.(f.id)}>#{f.id} · {f.reason}</button>
                  <div className="text-[var(--ss-danger)]/90 whitespace-pre-wrap line-through decoration-[var(--ss-danger)]/40">{f.before}</div>
                  <div className="flex gap-1.5 text-emerald-300 whitespace-pre-wrap"><ArrowRight size={12} className="mt-0.5 shrink-0" />{f.after}</div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <footer className="shrink-0 px-5 py-3 border-t border-[var(--ss-line)] space-y-2">
        <div className="flex gap-2">
          <Button variant="primary" size="lg" className="flex-1 min-w-0" icon={busy === 'polish' ? Loader2 : Wand2} disabled={!!busy || !readable || !filled} onClick={proofread}>
            {busy === 'polish' ? 'Proofreading…' : `Fix names and terms in ${readable} current subtitles`}
          </Button>
          {busy === 'polish' && <Button variant="secondary" size="lg" icon={Square} onClick={cancelBusy}>Cancel</Button>}
        </div>
        <p className="text-center text-[11.5px] text-[var(--ss-faint)]">
          {!filled ? 'Add some context first.' : 'Timing never changes. The next Generate uses this context automatically.'}
        </p>
      </footer>
    </aside>
  );
}
