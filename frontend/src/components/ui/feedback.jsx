import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

/**
 * App dialogs and toasts that replace the browser's alert, confirm and prompt boxes.
 * Imperative on purpose, so event handlers and async code can call them directly:
 *   notify('Saved', 'success')              -> toast (kinds: info, success, error)
 *   if (!(await confirmDialog({...}))) return;
 *   const name = await promptDialog({...})  -> string, or null when cancelled
 * <FeedbackHost /> must be mounted once (main.jsx).
 */
let state = { toasts: [], dialog: null };
const listeners = new Set();
let seq = 0;
const emit = (next) => { state = next; listeners.forEach((l) => l()); };
const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
const snapshot = () => state;

export function notify(message, kind = 'info', ms) {
  const id = ++seq;
  const life = ms ?? (kind === 'error' ? 8000 : 4000);
  emit({ ...state, toasts: [...state.toasts, { id, message: String(message), kind }] });
  setTimeout(() => dismissToast(id), life);
  return id;
}
function dismissToast(id) {
  emit({ ...state, toasts: state.toasts.filter((t) => t.id !== id) });
}

function openDialog(spec) {
  return new Promise((resolve) => {
    // A second dialog while one is open resolves the first as cancelled.
    state.dialog?.resolve(spec.type === 'prompt' ? null : false);
    emit({ ...state, dialog: { ...spec, resolve } });
  });
}
export function confirmDialog({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false }) {
  return openDialog({ type: 'confirm', title, message, confirmLabel, cancelLabel, danger });
}
export function promptDialog({ title, message, label, placeholder = '', initial = '', confirmLabel = 'Save', cancelLabel = 'Cancel' }) {
  return openDialog({ type: 'prompt', title, message, label, placeholder, initial, confirmLabel, cancelLabel });
}
function closeDialog(value) {
  const d = state.dialog;
  if (!d) return;
  emit({ ...state, dialog: null });
  d.resolve(value);
}

const ICON = { info: Info, success: CheckCircle2, error: AlertTriangle };
const TONE = { info: 'var(--kt-accent-soft)', success: 'var(--kt-success)', error: 'var(--kt-danger)' };

function Dialog({ d }) {
  const [text, setText] = useState(d.initial || '');
  const okRef = useRef(null);
  const inputRef = useRef(null);
  const isPrompt = d.type === 'prompt';
  useEffect(() => { (isPrompt ? inputRef : okRef).current?.focus(); }, [isPrompt]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeDialog(isPrompt ? null : false); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [isPrompt]);
  const submit = () => (isPrompt ? (text.trim() ? closeDialog(text.trim()) : null) : closeDialog(true));
  return (
    <div className="fb-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) closeDialog(isPrompt ? null : false); }}>
      <div className="fb-dialog" role="dialog" aria-modal="true" aria-labelledby="fb-title">
        <h2 id="fb-title" className="nx-display fb-title">{d.title}</h2>
        {d.message && <p className="fb-msg">{d.message}</p>}
        {isPrompt && (
          <label className="fb-field">
            {d.label && <span className="nx-label">{d.label}</span>}
            <input ref={inputRef} className="nx-input" style={{ paddingLeft: 14 }} value={text} placeholder={d.placeholder}
              onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} />
          </label>
        )}
        <div className="fb-actions">
          <button type="button" className="nx-ghost" onClick={() => closeDialog(isPrompt ? null : false)}>{d.cancelLabel}</button>
          <button ref={okRef} type="button" className={d.danger ? 'fb-danger' : 'nx-primary nx-brand-grad'} onClick={submit}>{d.confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

export function FeedbackHost() {
  const s = useSyncExternalStore(subscribe, snapshot);
  return createPortal(
    <>
      {s.dialog && <Dialog key={s.dialog.title + s.dialog.type} d={s.dialog} />}
      <div className="fb-toasts" aria-live="polite">
        {s.toasts.map((t) => {
          const Icon = ICON[t.kind] || Info;
          return (
            <div key={t.id} className="fb-toast" role={t.kind === 'error' ? 'alert' : 'status'}>
              <Icon size={16} style={{ color: TONE[t.kind], flex: 'none', marginTop: 2 }} />
              <span style={{ flex: 1, minWidth: 0, whiteSpace: 'pre-line' }}>{t.message}</span>
              <button type="button" aria-label="Dismiss" className="fb-x" onClick={() => dismissToast(t.id)}><X size={14} /></button>
            </div>
          );
        })}
      </div>
    </>,
    document.body,
  );
}
