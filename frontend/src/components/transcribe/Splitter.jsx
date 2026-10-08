import React, { useRef } from 'react';

/**
 * A draggable divider. `axis` 'x' is a vertical bar that resizes a width, 'y' a horizontal bar that
 * resizes a height. `sign` says which way growing the pointer coordinate changes the size.
 * Arrow keys nudge it, double-click resets it.
 */
export default function Splitter({ axis, sign = 1, value, min, max, onChange, onReset, label, thickness = 6 }) {
  const drag = useRef(null);
  const horizontal = axis === 'x';
  const clamp = (n) => Math.min(max, Math.max(min, n));

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { start: horizontal ? e.clientX : e.clientY, value };
    document.body.style.cursor = horizontal ? 'col-resize' : 'row-resize';
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    onChange(clamp(Math.round(d.value + sign * ((horizontal ? e.clientX : e.clientY) - d.start))));
  };
  const end = () => { drag.current = null; document.body.style.cursor = ''; };
  const onKeyDown = (e) => {
    const dec = horizontal ? 'ArrowLeft' : 'ArrowUp';
    const inc = horizontal ? 'ArrowRight' : 'ArrowDown';
    if (e.key !== dec && e.key !== inc) return;
    e.preventDefault();
    onChange(clamp(value + sign * (e.key === inc ? 1 : -1) * (e.shiftKey ? 48 : 16)));
  };

  return (
    <div
      role="separator" aria-orientation={horizontal ? 'vertical' : 'horizontal'} aria-label={label} tabIndex={0}
      title="Drag to resize · double-click to reset · arrow keys nudge"
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={end} onPointerCancel={end}
      onDoubleClick={onReset} onKeyDown={onKeyDown}
      className="group relative z-10 shrink-0 flex items-center justify-center outline-none"
      style={{ touchAction: 'none', cursor: horizontal ? 'col-resize' : 'row-resize', ...(horizontal ? { width: thickness } : { height: thickness }) }}
    >
      <span className="absolute" style={horizontal ? { top: 0, bottom: 0, left: -4, right: -4 } : { left: 0, right: 0, top: -4, bottom: -4 }} />
      <span
        className="rounded-full transition-colors group-hover:bg-[var(--ts-accent)] group-focus-visible:bg-[var(--ts-accent)]"
        style={{ background: 'var(--ts-line)', ...(horizontal ? { width: 3, height: 40, maxHeight: '100%' } : { height: 3, width: 40, maxWidth: '100%' }) }}
      />
    </div>
  );
}
