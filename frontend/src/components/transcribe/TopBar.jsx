import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, Sparkles, Upload, Undo2, Redo2, Download, Save, Loader2, Check,
  FolderOpen, BarChart2, GitCompare, StickyNote, BookOpen, FileUp, Clapperboard, Languages, Palette, ShieldCheck, Square,
  Users, LayoutPanelLeft, RotateCcw, ChevronDown, AudioLines, MoreHorizontal
} from 'lucide-react';
import BrandLogo from '../BrandLogo';
import StudioMenuBar from '../subtitle/StudioMenuBar';
import NotificationBellDropdown from '../NotificationBellDropdown';
import AccountMenuDropdown from '../AccountMenuDropdown';
import { openAppearance } from '../../theme/themeEngine';

const FORMATS = [
  { id: 'xlsx', label: 'Excel', ext: '.xlsx', note: 'Data and audit summary' },
  { id: 'csv', label: 'CSV', ext: '.csv', note: 'Lower Third deliverable columns' },
  { id: 'docx', label: 'Word', ext: '.docx', note: 'Readable transcript table' },
  { id: 'srt', label: 'SubRip', ext: '.srt', note: 'Subtitle file with speaker tags' },
  { id: 'vtt', label: 'WebVTT', ext: '.vtt', note: 'Web subtitle file' },
  { id: 'txt', label: 'Plain text', ext: '.txt', note: 'Timed transcript' },
  { id: 'json', label: 'JSON', ext: '.json', note: 'Segment list' },
];

