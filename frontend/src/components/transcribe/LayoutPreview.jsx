import React, { useRef } from 'react';
import { TIMELINE_MIN, DEFAULT_LAYOUT } from './layoutModel';

/**
 * Miniature schematic of Transcribe Studio that follows a layout object. The reference window is
 * REF_W x REF_H px; every size is a percentage of it. With `onPatch` the speaker-list edge and the
 * timeline edge can be dragged right in the preview.
 */
const REF_W = 1280;
const REF_H = 800;
const AUTO_TL = 0.4; // automatic timeline height, as a share of the window

const tone = (a) => `rgba(var(--ts-accent-rgb), ${a})`;
const bar = (w, a = 0.18) => ({ height: '14%', width: `${w}%`, borderRadius: 2, background: tone(a), flex: 'none' });

function Lines({ n = 5 }) {
  const widths = [86, 64, 78, 52, 70, 60];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '7%', padding: '6% 7%', height: '100%', boxSizing: 'border-box', overflow: 'hidden' }}>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} style={{ display: 'flex', gap: '4%', alignItems: 'center', flex: 'none', height: '9%' }}>
          <span style={{ width: '9%', height: '100%', borderRadius: 2, background: tone(0.45 - (i % 3) * 0.1) }} />
          <span style={{ width: `${widths[i % widths.length]}%`, height: '55%', borderRadius: 2, background: 'var(--ts-line)' }} />
        </div>
      ))}
    </div>
  );
}

function Speakers({ showVideo }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '6%', gap: '6%', boxSizing: 'border-box' }}>
      {showVideo && <div style={{ flex: '0 0 30%', borderRadius: 3, background: 'linear-gradient(135deg, var(--ts-raised), var(--ts-line))', position: 'relative' }}>
        <span style={{ position: 'absolute', left: '42%', top: '32%', borderLeft: '7px solid var(--ts-muted)', borderTop: '5px solid transparent', borderBottom: '5px solid transparent' }} />
      </div>}
      {[0.8, 0.5, 0.3].map((a, i) => (
        <div key={i} style={{ display: 'flex', gap: '8%', alignItems: 'center', flex: 'none', height: '9%' }}>
          <span style={{ width: 8, height: 8, borderRadius: 99, background: tone(a), flex: 'none' }} />
          <span style={{ flex: 1, height: '50%', borderRadius: 2, background: 'var(--ts-line)' }} />
        </div>
      ))}
    </div>
  );
}

function Timeline() {
  const clips = [[4, 22], [30, 18], [52, 26], [82, 12]];
  return (
    <div style={{ height: '100%', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: '18%', height: '28%', background: `repeating-linear-gradient(90deg, ${tone(0.35)} 0 1px, transparent 1px 4px)`, opacity: 0.8 }} />
      {clips.map(([l, w], i) => (
        <span key={i} style={{ position: 'absolute', left: `${l}%`, width: `${w}%`, top: '58%', height: '24%', borderRadius: 2, background: tone(0.4) }} />
      ))}
      <span style={{ position: 'absolute', left: '38%', top: 0, bottom: 0, width: 1, background: 'var(--ts-accent)' }} />
    </div>
  );
}

export default function LayoutPreview({ layout, onPatch, height }) {
  const box = useRef(null);
  const cards = layout.paneStyle === 'cards';
  const gapPct = cards ? (layout.gap / REF_W) * 100 : 0;
  const radius = cards ? Math.max(2, layout.radius * 0.45) : 0;
  const tlShare = layout.timelineH ? layout.timelineH / REF_H : AUTO_TL;
  const tlOn = layout.timelinePos !== 'hidden';
  const spOn = layout.speakersPos !== 'hidden';

  const pane = {
    background: 'var(--ts-panel)', overflow: 'hidden', minWidth: 0, minHeight: 0,
    border: '1px solid var(--ts-line)', borderRadius: radius,
  };

  const drag = (kind) => (e) => {
    if (!onPatch || !box.current) return;
    e.preventDefault();
    const rect = box.current.getBoundingClientRect();
    const startX = e.clientX; const startY = e.clientY;
    const startW = layout.speakersW; const startH = layout.timelineH || Math.round(AUTO_TL * REF_H);
    const sign = layout.speakersPos === 'right' ? -1 : 1;
    const move = (ev) => {
      if (kind === 'x') {
        const dx = ((ev.clientX - startX) / rect.width) * REF_W * sign;
        onPatch({ speakersW: Math.round(startW + dx) });
      } else {
        const dy = ((startY - ev.clientY) / rect.height) * REF_H;
        onPatch({ timelineH: Math.max(TIMELINE_MIN, Math.round(startH + dy)) });
      }
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const handle = (vertical) => onPatch && (
    <div
      onPointerDown={drag(vertical ? 'y' : 'x')} role="separator" aria-hidden="true"
      onDoubleClick={() => onPatch(vertical ? { timelineH: 0 } : { speakersW: DEFAULT_LAYOUT.speakersW })}
      style={{ flex: 'none', [vertical ? 'height' : 'width']: 6, cursor: vertical ? 'row-resize' : 'col-resize', display: 'flex', alignItems: 'center', justifyContent: 'center', touchAction: 'none' }}
    >
      <span style={{ [vertical ? 'width' : 'height']: 22, [vertical ? 'height' : 'width']: 2, borderRadius: 2, background: 'var(--ts-accent)', opacity: 0.7 }} />
    </div>
  );

  return (
    <div
      ref={box} aria-label="Layout preview"
      style={{
        position: 'relative', width: '100%', aspectRatio: `${REF_W} / ${REF_H}`, height, display: 'flex', flexDirection: 'column',
        background: 'var(--ts-bg)', border: '1px solid var(--ts-line)', borderRadius: 8, overflow: 'hidden', boxSizing: 'border-box',
      }}
    >
      <div style={{ flex: 'none', height: '6.5%', background: 'var(--ts-panel)', borderBottom: '1px solid var(--ts-line)', display: 'flex', alignItems: 'center', gap: 4, padding: '0 3%' }}>
        {[10, 8, 9, 7].map((w, i) => <span key={i} style={{ ...bar(w, 0.22), height: '35%' }} />)}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
      {layout.toolRail && (
        <div style={{ flex: 'none', width: '5%', background: 'var(--ts-panel)', borderRight: '1px solid var(--ts-line)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '9%', paddingTop: '6%' }}>
          {[0.7, 0.35, 0.35].map((a, i) => <span key={i} style={{ width: '55%', aspectRatio: '1', borderRadius: 2, background: tone(a) }} />)}
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', padding: `${gapPct}%`, boxSizing: 'border-box' }}>
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: layout.speakersPos === 'right' ? 'row-reverse' : 'row', gap: cards ? `${gapPct}%` : 0 }}>
          {spOn && (<>
            <div style={{ ...pane, flex: 'none', width: `${(layout.speakersW / REF_W) * 100}%` }}><Speakers showVideo={layout.showVideo} /></div>
            {!cards && handle(false)}
          </>)}
          <div style={{ ...pane, flex: 1 }}><Lines /></div>
        </div>
        {tlOn && (<>
          {cards ? <div style={{ height: `${gapPct * 1.6}%` }} /> : handle(true)}
          <div style={{ ...pane, flex: 'none', height: `${Math.min(75, tlShare * 100)}%`, minHeight: 0 }}><Timeline /></div>
        </>)}
      </div>
      </div>
    </div>
  );
}
