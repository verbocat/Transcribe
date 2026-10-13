import React from 'react';
import {
  Sparkles,
  Languages,
  ShieldCheck,
  Loader2,
  BookText,
} from 'lucide-react';

/**
 * Left tool rail: a slim, quiet strip for the working tools. Generate is the one filled, primary
 * action; Context, Translate and QC are calm icon + label tiles that light up (soft accent tile and
 * an edge indicator) while their panel is open. Hover/focus shows a tooltip with a one-line hint.
 * File actions (open, import, export), layout and shortcuts live in the top menu bar only.
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

  const edge = { left: 'border-r', right: 'border-l', top: 'border-b', bottom: 'border-t' }[position] || 'border-r';
  // tooltip side: away from the rail, towards the workspace
  const tipPos = { left: 'left-full ml-2 top-1/2 -translate-y-1/2', right: 'right-full mr-2 top-1/2 -translate-y-1/2', top: 'top-full mt-2 left-1/2 -translate-x-1/2', bottom: 'bottom-full mb-2 left-1/2 -translate-x-1/2' }[position] || '';

  const Tip = ({ children }) => (
    <span
      role="tooltip"
      className={`rail-tip pointer-events-none absolute z-50 ${tipPos} w-max max-w-[210px] text-left rounded-lg border border-[var(--ss-line)] bg-[var(--ss-panel)] px-2.5 py-1.5 text-[11.5px] font-medium leading-snug text-[var(--ss-text)] shadow-xl opacity-0 scale-95 transition duration-150 group-hover:opacity-100 group-hover:scale-100 group-focus-visible:opacity-100 group-focus-visible:scale-100`}
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
          horizontal ? (showLabels && !small ? 'h-8 px-3 gap-1.5 rounded-lg' : 'w-8 h-8 rounded-lg') : 'rail-btn-v flex-col gap-1'
        }`}
      >
        {on && !horizontal && <span aria-hidden="true" className={`rail-bar absolute top-3 bottom-3 w-[3px] rounded-full ${position === 'right' ? '-right-[9px]' : '-left-[9px]'}`} />}
        <Icon size={horizontal ? 16 : 19} strokeWidth={1.75} className={item.spin ? 'animate-spin' : ''} />
        {horizontal && showLabels && !small && <span className="text-[12px] font-medium leading-none">{item.label}</span>}
        {!horizontal && labelled && <span className="rail-label whitespace-nowrap text-[10px] font-semibold leading-none">{item.label}</span>}
        {item.badge != null && (
          <span className="rail-badge absolute top-1 right-1.5 min-w-[15px] h-[15px] px-1 rounded-full bg-[var(--ss-warn)] text-[9px] font-bold leading-[15px] text-black text-center">{item.badge}</span>
        )}
        {item.dot && !item.badge && <span aria-hidden="true" className="absolute top-2 right-3 w-1.5 h-1.5 rounded-full bg-[var(--ss-accent)] ring-2 ring-[var(--ss-bg)]" />}
        {!(horizontal && showLabels && !small) && <Tip>{item.title || item.label}</Tip>}
      </button>
    );
  };

  return (
    <aside
      aria-label="Tools"
      style={{ order: first ? 0 : 3 }}
      className={`shrink-0 bg-[var(--ss-bg)] ${edge} border-[var(--ss-line)] flex justify-between select-none z-30 ${
        horizontal ? 'flex-row items-center w-full px-2 h-10' : 'flex-col items-center justify-center h-full w-[72px] py-2 rail-aside'
      }`}
    >
      <div className={`flex ${horizontal ? 'flex-row items-center gap-1.5' : 'flex-col items-center gap-1'}`}>
        {groups.map((group, gi) => (
          <React.Fragment key={gi}>
            {gi > 0 && <span aria-hidden="true" className={horizontal ? 'w-px h-4 mx-1.5 bg-[var(--ss-line)]' : 'rail-sep h-px w-7 my-2 bg-[var(--ss-line)]'} />}
            {group.map((item) => btn(item))}
          </React.Fragment>
        ))}
      </div>
    </aside>
  );
}
