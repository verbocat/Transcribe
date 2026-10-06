import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import {
  Settings, X, LayoutDashboard, Palette, SlidersHorizontal, Gauge, Languages, Sparkles, BookText,
  Server, Keyboard, Database, PanelRight, Maximize2, ArrowLeftRight,
} from 'lucide-react';
import { resetTheme } from '../../theme/themeEngine';
import LayoutSettings from './layout/LayoutSettings';
import { Button, IconButton } from './ui/controls';
import {
  QcPage, LanguagePage, AiPage, GlossaryPage, EditorPage, ConnectionPage, ShortcutsPage, DataPage,
} from './settings/SettingsPages';

// Loaded on first visit so Settings opens fast
const ThemeDashboard = lazy(() => import('../../theme/ThemeDashboard'));

/** Pages grouped for the navigation. `live` pages are previewed on the studio behind the dialog. */
export const SETTINGS_GROUPS = [
  {
    title: 'Workspace',
    pages: [
      { id: 'layout', label: 'Layout', icon: LayoutDashboard, live: true, desc: 'Arrange panes, presets, sizes and the header.' },
      { id: 'appearance', label: 'Appearance', icon: Palette, live: true, desc: 'Theme, colours, fonts and accessibility.' },
      { id: 'editor', label: 'Editor', icon: SlidersHorizontal, desc: 'Editing, playback, timecode and autosave.' },
    ],
  },
  {
    title: 'Subtitles',
    pages: [
      { id: 'qc', label: 'Timing & QC', icon: Gauge, desc: 'Reading speed, line length, durations and frame rate.' },
      { id: 'language', label: 'Language & script', icon: Languages, desc: 'Spoken language, script and dialogue style.' },
      { id: 'ai', label: 'Speech & AI', icon: Sparkles, desc: 'Transcription engine, speakers and Gemini correction.' },
      { id: 'glossary', label: 'Glossary', icon: BookText, desc: 'Names and terms to spell exactly.' },
    ],
  },
  {
    title: 'System',
    pages: [
      { id: 'connection', label: 'Connection', icon: Server, desc: 'Backend server address.' },
      { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard, desc: 'Every keyboard shortcut.' },
      { id: 'data', label: 'Data & reset', icon: Database, desc: 'Back up, drafts and resets.' },
    ],
  },
];
const ALL_PAGES = SETTINGS_GROUPS.flatMap((g) => g.pages);

/**
 * Settings dialog. Layout and Appearance are "live" pages: the dialog slides to a side
 * drawer so you can watch the workspace change as you adjust it; expand it for more room.
 */
