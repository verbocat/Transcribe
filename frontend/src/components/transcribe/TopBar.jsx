import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, Sparkles, Upload, Undo2, Redo2, Download, Save, MoreHorizontal, Loader2, Check,
  FolderOpen, BarChart2, GitCompare, StickyNote, BookOpen, FileUp, Clapperboard, Languages, Palette, Square
} from 'lucide-react';
import NotificationBellDropdown from '../NotificationBellDropdown';
import AccountMenuDropdown from '../AccountMenuDropdown';
import { openAppearance } from '../../theme/themeEngine';

const FORMATS = [
  { id: 'xlsx', label: 'Excel', ext: '.xlsx', note: 'Data and audit summary' },
  { id: 'csv', label: 'CSV', ext: '.csv', note: 'Karya deliverable columns' },
  { id: 'docx', label: 'Word', ext: '.docx', note: 'Readable transcript table' },
  { id: 'srt', label: 'SubRip', ext: '.srt', note: 'Subtitle file with speaker tags' },
  { id: 'vtt', label: 'WebVTT', ext: '.vtt', note: 'Web subtitle file' },
  { id: 'txt', label: 'Plain text', ext: '.txt', note: 'Timed transcript' },
  { id: 'json', label: 'JSON', ext: '.json', note: 'Segment list' },
];

const LANGUAGES = [
  ['Auto-Detect', 'Auto-detect'], ['Hindi', 'Hindi (हिन्दी)'], ['English', 'English'], ['Marathi', 'Marathi (मराठी)'],
  ['Bengali', 'Bengali (বাংলা)'], ['Tamil', 'Tamil (தமிழ்)'], ['Telugu', 'Telugu (తెలుగు)'],
  ['Gujarati', 'Gujarati (ગુજરાતી)'], ['Kannada', 'Kannada (ಕನ್ನಡ)'],
];
const SCRIPTS = [
  ['Auto-Detect', 'Auto-detect'], ['Devanagari', 'Devanagari'], ['Latin', 'Latin / English'], ['Bengali', 'Bengali'],
  ['Tamil', 'Tamil'], ['Telugu', 'Telugu'], ['Gujarati', 'Gujarati'], ['Kannada', 'Kannada'],
];

function usePopover() {
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
  return { open, setOpen, ref };
}

