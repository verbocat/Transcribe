import React, { useMemo, useState } from 'react';
import { X, Sparkles, Loader2, BookText, ChevronDown, ChevronRight, Wand2, Check, AlertTriangle, ArrowRight } from 'lucide-react';
import { API_BASE } from '../../config';
import { Button, IconButton, Select, TextInput, Switch, Badge } from './ui/controls';

/**
 * Context for the transcript. Speech recognition does not know who is speaking or what the video is about, so it mishears
 * names and terms. The context is used three ways, in this order of strength:
 *   1. key terms and names are sent to the speech engine itself (it hears them correctly),
 *   2. an AI proofreading pass fixes real recognition mistakes. It never rewrites, so natural spoken language stays as spoken.
 * Saved per video file and sent automatically with every Generate.
 */

const CONTENT_TYPES = [
  { value: '', label: 'Not specified' }, { value: 'interview', label: 'Interview' }, { value: 'film', label: 'Film / series' },
  { value: 'documentary', label: 'Documentary' }, { value: 'lecture', label: 'Lecture / talk' }, { value: 'news', label: 'News' },
  { value: 'podcast', label: 'Podcast / conversation' }, { value: 'ad', label: 'Advertisement' }, { value: 'kids', label: 'Kids / animation' },
  { value: 'tutorial', label: 'Tutorial / training' }, { value: 'other', label: 'Other' },
];
const WRITING_STYLES = [
  { value: 'spoken', label: 'Verbatim' },
  { value: 'clean', label: 'Non-verbatim' },
];

export const EMPTY_CONTEXT = {
  title: '', content_type: '', topic: '', summary: '', region: '',
  key_terms: '',
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
    if (!(k in EMPTY_CONTEXT)) return; // fields from older saved drafts that no longer exist
    if (k === 'strict') {
      out.strict = !!v;
    } else if (String(v ?? '').trim()) {
      out[k] = String(v).trim();
    }
  });
  return out;
}

const hasContent = (ctx) => Object.keys(contextForRequest(ctx)).some((k) => !['strict', 'writing_style'].includes(k));

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

async function post(path, body) {
  const res = await fetch(`${API_BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
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

  const autofill = async () => {
    setNote(null);
    setBusy('fill');
    try {
      const d = await post('/api/subtitle/context_autofill', {
        events: events.map((e) => ({ text: e.text, speaker: e.primary_speaker || e.speaker })),
        language,
      });
      const next = { ...ctx };
      ['title', 'topic', 'summary', 'region'].forEach((k) => { if (!String(next[k]).trim() && d[k]) next[k] = d[k]; });
      if (!next.content_type && d.content_type) next.content_type = d.content_type;
      next.key_terms = mergeLines(next.key_terms, d.key_terms);
      onChange(next);
      setNote({ tone: 'good', text: `Centroid read ${d.lines_read} of ${d.lines_total} subtitles and drafted the context: ${(d.key_terms || []).length} key terms. Please check them.` });
    } catch (e) {
      setNote({ tone: 'danger', text: e.message });
    } finally {
      setBusy(null);
    }
  };

  const proofread = async () => {
    setNote(null);
    setFixes(null);
    setBusy('polish');
    try {
      const d = await post('/api/subtitle/context_polish', {
        events: events.map((e) => ({ id: e.id ?? e.event_id, text: e.text })),
        context: contextForRequest(ctx), glossary: glossaryTerms, language, cpl_limit: cplLimit, max_lines: maxLines,
      });
      if (d.ai_error) setNote({ tone: 'warn', text: `The AI proofreading could not run (${d.ai_error}). No changes were made.` });
      if (!d.fixes.length) {
        if (!d.ai_error) setNote({ tone: 'good', text: 'No recognition mistakes found. The subtitles already match your context.' });
        return;
      }
      onApplyFixes?.(d.fixes);
      setFixes(d.fixes);
      if (!d.ai_error) setNote({ tone: 'good', text: `Fixed ${d.fixes.length} subtitle${d.fixes.length === 1 ? '' : 's'}. Timing is unchanged. Press Ctrl+Z to undo.` });
    } catch (e) {
      setNote({ tone: 'danger', text: e.message });
    } finally {
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
          <Button size="sm" variant="primary" icon={busy === 'fill' ? Loader2 : Sparkles} disabled={!!busy || !readable} onClick={autofill} title={readable ? 'Read the current subtitles and draft the context' : 'Generate or import subtitles first'}>
            {busy === 'fill' ? 'Reading…' : 'Auto-fill'}
          </Button>
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

        <Group title="Key names and terms" hint="Spelled exactly" defaultOpen>
          <Field label="Key terms: names, brands, places, technical words">
            <textarea rows={4} className={`${AREA} font-mono`} value={ctx.key_terms} onChange={(e) => patch('key_terms', e.target.value)} placeholder={'One per line.\nEldrador\nGanadore\nSuper Crystal'} />
          </Field>
          <p className="mt-1 mb-3 text-[11.5px] text-[var(--ss-faint)]">These are sent to the speech engine, so it hears them correctly in the first place{glossaryTerms.length ? `. Your ${glossaryTerms.length} glossary terms are included too.` : '.'}</p>
        </Group>

        <Group title="How to write it" hint={WRITING_STYLES.find((w) => w.value === ctx.writing_style)?.label} defaultOpen>
          <Field label="Writing style"><Select label="Writing style" value={ctx.writing_style === 'spoken' ? 'spoken' : 'clean'} onChange={(v) => patch('writing_style', v)} options={WRITING_STYLES} className="w-full" /></Field>
          <p className="mt-2 text-[11.5px] text-[var(--ss-faint)] leading-snug">Verbatim keeps everyday and slang words exactly as the speaker said them. Non-verbatim gives clean written text.</p>
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
        <Button variant="primary" size="lg" className="w-full" icon={busy === 'polish' ? Loader2 : Wand2} disabled={!!busy || !readable || !filled} onClick={proofread}>
          {busy === 'polish' ? 'Proofreading…' : `Fix names and terms in ${readable} current subtitles`}
        </Button>
        <p className="text-center text-[11.5px] text-[var(--ss-faint)]">
          {!filled ? 'Add some context first.' : 'Timing never changes. The next Generate uses this context automatically.'}
        </p>
      </footer>
    </aside>
  );
}