export const LANGUAGES = [
  ['Auto-Detect', 'Auto-detect'], ['Hindi', 'Hindi (हिन्दी)'], ['English', 'English'], ['Marathi', 'Marathi (मराठी)'],
  ['Bengali', 'Bengali (বাংলা)'], ['Tamil', 'Tamil (தமிழ்)'], ['Telugu', 'Telugu (తెలుగు)'],
  ['Gujarati', 'Gujarati (ગુજરાતી)'], ['Kannada', 'Kannada (ಕನ್ನಡ)'],
];
export const SCRIPTS = [
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

function TranscribeSettings({ language, script, setLanguage, setScript }) {
  const { open, setOpen, ref } = usePopover();
  const langLabel = (LANGUAGES.find(([v]) => v === language) || [null, language])[1].replace(/ \(.*\)$/, '');
  return (
    <div className="relative" ref={ref}>
      <button type="button" className="ts-btn ts-btn-sm" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="dialog" title="Language and script settings">
        <Languages size={14} className="shrink-0" />
        <span className="truncate" style={{ maxWidth: 'min(190px, 16vw)' }}>{langLabel}<span style={{ color: 'var(--ts-faint)' }}> · {scriptLabel}</span></span>
        <ChevronDown size={13} className="shrink-0" style={{ color: 'var(--ts-faint)' }} />
      </button>
      {open && (
        <div className="ts-popover" role="dialog" aria-label="Transcription settings" style={{ left: '50%', right: 'auto', transform: 'translateX(-50%)', width: 260, padding: 12 }}>
          <label style={{ display: 'block', fontSize: 12, color: 'var(--ts-muted)', marginBottom: 4 }}>Language</label>
          <select className="ts-field" style={{ width: '100%' }} value={language} onChange={(e) => setLanguage(e.target.value)} aria-label="Language">
            {LANGUAGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <label style={{ display: 'block', fontSize: 12, color: 'var(--ts-muted)', margin: '12px 0 4px' }}>Script</label>
          <select className="ts-field" style={{ width: '100%' }} value={script} onChange={(e) => setScript(e.target.value)} aria-label="Script">
            {SCRIPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      )}
    </div>
  );
}

function ExportMenu({ formats, onToggle, onDownload, onDubbing, isExporting, hasSegments, onCancelExport, lang, langOptions, onLang }) {
  const { open, setOpen, ref } = usePopover();
  if (isExporting && onCancelExport) {
    return (
      <button type="button" className="ts-btn ts-btn-sm" onClick={onCancelExport} title="Stop the export">
        <Square size={14} /> Cancel
      </button>
    );
  }
  return (
    <div className="relative" ref={ref}>
      <button type="button" className="ts-btn ts-btn-ghost ts-btn-icon" disabled={!hasSegments} onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu" title="Export">
        <Download size={16} />
      </button>
      {open && (
        <div className="ts-popover" role="menu" style={{ width: 320 }}>
          <label style={{ display: 'block', padding: '6px 10px 4px' }}>
            <span style={{ color: 'var(--ts-faint)', fontSize: 12, display: 'block', marginBottom: 4 }}>Language</span>
            <select
              className="ts-field" style={{ width: '100%' }} value={lang} onChange={(e) => onLang(e.target.value)}
              aria-label="Export language" disabled={langOptions.length < 2}
            >
              {langOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {langOptions.length < 2 && (
              <span style={{ color: 'var(--ts-faint)', fontSize: 12, display: 'block', marginTop: 4 }}>Translate the transcript to export other languages</span>
            )}
          </label>
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

/** More actions dropdown — consolidates less-used actions into a single icon button */
function MoreActionsMenu({ p, hasSegments, importRef }) {
  const { open, setOpen, ref } = usePopover();
  return (
    <div className="relative" ref={ref}>
      <button type="button" className="ts-btn ts-btn-ghost ts-btn-icon" onClick={() => setOpen(!open)} title="More actions" aria-expanded={open} aria-haspopup="menu">
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div className="ts-popover" role="menu" style={{ width: 260 }}>
          <button type="button" className="ts-menu-item" onClick={() => { setOpen(false); importRef.current?.click(); }}>
            <FileUp size={14} /> <span className="flex-1">Import subtitle file…</span>
          </button>
          <button type="button" className="ts-menu-item" onClick={() => { setOpen(false); p.onOpenProjects(); }}>
            <FolderOpen size={14} /> <span className="flex-1">Saved projects…</span>
          </button>
          <div role="separator" className="h-px my-1.5 mx-2" style={{ background: 'var(--ts-line)' }} />
          <button type="button" className="ts-menu-item" disabled={!hasSegments} onClick={() => { setOpen(false); p.onOpenStats(); }}>
            <BarChart2 size={14} /> <span className="flex-1">Statistics</span>
          </button>
          <button type="button" className="ts-menu-item" disabled={!hasSegments} onClick={() => { setOpen(false); p.onOpenDiff(); }}>
            <GitCompare size={14} /> <span className="flex-1">Compare with original</span>
          </button>
          <button type="button" className="ts-menu-item" onClick={() => { setOpen(false); p.onOpenNotes(); }}>
            <StickyNote size={14} /> <span className="flex-1">Project notes</span>
          </button>
          <div role="separator" className="h-px my-1.5 mx-2" style={{ background: 'var(--ts-line)' }} />
          <button type="button" className="ts-menu-item" onClick={() => { setOpen(false); p.onOpenGuidelines(); }}>
            <BookOpen size={14} /> <span className="flex-1">Guidelines</span>
          </button>
          <button type="button" className="ts-menu-item" onClick={() => { setOpen(false); openAppearance(); }}>
            <Palette size={14} /> <span className="flex-1">Appearance…</span>
          </button>
        </div>
      )}
    </div>
  );
}

export default function TopBar(p) {
  const importRef = useRef(null);
  const hasSegments = p.segmentCount > 0;
  const passing = p.complianceScore != null && p.complianceScore >= 98;
  const pickMedia = () => document.getElementById('ts-media-input')?.click();

  const menus = [
    { id: 'file', label: 'File', items: [
      { label: 'Import subtitle file…', icon: FileUp, onSelect: () => importRef.current?.click() },
      { label: 'Saved projects…', icon: FolderOpen, onSelect: p.onOpenProjects },
      { type: 'separator' },
      { label: 'Save to cloud', icon: Save, shortcut: 'Ctrl+S', onSelect: p.onSave, disabled: !hasSegments || p.isSaving },
      { label: `Download ${p.exportFormats.length} ${p.exportFormats.length === 1 ? 'format' : 'formats'}`, icon: Download, onSelect: p.onDownload, disabled: !hasSegments || p.isExporting },
      { label: 'Dubbing script (.xlsx)', icon: Clapperboard, onSelect: p.onDubbing, disabled: !hasSegments || p.isExporting },
      { type: 'separator' },
      { label: 'Back to home', icon: ArrowLeft, onSelect: p.onBackToHome },
    ] },
    { id: 'edit', label: 'Edit', items: [
      { label: 'Undo', icon: Undo2, shortcut: 'Ctrl+Z', onSelect: p.onUndo, disabled: !p.canUndo },
      { label: 'Redo', icon: Redo2, shortcut: 'Ctrl+Y', onSelect: p.onRedo, disabled: !p.canRedo },
      { type: 'separator' },
      { label: 'Speakers…', icon: Users, onSelect: p.onOpenSpeakers, disabled: !hasSegments },
      { label: 'Project notes', icon: StickyNote, onSelect: p.onOpenNotes },
    ] },
    { id: 'view', label: 'View', items: [
      { label: p.timelineHidden ? 'Show timeline' : 'Hide timeline', icon: AudioLines, onSelect: p.onToggleTimeline },
      { label: 'Layout…', icon: LayoutPanelLeft, onSelect: p.onOpenLayout },
      { label: 'Reset layout', icon: RotateCcw, onSelect: p.onResetLayout },
      { label: 'Appearance…', icon: Palette, onSelect: openAppearance },
      { type: 'separator' },
      { label: 'Statistics', icon: BarChart2, onSelect: p.onOpenStats, disabled: !hasSegments },
      { label: 'Compare with original', icon: GitCompare, onSelect: p.onOpenDiff, disabled: !hasSegments },
    ] },
    { id: 'tools', label: 'Tools', items: [
      { label: 'Translate…', icon: Languages, onSelect: p.onOpenTranslate, disabled: !hasSegments },
      { label: 'Quality check', icon: ShieldCheck, onSelect: p.onOpenQc, disabled: !hasSegments },
    ] },
    { id: 'help', label: 'Help', items: [
      { label: 'Guidelines', icon: BookOpen, onSelect: p.onOpenGuidelines },
    ] },
  ];

  return (
    <header className="ts-topbar">
      {/* Left group: logo + menu bar */}
      <div className="ts-topbar-left">
        <button type="button" className="ts-btn ts-btn-ghost ts-btn-icon" title="Back to home" aria-label="Back to home" onClick={p.onBackToHome} style={{ width: 28, height: 28 }}>
          <ArrowLeft size={15} />
        </button>

        <BrandLogo variant="wordmark" size={24} />

        <span className="ts-topbar-divider" aria-hidden="true" />

        <div className="shrink-0">
          <div className="hidden xl:block"><StudioMenuBar menus={menus} /></div>
          <div className="xl:hidden"><StudioMenuBar menus={menus} compact /></div>
        </div>
      </div>

      <input id="ts-media-input" type="file" className="hidden" onChange={p.onFileSelect}
        accept="audio/*,video/*,.wav,.mp3,.m4a,.flac,.ogg,.aac,.mp4,.mkv,.mov,.webm,.avi,.flv,.wmv,.wma,audio/x-ms-wma,audio/wma" />
      <input ref={importRef} type="file" accept=".srt,.vtt,.txt" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) p.onImportSubtitles(f); e.target.value = ''; }} />

      {/* Centre: the one set of media controls, always visible: media file, language and script, Transcribe */}
      <div className="ts-topbar-center">
        <button
          type="button" onClick={pickMedia} disabled={p.isExtractingAudio}
          className="ts-btn min-w-0" style={{ maxWidth: 'min(240px, 28vw)' }} title={p.filename ? `${p.filename} (click to change media)` : 'Import a video or audio file'}
        >
          {p.isExtractingAudio ? <Loader2 size={14} className="animate-spin shrink-0" /> : <Upload size={14} className="shrink-0" />}
          <span className="truncate">{p.isExtractingAudio ? 'Preparing audio' : p.filename || 'Import media'}</span>
        </button>
        <TranscribeSettings language={p.language} script={p.script} setLanguage={p.setLanguage} setScript={p.setScript} />
        <button type="button" className="ts-btn ts-btn-primary shrink-0" disabled={!p.canTranscribe || p.isTranscribing || p.isExtractingAudio} onClick={p.onTranscribe} title={p.canTranscribe ? 'Transcribe this media' : 'Import media first'}>
          {p.isTranscribing ? <><Loader2 size={14} className="animate-spin" /> {Math.round(p.progressPercent)}%</> : <><Sparkles size={14} /> Transcribe</>}
        </button>
        {hasSegments && (
          <span className={`ts-chip ${passing ? 'ts-chip-accent' : p.totalErrors ? 'ts-chip-danger' : 'ts-chip-warn'}`} title={`${p.totalErrors} errors, ${p.totalWarnings} warnings`} style={{ height: 22, fontSize: 11 }}>
            {p.complianceScore?.toFixed(1)}%
          </span>
        )}
      </div>

      {/* Right group: icon buttons for key actions + overflow */}
      <div className="ts-topbar-right">
        <button type="button" className={`ts-btn ts-btn-ghost ts-btn-icon ${p.speakersOpen ? 'ts-topbar-active' : ''}`} disabled={!hasSegments} onClick={p.onOpenSpeakers} aria-pressed={p.speakersOpen} title="Speakers">
          <Users size={16} />
        </button>
        <button type="button" className={`ts-btn ts-btn-ghost ts-btn-icon ${p.translateOpen ? 'ts-topbar-active' : ''}`} disabled={!hasSegments} onClick={p.onOpenTranslate} aria-pressed={p.translateOpen} title="Translate">
          <Languages size={16} />
        </button>
        <button type="button" className={`ts-btn ts-btn-ghost ts-btn-icon ${p.qcOpen ? 'ts-topbar-active' : ''}`} disabled={!hasSegments} onClick={p.onOpenQc} aria-pressed={p.qcOpen} title={`QC${p.centroidQcIssues != null ? ` · ${p.centroidQcIssues} issues` : ''}`}>
          <ShieldCheck size={16} />
          {p.centroidQcIssues != null && <span className="ts-topbar-badge">{p.centroidQcIssues}</span>}
        </button>

        <span className="ts-topbar-divider" aria-hidden="true" />

        <button type="button" className="ts-btn ts-btn-ghost ts-btn-icon" disabled={!p.canUndo} onClick={p.onUndo} title="Undo (Ctrl+Z)" aria-label="Undo">
          <Undo2 size={15} />
        </button>
        <button type="button" className="ts-btn ts-btn-ghost ts-btn-icon" disabled={!p.canRedo} onClick={p.onRedo} title="Redo (Ctrl+Y)" aria-label="Redo">
          <Redo2 size={15} />
        </button>

        <span className="ts-topbar-divider" aria-hidden="true" />

        <button type="button" className="ts-btn ts-btn-ghost ts-btn-icon" disabled={!hasSegments || p.isSaving} onClick={p.onSave} title="Save to cloud (Ctrl+S)" aria-label="Save">
          {p.isSaving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
        </button>
        <ExportMenu
          formats={p.exportFormats} onToggle={p.onToggleFormat} onDownload={p.onDownload}
          onDubbing={p.onDubbing} isExporting={p.isExporting} hasSegments={hasSegments} onCancelExport={p.onCancelExport}
          lang={p.exportLang} langOptions={p.exportLangOptions} onLang={p.onExportLang}
        />
        <button type="button" className="ts-btn ts-btn-ghost ts-btn-icon" title="Layout" aria-label="Layout" onClick={p.onOpenLayout}>
          <LayoutPanelLeft size={15} />
        </button>

        <MoreActionsMenu p={p} hasSegments={hasSegments} importRef={importRef} />

        {p.user && <NotificationBellDropdown />}
        {p.user && <AccountMenuDropdown user={p.user} onOpenLogoutModal={p.onOpenLogoutModal} />}
      </div>
    </header>
  );
}
