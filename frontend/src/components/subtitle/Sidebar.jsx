import React from 'react';
import {
  FolderOpen,
  FileText,
  Sparkles,
  Languages,
  BadgeCheck,
  ShieldCheck,
  Download,
  HelpCircle,
  Loader2,
  LayoutDashboard,
} from 'lucide-react';

/**
 * Left tool rail, grouped by job: media in, AI steps, review and out.
 * Every item performs an action; panels (Translate, QC, Export) stay highlighted while open.
 * "Centroid QC" only appears once a translation exists.
 */
export default function Sidebar({
  activeTab = null,
  isGenerating = false,
  canGenerate = true,
  hasTranslation = false,
  translateOpen = false,
  centroidQcCount = null,
  onTabChange = () => {},
  onOpenHelp = () => {},
  onOpenLayout = () => {},
  layoutOpen = false,
  position = 'left',
  showLabels = true,
}) {
  const horizontal = position === 'top' || position === 'bottom';
  const first = position === 'left' || position === 'top';

  const groups = [
    [
      { id: 'media', label: 'Open', icon: FolderOpen, title: 'Open a video or audio file' },
      { id: 'import', label: 'Import', icon: FileText, title: 'Import subtitles from an SRT / VTT file' },
    ],
    [
      {
        id: 'generate',
        label: isGenerating ? 'Working' : 'Generate',
        icon: isGenerating ? Loader2 : Sparkles,
        title: !canGenerate ? 'Open a video or audio file first' : isGenerating ? 'Generating subtitles…' : 'Generate subtitles with ElevenLabs Scribe',
        disabled: !canGenerate || isGenerating,
        spin: isGenerating,
      },
      {
        id: 'translate',
        label: 'Translate',
        icon: Languages,
        title: 'Translate the subtitles into another language with Centroid',
        active: translateOpen,
      },
      ...(hasTranslation
        ? [{
          id: 'centroid-qc',
          label: 'Centroid QC',
          icon: BadgeCheck,
          title: 'Check the translation with Centroid QC',
          badge: centroidQcCount,
          highlight: true,
        }]
        : []),
    ],
    [
      { id: 'qa', label: 'QC', icon: ShieldCheck, title: 'Open the Netflix compliance (QC) panel' },
      { id: 'export', label: 'Export', icon: Download, title: 'Export subtitles (SRT, VTT, TTML…)' },
    ],
  ];

  const edge = { left: 'border-r', right: 'border-l', top: 'border-b', bottom: 'border-t' }[position] || 'border-r';
  const small = (active) =>
    `w-9 h-9 rounded-lg flex items-center justify-center transition-colors cursor-pointer ${
      active ? 'bg-[var(--ss-raised)] text-[var(--ss-accent)]' : 'text-[var(--ss-muted)] hover:text-[var(--ss-text)] hover:bg-[var(--ss-raised)]'
    }`;

  return (
    <aside
      aria-label="Tools"
      style={{ order: first ? 0 : 3 }}
      className={`shrink-0 bg-[var(--ss-bg)] ${edge} border-[var(--ss-line)] flex justify-between select-none z-30 ${
        horizontal ? 'flex-row items-center w-full px-3 py-1' : `flex-col items-center h-full py-2.5 ${showLabels ? 'w-[60px]' : 'w-[48px]'}`
      }`}
    >
      <div className={`flex ${horizontal ? 'flex-row items-center gap-1' : 'flex-col items-center gap-1 w-full px-1.5'}`}>
        {groups.map((group, gi) => (
          <React.Fragment key={gi}>
            {gi > 0 && <span aria-hidden="true" className={horizontal ? 'w-px h-5 mx-1.5 bg-[var(--ss-line)]' : 'h-px w-7 my-1.5 bg-[var(--ss-line)]'} />}
            {group.map((item) => {
              const Icon = item.icon;
              const isActive = item.active ?? activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onTabChange(item.id)}
                  disabled={item.disabled}
                  title={item.title}
                  aria-label={item.label}
                  aria-pressed={isActive}
                  className={`relative group rounded-lg flex items-center justify-center transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                    horizontal ? 'flex-row gap-2 h-8 px-2.5' : `w-full flex-col ${showLabels ? 'h-[46px] gap-0.5' : 'h-9'}`
                  } ${
                    isActive
                      ? 'bg-[var(--ss-accent)] text-[var(--ss-accent-ink)]'
                      : item.highlight
                        ? 'text-[var(--ss-accent)] bg-[var(--ss-accent)]/10 hover:bg-[var(--ss-accent)]/20'
                        : 'text-[var(--ss-muted)] hover:text-[var(--ss-text)] hover:bg-[var(--ss-raised)]'
                  }`}
                >
                  <Icon size={18} strokeWidth={1.75} className={item.spin ? 'animate-spin' : ''} />
                  {(showLabels || horizontal) && (
                    <span className={`leading-none font-medium ${horizontal ? 'text-[12px]' : 'text-[10px]'}`}>{item.label}</span>
                  )}
                  {item.badge != null && (
                    <span className="absolute top-1 right-1 min-w-[15px] h-[15px] px-1 rounded-full bg-[var(--ss-warn)] text-[9px] font-bold leading-[15px] text-black text-center">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </React.Fragment>
        ))}
      </div>

      <div className={`flex items-center gap-1 ${horizontal ? 'flex-row' : 'flex-col'}`}>
        <button type="button" onClick={onOpenLayout} className={small(layoutOpen)} title="Layout & panels (Ctrl+Shift+L)" aria-label="Layout and panels" aria-pressed={layoutOpen}>
          <LayoutDashboard size={17} strokeWidth={1.75} />
        </button>
        <button type="button" onClick={onOpenHelp} className={small(false)} title="Keyboard shortcuts" aria-label="Keyboard shortcuts">
          <HelpCircle size={17} strokeWidth={1.75} />
        </button>
      </div>
    </aside>
  );
}
