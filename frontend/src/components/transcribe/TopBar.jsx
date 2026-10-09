import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, Sparkles, Upload, Undo2, Redo2, Download, Save, Loader2,
  FolderOpen, BarChart2, GitCompare, StickyNote, BookOpen, FileUp, Clapperboard, Languages, Palette, ShieldCheck,
  Users, LayoutPanelLeft, RotateCcw, AudioLines, MoreHorizontal
} from 'lucide-react';
import BrandLogo from '../BrandLogo';
import StudioMenuBar from '../subtitle/StudioMenuBar';
import NotificationBellDropdown from '../NotificationBellDropdown';
import AccountMenuDropdown from '../AccountMenuDropdown';
import { openAppearance } from '../../theme/themeEngine';

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
  const pickMedia = () => document.getElementById('ts-media-input')?.click();

  const menus = [
    { id: 'file', label: 'File', items: [
      { label: 'Import subtitle file…', icon: FileUp, onSelect: () => importRef.current?.click() },
      { label: 'Saved projects…', icon: FolderOpen, onSelect: p.onOpenProjects },
      { type: 'separator' },
      { label: 'Open media…', icon: Upload, onSelect: pickMedia, disabled: p.isExtractingAudio },
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
        <button type="button" className="ts-btn ts-btn-primary shrink-0" disabled={!p.canTranscribe || p.isTranscribing || p.isExtractingAudio} onClick={p.onTranscribe} title={p.canTranscribe ? 'Transcribe this media' : 'Import media first'}>
          {p.isTranscribing ? <><Loader2 size={14} className="animate-spin" /> {Math.round(p.progressPercent)}%</> : <><Sparkles size={14} /> Transcribe</>}
        </button>
      </div>

      {/* Right group: icon buttons for key actions + overflow */}
      <div className="ts-topbar-right">
        <button type="button" className={`ts-btn ts-btn-ghost ts-btn-icon ${p.speakersOpen ? 'ts-topbar-active' : ''}`} disabled={!hasSegments} onClick={p.onOpenSpeakers} aria-pressed={p.speakersOpen} title="Speakers">
          <Users size={16} />
        </button>
        <span className="ts-topbar-divider" aria-hidden="true" />

        <button type="button" className="ts-btn ts-btn-ghost ts-btn-icon" disabled={!p.canUndo} onClick={p.onUndo} title="Undo (Ctrl+Z)" aria-label="Undo">
          <Undo2 size={15} />
        </button>
        <button type="button" className="ts-btn ts-btn-ghost ts-btn-icon" disabled={!p.canRedo} onClick={p.onRedo} title="Redo (Ctrl+Y)" aria-label="Redo">
          <Redo2 size={15} />
        </button>

        <button type="button" className="ts-btn ts-btn-ghost ts-btn-icon" title="Layout" aria-label="Layout" onClick={p.onOpenLayout}>
          <LayoutPanelLeft size={15} />
        </button>

        <MoreActionsMenu p={p} hasSegments={hasSegments} importRef={importRef} />

        {p.user && <NotificationBellDropdown />}
        {p.user && <AccountMenuDropdown user={p.user} onOpenLogoutModal={p.onOpenLogoutModal} compact />}
      </div>
    </header>
  );
}
