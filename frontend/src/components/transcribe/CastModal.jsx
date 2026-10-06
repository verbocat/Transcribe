import React, { useEffect, useMemo, useState } from 'react';
import { X, Users } from 'lucide-react';
import { parseCast, castToText } from './castUtils';

export default function CastModal({ isOpen, cast, onSave, onClose }) {
  const [text, setText] = useState('');

  useEffect(() => { if (isOpen) setText(castToText(cast)); }, [isOpen, cast]);
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const parsed = useMemo(() => parseCast(text), [text]);
  if (!isOpen) return null;

  return (
    <div
      role="dialog" aria-modal="true" aria-label="Cast list"
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ zIndex: 70, background: 'rgba(5,7,11,0.78)', backdropFilter: 'blur(6px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ width: '100%', maxWidth: 560, maxHeight: '88vh', display: 'flex', flexDirection: 'column', background: 'var(--ts-panel)', border: '1px solid var(--ts-line)', borderRadius: 16, color: 'var(--ts-text)', boxShadow: '0 24px 64px rgba(0,0,0,0.55)' }}>
        <div className="flex items-center justify-between" style={{ padding: '16px 20px', borderBottom: '1px solid var(--ts-line)' }}>
          <div className="flex items-center gap-2.5">
            <Users size={18} style={{ color: 'var(--ts-accent)' }} />
            <div>
              <h2 style={{ fontWeight: 600, fontSize: 15 }}>Cast list</h2>
              <p style={{ color: 'var(--ts-muted)', fontSize: 12 }}>Characters and genders for this show. Assign them to speakers in one click.</p>
            </div>
          </div>
          <button type="button" className="ts-btn ts-btn-ghost ts-btn-icon" aria-label="Close" onClick={onClose}><X size={16} /></button>
        </div>

        <div style={{ padding: 20, overflowY: 'auto' }}>
          <label htmlFor="ts-cast-text" style={{ fontSize: 12, color: 'var(--ts-muted)' }}>
            One per line as <span className="ts-mono">Name, Gender</span>. You can paste the Character List straight from Excel.
          </label>
          <textarea
            id="ts-cast-text" className="ts-field" spellCheck={false}
            style={{ width: '100%', height: 170, padding: 10, marginTop: 8, fontFamily: 'var(--ts-font-mono)', fontSize: 12.5, resize: 'vertical' }}
            placeholder={'Bhide, Male\nTulsi, Female\nBunty, Male'}
            value={text} onChange={(e) => setText(e.target.value)}
          />
          <div className="flex flex-wrap gap-1.5" style={{ marginTop: 12, minHeight: 28 }}>
            {parsed.length === 0 && <span style={{ color: 'var(--ts-faint)', fontSize: 12 }}>No characters recognised yet.</span>}
            {parsed.map((c) => (
              <span key={c.name} className={`ts-chip ${c.gender === 'Female' ? 'ts-chip-accent' : ''}`}>{c.name} · {c.gender}</span>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between" style={{ padding: '14px 20px', borderTop: '1px solid var(--ts-line)' }}>
          <span style={{ color: 'var(--ts-muted)', fontSize: 12 }}>{parsed.length} {parsed.length === 1 ? 'character' : 'characters'}</span>
          <div className="flex gap-2">
            <button type="button" className="ts-btn" onClick={onClose}>Cancel</button>
            <button type="button" className="ts-btn ts-btn-primary" onClick={() => { onSave(parsed); onClose(); }}>Save cast</button>
          </div>
        </div>
      </div>
    </div>
  );
}
