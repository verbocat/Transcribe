import React, { useRef, useState } from 'react';
import {
  PanelLeft, PanelRight, PanelTop, PanelBottom, EyeOff, Undo2, RotateCcw, Save, Copy,
  Pencil, Trash2, Download, Upload, Check, FlipHorizontal2, FlipVertical2, Maximize2,
} from 'lucide-react';
import LayoutThumb from './LayoutThumb';
import { BUILTIN_PRESETS, DEFAULT_LAYOUT, LIMITS } from './layoutModel';
import { Button, Segmented, Section, Row, SwitchRow, Slider, TextInput, IconButton } from '../ui/controls';

const POS = {
  left: { label: 'Left', icon: PanelLeft },
  right: { label: 'Right', icon: PanelRight },
  top: { label: 'Top', icon: PanelTop },
  bottom: { label: 'Bottom', icon: PanelBottom },
  hidden: { label: 'Hidden', icon: EyeOff },
};
const posOptions = (values) => values.map((v) => ({ value: v, label: POS[v].label, icon: POS[v].icon }));

const TABS = [
  { value: 'presets', label: 'Presets' },
  { value: 'arrange', label: 'Arrange' },
  { value: 'sizes', label: 'Sizes' },
  { value: 'style', label: 'Style' },
];

function PresetCard({ preset, active, modified, shortcut, onApply, children }) {
  return (
    <div
      className={`rounded-xl border p-2 transition-colors ${
        active ? 'border-[var(--ss-accent)] bg-[var(--ss-accent)]/10' : 'border-[var(--ss-line)] bg-[var(--ss-raised)]/50 hover:border-[var(--ss-muted)]'
      }`}
    >
      <button type="button" onClick={onApply} className="block w-full text-left cursor-pointer" aria-pressed={active}>
        <LayoutThumb layout={preset.layout} width={150} />
        <div className="mt-1.5 flex items-center justify-between gap-1">
          <span className="text-[12px] font-semibold text-[var(--ss-text)] truncate">{preset.name}</span>
          {active && (
            <span className="text-[10px] text-[var(--ss-accent)] shrink-0 inline-flex items-center gap-0.5">
              {modified ? 'edited' : <><Check size={10} /> active</>}
            </span>
          )}
          {!active && shortcut && <kbd className="text-[10px] font-mono text-[var(--ss-faint)] shrink-0">Alt+{shortcut}</kbd>}
        </div>
        {preset.hint && <p className="text-[10.5px] leading-snug text-[var(--ss-faint)]">{preset.hint}</p>}
      </button>
      {children}
    </div>
  );
}

