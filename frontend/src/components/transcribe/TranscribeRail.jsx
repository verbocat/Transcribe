import React, { useEffect, useRef, useState } from 'react';
import { Languages, ShieldCheck, Download, Loader2, Check, Square, Clapperboard } from 'lucide-react';

const FORMATS = [
  { id: 'xlsx', label: 'Excel', ext: '.xlsx', note: 'Data and audit summary' },
  { id: 'csv', label: 'CSV', ext: '.csv', note: 'Lower Third deliverable columns' },
  { id: 'docx', label: 'Word', ext: '.docx', note: 'Readable transcript table' },
  { id: 'srt', label: 'SubRip', ext: '.srt', note: 'Subtitle file with speaker tags' },
  { id: 'vtt', label: 'WebVTT', ext: '.vtt', note: 'Web subtitle file' },
  { id: 'txt', label: 'Plain text', ext: '.txt', note: 'Timed transcript' },
  { id: 'json', label: 'JSON', ext: '.json', note: 'Segment list' },
];


/**
 * Left tool rail for Transcribe Studio, same look as Subtitle Studio's rail:
 * icon over label, accent glow when a panel is open. Holds Translate, QC and Export.
 */
export default function TranscribeRail({
  disabled, translateOpen, onTranslate, qcOpen, onQc, qcIssues,
  formats, onToggleFormat, onDownload, onDubbing, isExporting, onCancelExport,
  exportLang, exportLangOptions, onExportLang,
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const btn = (id, label, Icon, on, onClick, title, extra) => (
    <button
      type="button" className="ts-rail-btn" data-on={on ? 'true' : 'false'} disabled={disabled}
      aria-label={label} aria-pressed={on} title={title || label} onClick={onClick}
    >
      {on && <span aria-hidden="true" className="ts-rail-mark" />}
      <Icon size={20} strokeWidth={1.8} />
      <span>{label}</span>
      {extra}
    </button>
  );

  return (
    <aside className="ts-rail" aria-label="Tools">
      {btn('translate', 'Translate', Languages, translateOpen, onTranslate, 'Translate the transcript with Centroid')}
      {btn('qc', 'QC', ShieldCheck, qcOpen, onQc, `Quality check${qcIssues != null ? ` · ${qcIssues} issues` : ''}`,
        qcIssues != null && <span className="ts-rail-badge">{qcIssues}</span>)}
      <span className="ts-rail-sep" aria-hidden="true" />
      <div className="relative" ref={ref}>
        {isExporting && onCancelExport
          ? btn('cancel', 'Cancel', Square, true, onCancelExport, 'Stop the export')
          : btn('export', 'Export', Download, open, () => setOpen(!open), 'Export the transcript')}
        {open && (
          <div className="ts-popover ts-rail-pop" role="menu">
            <label style={{ display: 'block', padding: '6px 10px 4px' }}>
              <span style={{ color: 'var(--ts-faint)', fontSize: 12, display: 'block', marginBottom: 4 }}>Language</span>
              <select className="ts-field" style={{ width: '100%' }} value={exportLang} onChange={(e) => onExportLang(e.target.value)}
                aria-label="Export language" disabled={exportLangOptions.length < 2}>
                {exportLangOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              {exportLangOptions.length < 2 && (
                <span style={{ color: 'var(--ts-faint)', fontSize: 12, display: 'block', marginTop: 4 }}>Translate the transcript to export other languages</span>
              )}
            </label>
            <p style={{ color: 'var(--ts-faint)', fontSize: 12, padding: '6px 10px 4px' }}>Choose one or more formats</p>
            {FORMATS.map((f) => {
              const on = formats.includes(f.id);
              return (
                <button key={f.id} type="button" role="menuitemcheckbox" aria-checked={on} className="ts-menu-item" onClick={() => onToggleFormat(f.id)}>
                  <span style={{ width: 18, height: 18, borderRadius: 5, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${on ? 'var(--ts-accent)' : 'var(--ts-line)'}`, background: on ? 'var(--ts-accent)' : 'transparent', color: 'var(--ts-accent-ink)', flex: 'none' }}>
                    {on && <Check size={12} strokeWidth={3} />}
                  </span>
                  <span className="flex-1">
                    <span style={{ fontWeight: 500 }}>{f.label}</span>{' '}
                    <span className="ts-mono" style={{ color: 'var(--ts-faint)', fontSize: 12 }}>{f.ext}</span>
                    <span style={{ display: 'block', color: 'var(--ts-faint)', fontSize: 12 }}>{f.note}</span>
                  </span>
                </button>
              );
            })}
            <button type="button" className="ts-btn ts-btn-primary" style={{ width: '100%', margin: '8px 0 4px' }}
              disabled={isExporting || !formats.length} onClick={() => { onDownload(); setOpen(false); }}>
              {isExporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              Download {formats.length} {formats.length === 1 ? 'format' : 'formats'}
            </button>
            <div style={{ borderTop: '1px solid var(--ts-line)', margin: '6px 0' }} />
            <button type="button" role="menuitem" className="ts-menu-item" disabled={isExporting} onClick={() => { onDubbing(); setOpen(false); }}>
              <Clapperboard size={16} style={{ color: 'var(--ts-accent)' }} />
              <span className="flex-1">
                <span style={{ fontWeight: 500 }}>Dubbing script</span>{' '}
                <span className="ts-mono" style={{ color: 'var(--ts-faint)', fontSize: 12 }}>.xlsx</span>
                <span style={{ display: 'block', color: 'var(--ts-faint)', fontSize: 12 }}>Time in, time out, dialogue, character</span>
              </span>
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