export default function SubtitleSettingsModal({
  isOpen,
  onClose,
  page = 'layout',
  onPageChange = () => {},
  studioLayout,
  ...ctx
}) {
  const [expanded, setExpanded] = useState(false);
  const [drawerSide, setDrawerSide] = useState('right');
  const dialogRef = useRef(null);

  useEffect(() => { if (isOpen) dialogRef.current?.focus(); }, [isOpen]);
  if (!isOpen) return null;

  const current = ALL_PAGES.find((p) => p.id === page) || ALL_PAGES[0];
  const drawer = current.live && !expanded;

  const c = { ...ctx, studioLayout, resetAppearance: resetTheme };

  const renderPage = () => {
    switch (current.id) {
      case 'layout': return <LayoutSettings studio={studioLayout} />;
      case 'appearance': return (
        <Suspense fallback={<p className="text-[12px] text-[var(--ss-faint)]">Loading…</p>}>
          <ThemeDashboard embedded onClose={onClose} />
        </Suspense>
      );
      case 'editor': return <EditorPage c={c} />;
      case 'qc': return <QcPage c={c} />;
      case 'language': return <LanguagePage c={c} />;
      case 'ai': return <AiPage c={c} />;
      case 'glossary': return <GlossaryPage c={c} />;
      case 'connection': return <ConnectionPage />;
      case 'shortcuts': return <ShortcutsPage />;
      case 'data': return <DataPage c={c} />;
      default: return null;
    }
  };

  const nav = drawer ? (
    <nav aria-label="Settings pages" className="flex gap-1 px-3 py-2 overflow-x-auto border-b border-[var(--ss-line)] shrink-0">
      {ALL_PAGES.map((p) => {
        const Icon = p.icon;
        const on = p.id === current.id;
        return (
          <button
            key={p.id}
            type="button"
            title={p.label}
            aria-label={p.label}
            aria-current={on ? 'page' : undefined}
            onClick={() => onPageChange(p.id)}
            className={`shrink-0 h-8 px-2.5 rounded-lg inline-flex items-center gap-1.5 text-[12px] font-medium cursor-pointer transition-colors ${on ? 'bg-[var(--ss-accent)] text-[var(--ss-accent-ink)]' : 'text-[var(--ss-muted)] hover:text-[var(--ss-text)] hover:bg-[var(--ss-raised)]'}`}
          >
            <Icon size={14} />
            {on && p.label}
          </button>
        );
      })}
    </nav>
  ) : (
    <nav aria-label="Settings pages" className="w-[220px] shrink-0 border-r border-[var(--ss-line)] overflow-y-auto py-3 px-2.5 bg-[var(--ss-bg)]/40">
      {SETTINGS_GROUPS.map((g) => (
        <div key={g.title} className="mb-4">
          <div className="px-2.5 mb-1 text-[11px] font-semibold text-[var(--ss-faint)]">{g.title}</div>
          {g.pages.map((p) => {
            const Icon = p.icon;
            const on = p.id === current.id;
            return (
              <button
                key={p.id}
                type="button"
                aria-current={on ? 'page' : undefined}
                onClick={() => onPageChange(p.id)}
                className={`w-full h-9 px-2.5 rounded-lg flex items-center gap-2.5 text-[13px] text-left cursor-pointer transition-colors ${on ? 'bg-[var(--ss-selected)] text-[var(--ss-text)] shadow-[inset_2px_0_0_var(--ss-accent)]' : 'text-[var(--ss-muted)] hover:text-[var(--ss-text)] hover:bg-[var(--ss-raised)]'}`}
              >
                <Icon size={15} className={on ? 'text-[var(--ss-accent)]' : ''} />
                {p.label}
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );

  const body = (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal={!drawer}
      aria-label="Settings"
      tabIndex={-1}
      style={{ outline: 'none' }}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}
      className={`pointer-events-auto flex flex-col bg-[var(--ss-panel)] text-[var(--ss-text)] border-[var(--ss-line)] shadow-2xl outline-none ${
        drawer
          ? `fixed top-0 bottom-0 w-[460px] max-w-[94vw] ${drawerSide === 'right' ? 'right-0 border-l' : 'left-0 border-r'}`
          : 'relative w-[min(980px,96vw)] h-[min(720px,92vh)] rounded-2xl border overflow-hidden'
      }`}
    >
      <header className="shrink-0 flex items-center gap-3 px-5 h-14 border-b border-[var(--ss-line)]">
        <Settings size={16} className="text-[var(--ss-accent)] shrink-0" />
        <div className="flex-1 min-w-0">
          <h2 className="text-[14px] font-semibold leading-tight truncate">{drawer ? current.label : 'Settings'}</h2>
          <p className="text-[11.5px] text-[var(--ss-faint)] truncate">{drawer ? 'Changes apply instantly' : current.desc}</p>
        </div>
        {current.live && (
          <IconButton
            icon={drawer ? Maximize2 : PanelRight}
            label={drawer ? 'Expand to a full dialog' : 'Dock beside the workspace to preview changes'}
            onClick={() => setExpanded((v) => !v)}
          />
        )}
        {drawer && <IconButton icon={ArrowLeftRight} label={`Move to the ${drawerSide === 'right' ? 'left' : 'right'}`} onClick={() => setDrawerSide(drawerSide === 'right' ? 'left' : 'right')} />}
        <IconButton icon={X} label="Close settings (Esc)" onClick={onClose} />
      </header>

      {drawer && nav}
      <div className="flex-1 min-h-0 flex">
        {!drawer && nav}
        <main className="flex-1 min-w-0 overflow-y-auto px-6 py-5" data-lenis-prevent>
          {!drawer && <h3 className="sr-only">{current.label}</h3>}
          {renderPage()}
        </main>
      </div>

      <footer className="shrink-0 flex items-center justify-between gap-3 px-5 h-12 border-t border-[var(--ss-line)]">
        <span className="text-[11.5px] text-[var(--ss-faint)]">Settings save automatically on this device.</span>
        <Button variant="primary" onClick={onClose}>Done</Button>
      </footer>
    </div>
  );

  if (drawer) return <div className="fixed inset-0 z-[60] pointer-events-none">{body}</div>;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {body}
    </div>
  );
}
