import React, { useMemo, useRef } from 'react';
import { Minimize2 } from 'lucide-react';
import { buildGrid, DEFAULT_LAYOUT, LIMITS } from './layoutModel';

function Splitter({ area, def, layout, patch, thickness }) {
  const drag = useRef(null);
  const { key, axis, sign } = def;
  const horizontal = axis === 'x'; // a vertical bar that moves along x
  const [lo, hi] = LIMITS[key];

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { start: horizontal ? e.clientX : e.clientY, value: layout[key] };
    document.body.style.cursor = horizontal ? 'col-resize' : 'row-resize';
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const delta = (horizontal ? e.clientX : e.clientY) - d.start;
    patch({ [key]: Math.min(hi, Math.max(lo, d.value + sign * delta)) });
  };
  const end = () => {
    drag.current = null;
    document.body.style.cursor = '';
  };
  const onKeyDown = (e) => {
    const dec = horizontal ? 'ArrowLeft' : 'ArrowUp';
    const inc = horizontal ? 'ArrowRight' : 'ArrowDown';
    if (e.key !== dec && e.key !== inc) return;
    e.preventDefault();
    e.stopPropagation();
    const step = e.shiftKey ? 48 : 16;
    patch({ [key]: Math.min(hi, Math.max(lo, layout[key] + sign * (e.key === inc ? step : -step))) });
  };

  return (
    <div
      role="separator"
      aria-orientation={horizontal ? 'vertical' : 'horizontal'}
      aria-label={key === 'timelineH' ? 'Resize timeline' : 'Resize video'}
      tabIndex={0}
      style={{ gridArea: area, touchAction: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={() => patch({ [key]: DEFAULT_LAYOUT[key] })}
      onKeyDown={onKeyDown}
      title="Drag to resize · double-click to reset · arrow keys nudge"
      className={`group relative z-10 flex items-center justify-center outline-none ${horizontal ? 'cursor-col-resize' : 'cursor-row-resize'}`}
    >
      {/* generous invisible hit area even when the bar itself is thin */}
      <span className={`absolute ${horizontal ? '-inset-x-1.5 inset-y-0' : '-inset-y-1.5 inset-x-0'}`} />
      <span
        className={`rounded-full bg-[var(--ss-line)] transition-colors group-hover:bg-[var(--ss-accent)] group-focus-visible:bg-[var(--ss-accent)] ${horizontal ? 'h-10 max-h-full' : 'w-10 max-w-full'}`}
        style={horizontal ? { width: Math.max(2, Math.min(thickness, 4)) } : { height: Math.max(2, Math.min(thickness, 4)) }}
      />
    </div>
  );
}

/**
 * Lays the three working panes out on a CSS grid. The panes are always rendered in
 * the same order, so moving them (or hiding one) never remounts the video player.
 */
export default function StudioStage({ layout, patch, video, list, timeline }) {
  const g = useMemo(() => buildGrid(layout), [layout]);
  const cards = layout.paneStyle === 'cards';
  const thickness = Math.max(layout.splitter, layout.gap);

  const pane = (area, shown, children, label) => (
    <div
      key={area}
      role="region"
      aria-label={label}
      style={{
        gridArea: area,
        display: shown ? undefined : 'none',
        borderRadius: layout.radius,
      }}
      className={`min-w-0 min-h-0 overflow-hidden relative ${cards ? 'border border-[var(--ss-line)] shadow-lg shadow-black/20' : ''}`}
    >
      {children}
    </div>
  );

  return (
    <div
      className="flex-1 min-h-0 min-w-0 relative"
      style={{ display: 'grid', gridTemplateColumns: g.cols.join(' '), gridTemplateRows: g.rows.join(' '), gridTemplateAreas: g.areas.map((r) => `"${r.join(' ')}"`).join(' '), padding: cards ? layout.gap : 0 }}
    >
      {pane('v', g.vis.video, video, 'Video monitor')}
      {pane('l', g.vis.list, list, 'Subtitle list')}
      {pane('t', g.vis.timeline, timeline, 'Timeline')}
      {g.sv && <Splitter area="sv" def={g.sv} layout={layout} patch={patch} thickness={thickness} />}
      {g.st && <Splitter area="st" def={g.st} layout={layout} patch={patch} thickness={thickness} />}

      {layout.maximize !== 'none' && (
        <button
          type="button"
          onClick={() => patch({ maximize: 'none' })}
          className="absolute top-2 right-2 z-20 inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg border border-[var(--ss-line)] bg-[var(--ss-raised)]/95 text-[11px] font-medium text-[var(--ss-text)] hover:bg-[var(--ss-hover)] cursor-pointer shadow-lg"
          title="Leave focus mode and show every pane again"
        >
          <Minimize2 size={12} /> Exit focus
        </button>
      )}
    </div>
  );
}
