import React, { useEffect, useRef, useState } from 'react';
import { nameSuggestions } from './speakerNames';

/**
 * Text field that completes names as you type: type "H" and "imanshu" is filled in (selected), Enter or Tab keeps it,
 * Backspace drops the suggestion. Suggestions also list below for a click. Enter commits, Escape cancels.
 */
export default function NameInput({ value, onCommit, current, cast, label, autoFocus }) {
  const [draft, setDraft] = useState(null); // null = showing the saved value
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState(-1);
  const inputRef = useRef(null);
  const typed = draft ?? value;
  const options = draft === null ? [] : nameSuggestions(draft, { current, cast, exclude: [value] });

  // Inline completion: select the remainder of the best match so the next key replaces it
  const pendingCompletion = useRef(null);
  useEffect(() => {
    const el = inputRef.current;
    const full = pendingCompletion.current;
    pendingCompletion.current = null;
    if (el && full && document.activeElement === el && full.toLowerCase().startsWith(el.value.toLowerCase())) {
      el.value = full;
      el.setSelectionRange(draft.length, full.length);
    }
  });

  const finish = (text) => {
    const clean = (text ?? typed).trim();
    setDraft(null); setOpen(false); setPick(-1);
    if (clean && clean !== value) onCommit(clean);
  };

  const onChange = (e) => {
    const next = e.target.value;
    const grew = draft !== null && next.length > draft.length;
    setDraft(next); setOpen(true); setPick(-1);
    if (grew || draft === null) {
      const best = nameSuggestions(next, { current, cast, exclude: [value] })[0];
      if (best && best.length > next.length) pendingCompletion.current = best;
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown' && options.length) { e.preventDefault(); setPick((p) => (p + 1) % options.length); }
    else if (e.key === 'ArrowUp' && options.length) { e.preventDefault(); setPick((p) => (p <= 0 ? options.length - 1 : p - 1)); }
    else if (e.key === 'Enter' || (e.key === 'Tab' && draft !== null && options.length && inputRef.current?.selectionStart !== inputRef.current?.selectionEnd)) {
      e.preventDefault();
      finish(pick >= 0 ? options[pick] : inputRef.current?.value);
    } else if (e.key === 'Escape') { e.stopPropagation(); setDraft(null); setOpen(false); setPick(-1); inputRef.current?.blur(); }
  };

  return (
    <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
      <input
        ref={inputRef} autoFocus={autoFocus}
        aria-label={label} className="ts-field ts-field-sm font-semibold" style={{ width: '100%' }}
        value={typed} onChange={onChange} onKeyDown={onKeyDown}
        onFocus={(e) => e.target.select()}
        onBlur={() => setTimeout(() => { if (draft !== null) finish(inputRef.current?.value ?? draft); }, 120)}
        autoComplete="off" spellCheck={false}
        placeholder="Type a name"
      />
      {open && options.length > 0 && (
        <ul
          role="listbox"
          style={{ position: 'absolute', zIndex: 5, left: 0, right: 0, top: 'calc(100% + 4px)', margin: 0, padding: 4, listStyle: 'none', background: 'var(--ts-raised)', border: '1px solid var(--ts-line)', borderRadius: 8, boxShadow: '0 12px 32px rgba(0,0,0,0.45)' }}
        >
          {options.map((n, i) => (
            <li
              key={n} role="option" aria-selected={i === pick}
              onMouseDown={(e) => { e.preventDefault(); finish(n); }}
              style={{ padding: '6px 8px', borderRadius: 6, cursor: 'pointer', background: i === pick ? 'var(--ts-selected)' : 'transparent' }}
            >
              <strong>{n.slice(0, draft?.trim().length || 0)}</strong>{n.slice(draft?.trim().length || 0)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
