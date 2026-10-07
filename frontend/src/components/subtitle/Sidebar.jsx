import React from 'react';
import {
  Sparkles,
  Languages,
  ShieldCheck,
  Loader2,
  BookText,
} from 'lucide-react';

/**
 * Left tool rail: a slim, icon-only strip (labels appear as tooltips) for the working tools:
 * AI steps | quality check. Panels (Context, Translate, QC) stay highlighted while open.
 * File actions (open, import, export), layout and shortcuts live in the top menu bar only.
 * "QC" opens one view with Guideline and Centroid tabs; the badge counts Centroid issues.
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
}) {
  const horizontal = position === 'top' || position === 'bottom';
  const first = position === 'left' || position === 'top';

  const groups = [
    [
      {
        id: 'generate',
        label: isGenerating ? 'Working' : 'Generate',
        icon: isGenerating ? Loader2 : Sparkles,
        title: !canGenerate ? 'Open a video or audio file first' : isGenerating ? 'Generating subtitles…' : 'Generate subtitles',
        disabled: !canGenerate || isGenerating,
        spin: isGenerating,
        accent: true,
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
        label: 'Translate',
        icon: Languages,
        title: 'Translate the subtitles into another language with Centroid',
        active: translateOpen,
      },
    ],
    [
      {
        id: 'qc',
        label: 'QC',
        icon: ShieldCheck,
        title: 'Quality check: Guideline QC and Centroid translation QC',
        active: qcOpen,
        badge: centroidQcCount,
      },
    ],
  ];

  const edge = { left: 'border-r', right: 'border-l', top: 'border-b', bottom: 'border-t' }[position] || 'border-r';
  // tooltip side: away from the rail, towards the workspace
  const tipPos = { left: 'left-full ml-2 top-1/2 -translate-y-1/2', right: 'right-full mr-2 top-1/2 -translate-y-1/2', top: 'top-full mt-2 left-1/2 -translate-x-1/2', bottom: 'bottom-full mb-2 left-1/2 -translate-x-1/2' }[position] || '';

  const Tip = ({ children }) => (
    <span
      role="tooltip"
      className={`pointer-events-none absolute z-50 ${tipPos} whitespace-nowrap rounded-md border border-[var(--ss-line)] bg-[var(--ss-panel)] px-2 py-1 text-[11.5px] font-medium text-[var(--ss-text)] shadow-lg opacity-0 scale-95 transition duration-100 group-hover:opacity-100 group-hover:scale-100 group-focus-visible:opacity-100 group-focus-visible:scale-100`}
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
        className={`group relative shrink-0 rounded-lg inline-flex items-center justify-center transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed outline-none focus-visible:ring-1 focus-visible:ring-[var(--ss-accent)] ${
          horizontal && showLabels && !small ? 'h-7 px-2 gap-1.5' : 'w-8 h-8'
        } ${
          on
            ? 'bg-[var(--ss-accent)]/15 text-[var(--ss-accent)]'
            : item.accent
              ? 'text-[var(--ss-accent)] hover:bg-[var(--ss-accent)]/10'
              : 'text-[var(--ss-muted)] hover:text-[var(--ss-text)] hover:bg-[var(--ss-raised)]'
        }`}
      >
        {on && !horizontal && <span aria-hidden="true" className={`absolute top-1.5 bottom-1.5 w-[2px] rounded-full bg-[var(--ss-accent)] ${position === 'right' ? '-right-[5px]' : '-left-[5px]'}`} />}
        <Icon size={16} strokeWidth={1.8} className={item.spin ? 'animate-spin' : ''} />
        {horizontal && showLabels && !small && <span className="text-[12px] font-medium leading-none">{item.label}</span>}
        {item.badge != null && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-1 rounded-full bg-[var(--ss-warn)] text-[9px] font-bold leading-[14px] text-black text-center">{item.badge}</span>
        )}
        {item.dot && !item.badge && <span aria-hidden="true" className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-[var(--ss-accent)]" />}
        {!(horizontal && showLabels && !small) && <Tip>{item.title || item.label}</Tip>}
      </button>
    );
  };

  return (
    <aside
      aria-label="Tools"
      style={{ order: first ? 0 : 3 }}
      className={`shrink-0 bg-[var(--ss-bg)] ${edge} border-[var(--ss-line)] flex justify-between select-none z-30 ${
        horizontal ? 'flex-row items-center w-full px-2 h-10' : 'flex-col items-center h-full w-11 py-2'
      }`}
    >
      <div className={`flex ${horizontal ? 'flex-row items-center gap-1' : 'flex-col items-center gap-1'}`}>
        {groups.map((group, gi) => (
          <React.Fragment key={gi}>
            {gi > 0 && <span aria-hidden="true" className={horizontal ? 'w-px h-4 mx-1 bg-[var(--ss-line)]' : 'h-px w-5 my-1 bg-[var(--ss-line)]'} />}
            {group.map((item) => btn(item))}
          </React.Fragment>
        ))}
      </div>
    </aside>
  );
}
