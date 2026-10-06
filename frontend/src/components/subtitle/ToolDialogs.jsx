import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRightLeft, ListOrdered, Replace } from 'lucide-react';
import { ModalShell, Button, Segmented, TextInput, Row, Switch } from './ui/controls';
import { countMatches, minShift, parseTimeInput } from './subtitleTools';

const startOf = (e) => e.start_time ?? e.start ?? 0;
const fmt = (t) => {
  const s = Math.max(0, t);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}.${String(Math.floor((s % 1) * 1000)).padStart(3, '0')}`;
};

function useAutofocus() {
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select?.(); }, []);
  return ref;
}

/** Shift all (or the following) subtitles by a fixed amount. */
export function ShiftTimingsDialog({ events, activeEventId, frameRate, onApply, onClose }) {
  const [value, setValue] = useState('0.5');
  const [unit, setUnit] = useState('sec');
  const [scope, setScope] = useState(activeEventId != null ? 'from' : 'all');
  const ref = useAutofocus();

  const fromId = scope === 'from' ? activeEventId : null;
  const delta = useMemo(() => {
    const parsed = parseTimeInput(value, frameRate);
    if (parsed === null) return null;
    return unit === 'frames' && /^-?\d+(\.\d+)?$/.test(value.trim()) ? parsed / (frameRate || 24) : parsed;
  }, [value, unit, frameRate]);

  const affected = useMemo(() => {
    if (fromId == null) return events;
    const i = events.findIndex((e) => (e.id ?? e.event_id) === fromId);
    return i >= 0 ? events.slice(i) : events;
  }, [events, fromId]);

  const clamps = delta !== null && affected.length > 0 && delta < minShift(events, fromId) - 1e-9;
  const ok = delta !== null && delta !== 0 && affected.length > 0;

  const submit = () => { if (ok) { onApply(delta, fromId); onClose(); } };

  return (
    <ModalShell
      title="Shift timings"
      icon={ArrowRightLeft}
      onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!ok} onClick={submit}>Shift {affected.length} subtitle{affected.length === 1 ? '' : 's'}</Button></>}
    >
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-4">
        <div>
          <label htmlFor="shift-amount" className="block text-[12px] text-[var(--ss-muted)] mb-1.5">Amount (negative moves earlier)</label>
          <div className="flex gap-2">
            <TextInput id="shift-amount" ref={ref} value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" className="font-mono" aria-invalid={delta === null} />
            <Segmented label="Unit" value={unit} onChange={setUnit} options={[{ value: 'sec', label: 'Seconds' }, { value: 'frames', label: 'Frames' }]} className="w-48 shrink-0" />
          </div>
          {delta === null && <p className="mt-1.5 text-[11.5px] text-[var(--ss-danger)]">Enter a number such as 0.5, -1.25 or 0:01.500.</p>}
        </div>
        <div>
          <p className="text-[12px] text-[var(--ss-muted)] mb-1.5">Apply to</p>
          <Segmented
            label="Scope"
            value={scope}
            onChange={setScope}
            options={[
              { value: 'all', label: 'All subtitles' },
              { value: 'from', label: 'Selected and after', disabled: activeEventId == null, title: activeEventId == null ? 'Select a subtitle first' : undefined },
            ]}
          />
        </div>
        {ok && affected[0] && (
          <p className="text-[12px] text-[var(--ss-faint)] leading-snug">
            First affected subtitle: <span className="font-mono text-[var(--ss-muted)]">{fmt(startOf(affected[0]))}</span> → <span className="font-mono text-[var(--ss-text)]">{fmt(startOf(affected[0]) + delta)}</span>
            {clamps && <span className="block mt-1 text-[var(--ss-warn)]">Some subtitles would start before 0:00 and will be held at 0:00.</span>}
          </p>
        )}
      </form>
    </ModalShell>
  );
}

/** Jump to a subtitle number or a timecode. */
export function GoToDialog({ eventCount, frameRate, duration, onGoToIndex, onGoToTime, onClose }) {
  const [mode, setMode] = useState('index');
  const [value, setValue] = useState('');
  const ref = useAutofocus();

  const parsed = mode === 'index' ? parseInt(value, 10) : parseTimeInput(value, frameRate);
  const valid = mode === 'index'
    ? Number.isInteger(parsed) && parsed >= 1 && parsed <= eventCount
    : parsed !== null && parsed >= 0 && (!duration || parsed <= duration + 0.5);

  const submit = () => {
    if (!valid) return;
    if (mode === 'index') onGoToIndex(parsed - 1); else onGoToTime(parsed);
    onClose();
  };

  return (
    <ModalShell
      title="Go to"
      icon={ListOrdered}
      onClose={onClose}
      width="max-w-sm"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!valid} onClick={submit}>Go</Button></>}
    >
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-3">
        <Segmented label="Go to" value={mode} onChange={(m) => { setMode(m); setValue(''); }} options={[{ value: 'index', label: 'Subtitle number' }, { value: 'time', label: 'Time' }]} />
        <TextInput
          ref={ref}
          key={mode}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={mode === 'index' ? `1 – ${eventCount}` : 'seconds, 1:02.500 or 00:01:02:12'}
          className="font-mono"
          aria-label={mode === 'index' ? 'Subtitle number' : 'Time'}
        />
        {value && !valid && (
          <p className="text-[11.5px] text-[var(--ss-danger)]">
            {mode === 'index' ? `Pick a number between 1 and ${eventCount}.` : 'Enter a time inside the media, e.g. 62.5 or 1:02.500.'}
          </p>
        )}
      </form>
    </ModalShell>
  );
}

/** Find and replace across every subtitle, with a live match count. */
export function FindReplaceDialog({ events, onReplaceAll, onFindNext, onClose }) {
  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [message, setMessage] = useState('');
  const ref = useAutofocus();

  const counts = useMemo(() => countMatches(events, find, { matchCase, wholeWord }), [events, find, matchCase, wholeWord]);

  const doReplace = () => {
    if (!find) return;
    const { count } = onReplaceAll(find, replace, { matchCase, wholeWord, replaceAll: true });
    setMessage(count > 0 ? `Replaced in ${count} subtitle${count === 1 ? '' : 's'}.` : 'Nothing to replace.');
  };

  return (
    <ModalShell
      title="Find and replace"
      icon={Replace}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button disabled={!counts.subtitles} onClick={() => onFindNext(find, { matchCase, wholeWord })}>Find next</Button>
          <Button variant="primary" disabled={!counts.subtitles} onClick={doReplace}>Replace all</Button>
        </>
      }
    >
      <form onSubmit={(e) => { e.preventDefault(); onFindNext(find, { matchCase, wholeWord }); }} className="space-y-3">
        <div>
          <label htmlFor="fr-find" className="block text-[12px] text-[var(--ss-muted)] mb-1.5">Find</label>
          <TextInput id="fr-find" ref={ref} value={find} onChange={(e) => { setFind(e.target.value); setMessage(''); }} />
        </div>
        <div>
          <label htmlFor="fr-replace" className="block text-[12px] text-[var(--ss-muted)] mb-1.5">Replace with</label>
          <TextInput id="fr-replace" value={replace} onChange={(e) => setReplace(e.target.value)} />
        </div>
        <div className="rounded-xl border border-[var(--ss-line)] divide-y divide-[var(--ss-line)]/70">
          <Row label="Match case"><Switch checked={matchCase} onChange={setMatchCase} label="Match case" /></Row>
          <Row label="Whole word"><Switch checked={wholeWord} onChange={setWholeWord} label="Whole word" /></Row>
        </div>
        <p className="text-[12px] text-[var(--ss-faint)] min-h-[18px]" role="status">
          {message || (find ? `${counts.occurrences} match${counts.occurrences === 1 ? '' : 'es'} in ${counts.subtitles} subtitle${counts.subtitles === 1 ? '' : 's'}` : 'Type something to search.')}
        </p>
      </form>
    </ModalShell>
  );
}
