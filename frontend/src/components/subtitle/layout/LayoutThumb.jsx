import React, { useMemo } from 'react';
import { buildGrid } from './layoutModel';

const REF_W = 1280; // the window the thumbnail pretends to be
const REF_H = 720;

/** Miniature wireframe of a layout, drawn from the same grid the studio uses. */
export default function LayoutThumb({ layout, width = 120 }) {
  const f = width / REF_W;
  const height = Math.round(REF_H * f);

  const g = useMemo(() => buildGrid(layout), [layout]);
  const scale = (t) => {
    const m = /^(?:minmax\(0, )?(\d+(?:\.\d+)?)px\)?$/.exec(t);
    if (m) return `${Math.max(1, Math.round(Number(m[1]) * f * 10) / 10)}px`;
    return t.startsWith('minmax(') ? 'minmax(0, 1fr)' : t;
  };

  const sbVertical = layout.sidebar === 'left' || layout.sidebar === 'right';
  const sbFirst = layout.sidebar === 'left' || layout.sidebar === 'top';
  const qc = layout.qcDock !== 'overlay';
  const qcFirst = layout.qcDock === 'left';
  const qcVertical = layout.qcDock === 'left' || layout.qcDock === 'right';
  const cards = layout.paneStyle === 'cards';
  const r = Math.min(4, layout.radius * f * 1.6);

  const sidebar = layout.sidebar !== 'hidden' && (
    <div
      className="bg-[var(--ss-line)]/70 shrink-0"
      style={sbVertical ? { width: Math.max(4, 68 * f), order: sbFirst ? 0 : 3 } : { height: Math.max(3, 52 * f), order: sbFirst ? 0 : 3 }}
    />
  );

  const paneBase = { borderRadius: r };
  const cell = (area, shown, content) => shown && (
    <div key={area} style={{ gridArea: area, ...paneBase }} className={`overflow-hidden ${cards ? 'ring-1 ring-[var(--ss-line)]' : ''}`}>{content}</div>
  );

  return (
    <div
      className="flex flex-col rounded-md overflow-hidden border border-[var(--ss-line)] bg-[var(--ss-bg)]"
      style={{ width, height }}
      aria-hidden="true"
    >
      {layout.showHeader && <div className="h-[3px] shrink-0 bg-[var(--ss-line)]" />}
      <div className="flex-1 min-h-0 flex" style={{ flexDirection: sbVertical ? 'row' : 'column' }}>
        {sidebar}
        <div className="flex-1 min-w-0 min-h-0 flex" style={{ flexDirection: qcVertical ? 'row' : 'column', order: 1 }}>
          <div
            className="flex-1 min-w-0 min-h-0"
            style={{
              display: 'grid',
              gridTemplateColumns: g.cols.map(scale).join(' '),
              gridTemplateRows: g.rows.map(scale).join(' '),
              gridTemplateAreas: g.areas.map((row) => `"${row.join(' ')}"`).join(' '),
              padding: cards ? Math.max(1, layout.gap * f * 1.5) : 0,
              order: 1,
            }}
          >
            {cell('v', g.vis.video, (
              <div className="w-full h-full bg-[var(--ss-accent)]/35 flex items-center justify-center">
                <div className="border-y-[3px] border-y-transparent border-l-[5px] border-l-[var(--ss-accent)]" />
              </div>
            ))}
            {cell('l', g.vis.list, (
              <div
                className="w-full h-full bg-[var(--ss-panel)]"
                style={{ backgroundImage: 'repeating-linear-gradient(to bottom, transparent 0 2px, var(--ss-line) 2px 3px, transparent 3px 5px)' }}
              />
            ))}
            {cell('t', g.vis.timeline, (
              <div
                className="w-full h-full bg-[var(--ss-raised)]"
                style={{ backgroundImage: 'repeating-linear-gradient(to right, transparent 0 1px, var(--ss-accent) 1px 2px, transparent 2px 4px)', backgroundSize: '100% 55%', backgroundPosition: 'center', backgroundRepeat: 'no-repeat', opacity: 0.9 }}
              />
            ))}
          </div>
          {qc && (
            <div
              className="shrink-0 bg-[var(--ss-warn)]/30 border-[var(--ss-line)]"
              style={{
                order: qcFirst ? 0 : 2,
                ...(qcVertical
                  ? { width: Math.max(5, layout.qcSize * f), borderLeftWidth: qcFirst ? 0 : 1, borderRightWidth: qcFirst ? 1 : 0 }
                  : { height: Math.max(5, layout.qcSize * f * 0.5), borderTopWidth: 1 }),
              }}
            />
          )}
        </div>
      </div>
      {layout.showFooter && <div className="h-[2px] shrink-0 bg-[var(--ss-line)]" />}
    </div>
  );
}