/** Layout page of the Settings dialog: presets, arrangement, sizes and chrome. */
export default function LayoutSettings({ studio }) {
  const {
    layout, patch, activeId, modified, canRevert, custom, activePreset,
    applyPreset, reset, revert, mirror, savePreset, updatePreset, renamePreset,
    deletePreset, duplicatePreset, exportJSON, importJSON,
  } = studio;
  const [tab, setTab] = useState('presets');
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState(null);
  const [renameText, setRenameText] = useState('');
  const [note, setNote] = useState('');
  const fileRef = useRef(null);

  const flash = (msg) => { setNote(msg); setTimeout(() => setNote(''), 3500); };
  const set = (key) => (value) => patch({ [key]: value });
  const sideVideo = layout.videoPos === 'left' || layout.videoPos === 'right';
  const slider = (key, label, hint, unit = 'px') => (
    <Slider label={label} hint={hint} value={layout[key]} min={LIMITS[key][0]} max={LIMITS[key][1]} step={LIMITS[key][2]} unit={unit} defaultValue={DEFAULT_LAYOUT[key]} onChange={set(key)} />
  );

  const doSave = () => { if (savePreset(newName)) { setNewName(''); flash('Preset saved'); } };
  const doExport = () => {
    const url = URL.createObjectURL(new Blob([exportJSON()], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'subtitle-studio-layouts.json';
    a.click();
    URL.revokeObjectURL(url);
  };
  const doImport = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const n = importJSON(await file.text());
    flash(n < 0 ? 'That file is not a layout export' : n === 0 ? 'Layout applied' : `Imported ${n} preset${n === 1 ? '' : 's'}`);
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <p className="flex-1 min-w-0 text-[12px] text-[var(--ss-faint)] truncate">
          {activePreset
            ? <>Preset <strong className="text-[var(--ss-muted)]">{activePreset.name}</strong>{modified ? ' (edited)' : ''}</>
            : 'Custom arrangement'}
          {note && <span className="ml-2 text-[var(--ss-accent)]">· {note}</span>}
        </p>
        <Button size="sm" icon={Undo2} onClick={revert} disabled={!canRevert} title="Go back to the layout you had before the last preset or quick move">Undo</Button>
        <Button size="sm" icon={RotateCcw} onClick={reset} title="Return to the Classic preset">Reset</Button>
      </div>

      <Segmented className="mb-5" label="Layout section" value={tab} onChange={setTab} options={TABS} />

      {tab === 'presets' && (
        <>
          <Section title="Built-in presets" description="Click to apply instantly. Alt+1 … Alt+9 switch between the first nine from anywhere.">
            <div className="p-3 grid grid-cols-2 gap-2.5">
              {BUILTIN_PRESETS.map((p, i) => (
                <PresetCard key={p.id} preset={p} active={activeId === p.id} modified={modified} shortcut={i < 9 ? i + 1 : null} onApply={() => applyPreset(p.id)}>
                  <button type="button" onClick={() => duplicatePreset(p.id)} className="mt-1.5 text-[10.5px] text-[var(--ss-faint)] hover:text-[var(--ss-text)] inline-flex items-center gap-1 cursor-pointer" title="Copy into My presets so you can edit it">
                    <Copy size={10} /> Make my own
                  </button>
                </PresetCard>
              ))}
            </div>
          </Section>

          <Section title="My presets" description="Save the arrangement on screen right now, then recall it any time.">
            <div className="p-3 flex gap-2">
              <TextInput
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') doSave(); }}
                placeholder="Name this layout"
                maxLength={40}
                aria-label="New preset name"
              />
              <Button icon={Save} onClick={doSave} disabled={!newName.trim()}>Save</Button>
            </div>
            {custom.length === 0 ? (
              <p className="px-4 py-3 text-[12px] text-[var(--ss-faint)]">No saved presets yet.</p>
            ) : (
              <div className="p-3 grid grid-cols-2 gap-2.5">
                {custom.map((p) => (
                  <PresetCard key={p.id} preset={p} active={activeId === p.id} modified={modified} onApply={() => applyPreset(p.id)}>
                    {renaming === p.id ? (
                      <form className="mt-1.5 flex gap-1" onSubmit={(e) => { e.preventDefault(); renamePreset(p.id, renameText); setRenaming(null); }}>
                        <TextInput autoFocus value={renameText} onChange={(e) => setRenameText(e.target.value)} maxLength={40} className="h-7" aria-label="Preset name" />
                        <IconButton type="submit" icon={Check} label="Confirm name" size="sm" variant="primary" />
                      </form>
                    ) : (
                      <div className="mt-1.5 flex items-center gap-0.5">
                        <IconButton size="sm" icon={Pencil} label={`Rename ${p.name}`} onClick={() => { setRenaming(p.id); setRenameText(p.name); }} />
                        <IconButton size="sm" icon={Copy} label={`Duplicate ${p.name}`} onClick={() => duplicatePreset(p.id)} />
                        <IconButton size="sm" icon={Save} label={`Overwrite ${p.name} with the current layout`} onClick={() => { updatePreset(p.id); flash(`Updated “${p.name}”`); }} />
                        <IconButton size="sm" icon={Trash2} label={`Delete ${p.name}`} className="ml-auto hover:!text-[var(--ss-danger)]" onClick={() => deletePreset(p.id)} />
                      </div>
                    )}
                  </PresetCard>
                ))}
              </div>
            )}
            <div className="p-3 flex gap-2">
              <Button icon={Download} onClick={doExport} title="Download your presets and current layout as JSON">Export</Button>
              <Button icon={Upload} onClick={() => fileRef.current?.click()} title="Load presets from a JSON export">Import</Button>
              <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={doImport} />
            </div>
          </Section>
        </>
      )}

      {tab === 'arrange' && (
        <>
          <Section title="Quick moves">
            <div className="p-3 grid grid-cols-2 gap-2">
              <Button icon={FlipHorizontal2} onClick={() => mirror('h')} title="Swap left and right">Mirror left ↔ right</Button>
              <Button icon={FlipVertical2} onClick={() => mirror('v')} title="Swap top and bottom">Flip top ↕ bottom</Button>
            </div>
          </Section>

          <Section title="Video monitor" description="Hiding it keeps playback state, so you can bring it back instantly.">
            <div className="p-3"><Segmented label="Video position" value={layout.videoPos} onChange={set('videoPos')} options={posOptions(['left', 'right', 'top', 'bottom', 'hidden'])} /></div>
          </Section>

          <Section title="Timeline" description="The multi-track waveform and subtitle blocks.">
            <div className="p-3 space-y-2">
              <Segmented label="Timeline position" value={layout.timelinePos} onChange={set('timelinePos')} options={posOptions(['top', 'bottom', 'hidden'])} />
              {sideVideo && layout.timelinePos !== 'hidden' && (
                <Segmented label="Timeline width" value={layout.timelineSpan} onChange={set('timelineSpan')} options={[{ value: 'full', label: 'Full width' }, { value: 'list', label: 'Under list only' }]} />
              )}
            </div>
          </Section>

          <Section title="Tool rail" description="The Open / Import / Generate / QC / Export buttons.">
            <div className="p-3"><Segmented label="Tool rail position" value={layout.sidebar} onChange={set('sidebar')} options={posOptions(['left', 'right', 'top', 'bottom', 'hidden'])} /></div>
            {(layout.sidebar === 'top' || layout.sidebar === 'bottom') && <SwitchRow label="Show button labels" checked={layout.sidebarLabels} onChange={set('sidebarLabels')} />}
          </Section>

          <Section title="QC report" description="Overlay floats above the workspace. Docked pins it beside or below your panes so you can fix issues while reading.">
            <div className="p-3">
              <Segmented
                label="QC report mode"
                value={layout.qcDock}
                onChange={set('qcDock')}
                options={[
                  { value: 'overlay', label: 'Overlay' },
                  { value: 'left', label: 'Left', icon: PanelLeft },
                  { value: 'right', label: 'Right', icon: PanelRight },
                  { value: 'bottom', label: 'Bottom', icon: PanelBottom },
                ]}
              />
            </div>
          </Section>

          <Section title="Focus one pane" description="Hide everything except one pane. A button in the corner brings the rest back.">
            <div className="p-3">
              <Segmented
                label="Focus pane"
                value={layout.maximize}
                onChange={set('maximize')}
                options={[
                  { value: 'none', label: 'Off' },
                  { value: 'video', label: 'Video', icon: Maximize2 },
                  { value: 'list', label: 'List', icon: Maximize2 },
                  { value: 'timeline', label: 'Timeline', icon: Maximize2 },
                ]}
              />
            </div>
          </Section>
        </>
      )}

      {tab === 'sizes' && (
        <>
          <Section title="Panes" description="You can also drag the dividers directly. Double-click a divider to reset it; arrow keys nudge it.">
            {sideVideo && slider('videoW', 'Video width')}
            {(layout.videoPos === 'top' || layout.videoPos === 'bottom') && slider('videoH', 'Video height')}
            {slider('timelineH', 'Timeline height')}
            {sideVideo && slider('listMinW', 'Minimum list width')}
            {layout.qcDock !== 'overlay' && slider('qcSize', 'Docked QC size')}
          </Section>
          <Button icon={RotateCcw} onClick={() => patch({ videoW: DEFAULT_LAYOUT.videoW, videoH: DEFAULT_LAYOUT.videoH, timelineH: DEFAULT_LAYOUT.timelineH, listMinW: DEFAULT_LAYOUT.listMinW, qcSize: DEFAULT_LAYOUT.qcSize })}>
            Reset all sizes
          </Button>
        </>
      )}

      {tab === 'style' && (
        <>
          <Section title="Panes" description="Flat panes meet edge to edge. Cards float with rounded corners and spacing.">
            <div className="p-3"><Segmented label="Pane style" value={layout.paneStyle} onChange={set('paneStyle')} options={[{ value: 'flat', label: 'Flat' }, { value: 'cards', label: 'Cards' }]} /></div>
            {slider('gap', 'Spacing between panes')}
            {slider('radius', 'Corner radius')}
            {slider('splitter', 'Divider thickness')}
          </Section>

          <Section title="Header" description="Reclaim vertical space on small screens. With the header hidden, a small Settings button stays in the corner.">
            <SwitchRow label="Show header" checked={layout.showHeader} onChange={set('showHeader')} />
            {layout.showHeader && (
              <>
                <Row label="Menu style" hint="Compact folds File, Edit, Subtitle… into one menu button.">
                  <Segmented label="Menu style" value={layout.menuStyle} onChange={set('menuStyle')} options={[{ value: 'full', label: 'Full' }, { value: 'compact', label: 'Compact' }]} className="w-44" />
                </Row>
                <SwitchRow label="Media file pill" hint="The file name chip in the middle of the header." checked={layout.showMediaPill} onChange={set('showMediaPill')} />
                <SwitchRow label="Draft save status" hint="“Draft saved 10:42” next to your account." checked={layout.showSaveStatus} onChange={set('showSaveStatus')} />
              </>
            )}
          </Section>

          <Section title="Status bar">
            <SwitchRow label="Show status bar" hint="Timecode, FPS and QC score along the bottom." checked={layout.showFooter} onChange={set('showFooter')} />
            {layout.showFooter && <SwitchRow label="Shortcut hints" hint="The “Space: Play · L: Loop …” reminder." checked={layout.showHints} onChange={set('showHints')} />}
          </Section>
        </>
      )}
    </div>
  );
}