function ExportMenu({ formats, onToggle, onDownload, onDubbing, isExporting, hasSegments, onCancelExport }) {
  const { open, setOpen, ref } = usePopover();
  if (isExporting && onCancelExport) {
    return (
      <button type="button" className="ts-btn" onClick={onCancelExport} title="Stop the export">
        <Square size={14} /> Cancel export
      </button>
    );
  }
  return (
    <div className="relative" ref={ref}>
      <button type="button" className="ts-btn" disabled={!hasSegments} onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu">
        <Download size={14} /> Export
      </button>
      {open && (
        <div className="ts-popover" role="menu" style={{ width: 320 }}>
          <p style={{ color: 'var(--ts-faint)', fontSize: 12, padding: '6px 10px 4px' }}>Choose one or more formats</p>
          {FORMATS.map((f) => {
            const on = formats.includes(f.id);
            return (
              <button key={f.id} type="button" role="menuitemcheckbox" aria-checked={on} className="ts-menu-item" onClick={() => onToggle(f.id)}>
                <span
                  style={{
                    width: 18, height: 18, borderRadius: 5, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    border: `1px solid ${on ? 'var(--ts-accent)' : 'var(--ts-line)'}`, background: on ? 'var(--ts-accent)' : 'transparent',
                    color: 'var(--ts-accent-ink)', flex: 'none',
                  }}
                >
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
          <button
            type="button" className="ts-btn ts-btn-primary" style={{ width: '100%', margin: '8px 0 4px' }}
            disabled={isExporting} onClick={() => { onDownload(); setOpen(false); }}
          >
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
  );
}

function MoreMenu({ items }) {
  const { open, setOpen, ref } = usePopover();
  return (
    <div className="relative" ref={ref}>
      <button type="button" className="ts-btn ts-btn-ghost ts-btn-icon" title="More" aria-label="More" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu">
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div className="ts-popover" role="menu" style={{ minWidth: 220 }}>
          {items.map((it) => (
            <button key={it.label} type="button" role="menuitem" className="ts-menu-item" onClick={() => { setOpen(false); it.onClick(); }}>
              <it.icon size={15} style={{ color: 'var(--ts-muted)' }} /> {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function TopBar(p) {
  const importRef = useRef(null);
  const hasSegments = p.segmentCount > 0;
  const passing = p.complianceScore != null && p.complianceScore >= 98;

  return (
    <header className="flex items-center gap-3 px-4 shrink-0" style={{ height: 56, background: 'var(--ts-panel)', borderBottom: '1px solid var(--ts-line)' }}>
      <button type="button" className="ts-btn ts-btn-ghost ts-btn-icon" title="Back to home" aria-label="Back to home" onClick={p.onBackToHome}>
        <ArrowLeft size={16} />
      </button>

      <div className="flex items-center gap-2.5 min-w-0">
        <div style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--ts-accent)', color: 'var(--ts-accent-ink)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Sparkles size={15} fill="currentColor" />
        </div>
        <div className="min-w-0">
          <div style={{ fontWeight: 600, lineHeight: 1.1 }}>Transcribe</div>
          <div className="truncate" style={{ color: 'var(--ts-faint)', fontSize: 12, maxWidth: 220 }}>
            {p.filename || 'No media loaded'}
          </div>
        </div>
      </div>

      <div style={{ width: 1, height: 24, background: 'var(--ts-line)' }} />

      <input id="ts-media-input" type="file" className="hidden" onChange={p.onFileSelect}
        accept="audio/*,video/*,.wav,.mp3,.m4a,.flac,.ogg,.aac,.mp4,.mkv,.mov,.webm,.avi,.flv,.wmv,.wma,audio/x-ms-wma,audio/wma" />
      <label htmlFor="ts-media-input" className="ts-btn" style={{ cursor: 'pointer' }}>
        {p.isExtractingAudio ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
        {p.isExtractingAudio ? 'Preparing audio' : p.filename ? 'Change media' : 'Import media'}
      </label>

      <label className="flex items-center gap-2" style={{ color: 'var(--ts-muted)', fontSize: 12 }}>
        <Languages size={14} />
        <select className="ts-field" value={p.language} onChange={(e) => p.setLanguage(e.target.value)} aria-label="Language">
          {LANGUAGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <select className="ts-field" value={p.script} onChange={(e) => p.setScript(e.target.value)} aria-label="Script">
        {SCRIPTS.map(([v, l]) => <option key={v} value={v}>Script: {l}</option>)}
      </select>

      <button type="button" className="ts-btn ts-btn-primary" disabled={!p.canTranscribe || p.isTranscribing} onClick={p.onTranscribe}>
        {p.isTranscribing ? <><Loader2 size={14} className="animate-spin" /> Transcribing {Math.round(p.progressPercent)}%</> : <><Sparkles size={14} /> Transcribe</>}
      </button>

      <span className="flex-1" />

      {hasSegments && (
        <span className={`ts-chip ${passing ? 'ts-chip-accent' : p.totalErrors ? 'ts-chip-danger' : 'ts-chip-warn'}`} title={`${p.totalErrors} errors, ${p.totalWarnings} warnings`}>
          QC {p.complianceScore?.toFixed(1)}%
        </span>
      )}

      <div className="flex items-center gap-0.5">
        <button type="button" className="ts-btn ts-btn-ghost ts-btn-icon" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!p.canUndo} onClick={p.onUndo}><Undo2 size={15} /></button>
        <button type="button" className="ts-btn ts-btn-ghost ts-btn-icon" title="Redo (Ctrl+Y)" aria-label="Redo" disabled={!p.canRedo} onClick={p.onRedo}><Redo2 size={15} /></button>
      </div>

      <button type="button" className="ts-btn" disabled={!hasSegments || p.isSaving} onClick={p.onSave} title="Save to cloud (Ctrl+S)">
        {p.isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
      </button>

      <ExportMenu
        formats={p.exportFormats} onToggle={p.onToggleFormat} onDownload={p.onDownload}
        onDubbing={p.onDubbing} isExporting={p.isExporting} hasSegments={hasSegments} onCancelExport={p.onCancelExport}
      />

      <input ref={importRef} type="file" accept=".srt,.vtt,.txt" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) p.onImportSubtitles(f); e.target.value = ''; }} />
      <MoreMenu items={[
        { label: 'Saved projects', icon: FolderOpen, onClick: p.onOpenProjects },
        { label: 'Import subtitle file', icon: FileUp, onClick: () => importRef.current?.click() },
        { label: 'Statistics', icon: BarChart2, onClick: p.onOpenStats },
        { label: 'Compare with original', icon: GitCompare, onClick: p.onOpenDiff },
        { label: 'Project notes', icon: StickyNote, onClick: p.onOpenNotes },
        { label: 'Guidelines', icon: BookOpen, onClick: p.onOpenGuidelines },
        { label: 'Appearance', icon: Palette, onClick: openAppearance },
      ]} />

      <button type="button" className="ts-btn" title="Customise colours, fonts and layout" onClick={openAppearance}><Palette size={14} style={{ color: 'var(--ts-accent)' }} /> Appearance</button>

      {p.user && <NotificationBellDropdown />}
      {p.user && <AccountMenuDropdown user={p.user} onOpenLogoutModal={p.onOpenLogoutModal} />}
    </header>
  );
}
