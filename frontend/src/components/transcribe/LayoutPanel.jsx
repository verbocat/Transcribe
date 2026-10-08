import React, { useEffect } from 'react';
import { X, LayoutPanelLeft, RotateCcw, Check, Cloud, CloudOff } from 'lucide-react';
import { PRESETS, DEFAULT_LAYOUT, LIMITS, TIMELINE_MIN } from './layoutModel';
import { Segmented, Section, Row, SwitchRow, Slider, Button } from '../subtitle/ui/controls';

const SYNC_TEXT = {
  local: ['Saved in this browser. Sign in to keep it on your account.', CloudOff],
  loading: ['Loading your saved layout…', Cloud],
  saving: ['Saving to your account…', Cloud],
  saved: ['Saved to your account. It follows you to any device.', Cloud],
  error: ['Could not reach the server. Your layout is kept in this browser.', CloudOff],
};

/** Side drawer for arranging the Transcribe Studio screen. Changes apply live. */
export default function LayoutPanel({ isOpen, onClose, studio }) {
  const { layout, patch, apply, reset, sync, activePreset } = studio;
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);
  if (!isOpen) return null;

  const [syncText, SyncIcon] = SYNC_TEXT[sync] || SYNC_TEXT.local;
  const set = (key) => (value) => patch({ [key]: value });

  return (
    <div className="fixed inset-0" style={{ zIndex: 70 }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside
        role="dialog" aria-label="Layout"
        className="absolute top-0 right-0 bottom-0 flex flex-col"
        style={{ width: 380, maxWidth: '100vw', background: 'var(--ts-panel)', borderLeft: '1px solid var(--ts-line)', boxShadow: '-18px 0 48px rgba(0,0,0,0.45)' }}
      >
        <div className="flex items-center justify-between px-4 shrink-0" style={{ height: 52, borderBottom: '1px solid var(--ts-line)' }}>
          <div className="flex items-center gap-2 font-semibold"><LayoutPanelLeft size={16} style={{ color: 'var(--ts-accent)' }} /> Layout</div>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" icon={RotateCcw} onClick={reset} title="Back to the default layout">Reset</Button>
            <button type="button" className="ts-btn ts-btn-ghost ts-btn-icon" aria-label="Close" onClick={onClose}><X size={16} /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <p className="flex items-start gap-2" style={{ color: 'var(--ts-muted)', fontSize: 12, lineHeight: 1.5 }}>
            <SyncIcon size={14} style={{ marginTop: 2, flex: 'none', color: sync === 'error' ? 'var(--ts-warn)' : 'var(--ts-accent)' }} />
            {syncText}
          </p>

          <Section title="Presets">
            <div className="grid grid-cols-2 gap-2 p-3">
              {PRESETS.map((p) => {
                const on = activePreset?.id === p.id;
                return (
                  <button
                    key={p.id} type="button" aria-pressed={on} onClick={() => apply(p.layout)}
                    className="text-left rounded-xl border p-2.5 transition-colors"
                    style={{ borderColor: on ? 'var(--ts-accent)' : 'var(--ts-line)', background: on ? 'rgba(var(--ts-accent-rgb), 0.1)' : 'var(--ts-raised)' }}
                  >
                    <span className="flex items-center justify-between" style={{ fontWeight: 600, fontSize: 12.5 }}>
                      {p.name} {on && <Check size={12} style={{ color: 'var(--ts-accent)' }} />}
                    </span>
                    <span style={{ display: 'block', color: 'var(--ts-faint)', fontSize: 11.5, lineHeight: 1.35, marginTop: 2 }}>{p.hint}</span>
                  </button>
                );
              })}
            </div>
          </Section>

          <Section title="Arrange">
            <Row label="Speaker list">
              <Segmented label="Speaker list position" value={layout.speakersPos} onChange={set('speakersPos')}
                options={[{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }, { value: 'hidden', label: 'Hidden' }]} />
            </Row>
            <Row label="Timeline">
              <Segmented label="Timeline" value={layout.timelinePos} onChange={set('timelinePos')}
                options={[{ value: 'bottom', label: 'Bottom' }, { value: 'hidden', label: 'Hidden' }]} />
            </Row>
            <SwitchRow label="Video monitor" hint="The small player above the speaker list" checked={layout.showVideo} onChange={set('showVideo')} />
          </Section>

          <Section title="Sizes" description="You can also drag the dividers on the screen. Double-click a divider to reset it.">
            <Slider label="Speaker list width" value={layout.speakersW} min={LIMITS.speakersW[0]} max={LIMITS.speakersW[1]} step={LIMITS.speakersW[2]} unit="px" defaultValue={DEFAULT_LAYOUT.speakersW} onChange={set('speakersW')} />
            <Slider label="Timeline height" hint="0 fits it to the window" value={layout.timelineH} min={0} max={LIMITS.timelineH[1]} step={LIMITS.timelineH[2]} unit="px" defaultValue={0}
              onChange={(v) => patch({ timelineH: v > 0 && v < TIMELINE_MIN ? TIMELINE_MIN : v })} />
          </Section>

          <Section title="Style">
            <Row label="Panes">
              <Segmented label="Pane style" value={layout.paneStyle} onChange={set('paneStyle')}
                options={[{ value: 'flat', label: 'Flat' }, { value: 'cards', label: 'Cards' }]} />
            </Row>
            {layout.paneStyle === 'cards' && (<>
              <Slider label="Gap" value={layout.gap} min={LIMITS.gap[0]} max={LIMITS.gap[1]} unit="px" defaultValue={DEFAULT_LAYOUT.gap} onChange={set('gap')} />
              <Slider label="Corner radius" value={layout.radius} min={LIMITS.radius[0]} max={LIMITS.radius[1]} unit="px" defaultValue={DEFAULT_LAYOUT.radius} onChange={set('radius')} />
            </>)}
          </Section>
        </div>
      </aside>
    </div>
  );
}
