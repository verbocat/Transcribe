import React from 'react';
import {
  Sparkles,
  Languages,
  ShieldCheck,
  Loader2,
  BookText,
  Download,
  Settings,
} from 'lucide-react';

/**
 * Left tool rail: a slim, quiet strip for the working tools. Each tool is a compact icon tile with
 * its name underneath. Generate is the one solid accent tile; Context, AI Translate and QC are
 * flat and take a soft accent tint while their panel is open. Hover/focus shows a tooltip with a one-line hint.
 * Export, Settings and the account menu sit at the foot of the rail (the end of the row when docked top or bottom).
 * "QC" opens one view with Guideline and Translation tabs; the badge counts translation issues.
 * When docked top or bottom it becomes a compact row with labels.
 */
export default function Sidebar({
  activeTab = null,
  isGenerating = false,
  canGenerate = true,
  translateOpen = false,
  contextOpen = false,
  contextActive = false,
  centroidQcCount = null,
  onTabChange = () => {},
  qcOpen = false,
  position = 'left',
  showLabels = true,
  onExport = null,
  exportDisabled = false,
  onSettings = null,
  settingsOpen = false,
  account = null,
}) {
  const horizontal = position === 'top' || position === 'bottom';
  // vertical rails always name each tool under its icon; the toggle only applies to the horizontal row
  const labelled = horizontal ? showLabels : true;
  const first = position === 'left' || position === 'top';

  const groups = [
    [
      {
        id: 'generate',
        label: isGenerating ? 'Working' : 'Generate',
        primary: true,
        icon: isGenerating ? Loader2 : Sparkles,
        title: !canGenerate ? 'Open a video or audio file first' : isGenerating ? 'Generating subtitles…' : 'Generate subtitles',
        disabled: !canGenerate || isGenerating,
        spin: isGenerating,
      },
      {
        id: 'context',
        label: 'Context',
        icon: BookText,
        title: 'Context: speakers, names and terms for a more accurate transcript',
        active: contextOpen,
        dot: contextActive,
      },
      {
        id: 'translate',
        label: 'AI Translate',
        icon: Languages,
        title: 'AI translation into another language',
        active: translateOpen,
      },
    ],
    [
      {
        id: 'qc',
        label: 'QC',
        icon: ShieldCheck,
        title: 'Quality check: Guideline QC and translation QC',
        active: qcOpen,
        badge: centroidQcCount,
      },
    ],
  ];

  const footer = [
    onExport && { id: 'export', label: 'Export', primary: true, icon: Download, title: exportDisabled ? 'Export subtitles (generate or import subtitles first)' : 'Export subtitles (Ctrl+E)', disabled: exportDisabled, onClick: onExport },
    onSettings && { id: 'settings', label: 'Settings', icon: Settings, title: 'Settings (Ctrl+,)', active: settingsOpen, onClick: onSettings },
  ].filter(Boolean);

  const edge = { left: 'border-r', right: 'border-l', top: 'border-b', bottom: 'border-t' }[position] || 'border-r';
  // tooltip side: away from the rail, towards the workspace
  const tipPos = { left: 'left-full ml-2 top-1/2 -translate-y-1/2', right: 'right-full mr-2 top-1/2 -translate-y-1/2', top: 'top-full mt-2 left-1/2 -translate-x-1/2', bottom: 'bottom-full mb-2 left-1/2 -translate-x-1/2' }[position] || '';

  const Tip = ({ children }) => (
    <span
      role="tooltip"
      className={`rail-tip pointer-events-none absolute z-50 ${tipPos} w-max max-w-[210px] text-left rounded-lg border border-[var(--ss-line)] bg-[var(--ss-panel)] px-2.5 py-1.5 text-[11.5px] font-medium leading-snug text-[var(--ss-text)] shadow-xl opacity-0 scale-95 transition duration-150 group-hover:opacity-100 group-hover:scale-100 group-hover:delay-300 group-focus-visible:opacity-100 group-focus-visible:scale-100`}
    >
      {children}
    </span>
  );

  const btn = (item, small = false) => {
    const Icon = item.icon;
    const on = item.active ?? activeTab === item.id;
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => item.onClick ? item.onClick() : onTabChange(item.id)}
        disabled={item.disabled}
        aria-label={item.label}
        aria-pressed={item.active !== undefined ? on : undefined}
        data-power={item.id}
        data-on={on ? 'true' : 'false'}
        data-primary={item.primary ? 'true' : 'false'}
        data-busy={item.spin ? 'true' : 'false'}
        className={`rail-btn group relative shrink-0 inline-flex items-center justify-center cursor-pointer disabled:cursor-not-allowed ${
          horizontal ? (showLabels && !small ? 'rail-btn-h h-8 px-3 gap-1.5 rounded-lg' : 'rail-btn-h w-8 h-8 rounded-lg') : 'rail-btn-v flex-col'
        }`}
      >
        {horizontal ? (
          <>
            <Icon size={16} strokeWidth={1.75} className={item.spin ? 'animate-spin' : ''} />
            {showLabels && !small && <span className="text-[12px] font-medium leading-none">{item.label}</span>}
            {item.badge != null && (
              <span className="rail-badge absolute top-1 right-1.5 min-w-[15px] h-[15px] px-1 rounded-full bg-[var(--ss-warn)] text-[9px] font-bold leading-[15px] text-black text-center">{item.badge}</span>
            )}
            {item.dot && !item.badge && <span aria-hidden="true" className="absolute top-2 right-3 w-1.5 h-1.5 rounded-full bg-[var(--ss-accent)] ring-2 ring-[var(--ss-bg)]" />}
          </>
        ) : (
          <>
            <span className="rail-tile">
              <Icon size={18} strokeWidth={1.75} className={item.spin ? 'animate-spin' : ''} />
              {item.badge != null && <span className="rail-tile-badge">{item.badge}</span>}
              {item.dot && item.badge == null && <span aria-hidden="true" className="rail-tile-dot" />}
            </span>
            {labelled && <span className="rail-label">{item.label}</span>}
          </>
        )}
        {!(horizontal && showLabels && !small) && <Tip>{item.title || item.label}</Tip>}
      </button>
    );
  };

  return (
    <aside
      aria-label="Tools"
      style={{ order: first ? 0 : 3 }}
      className={`shrink-0 bg-[var(--ss-bg)] ${edge} border-[var(--ss-line)] flex justify-between select-none z-[45] ${
        horizontal ? 'flex-row items-center w-full px-2 h-10' : 'flex-col items-center justify-between h-full w-[68px] py-3 rail-aside'
      }`}
    >
      <div className={`flex ${horizontal ? 'flex-row items-center gap-1.5' : 'flex-col items-center gap-3 my-auto'}`}>
        {groups.map((group, gi) => (
          <React.Fragment key={gi}>
            {gi > 0 && <span aria-hidden="true" className={horizontal ? 'w-px h-4 mx-1.5 bg-[var(--ss-line)]' : 'rail-sep'} />}
            {group.map((item) => btn(item))}
          </React.Fragment>
        ))}
      </div>
      <div className={`rail-foot flex ${horizontal ? 'flex-row items-center gap-1.5' : 'flex-col items-center gap-2'}`}>
        {footer.map((item) => btn(item))}
        {account}
      </div>
    </aside>
  );
}
