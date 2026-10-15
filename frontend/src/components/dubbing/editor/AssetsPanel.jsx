import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FileVideo, FileAudio, AudioLines, Search, Mic2, Eye, EyeOff } from 'lucide-react';
import { clipEnd, clipLength, clipOut, isEditable, sourceLength, timecode } from './editModel';

const inputCls = 'h-7 w-full rounded-md bg-[var(--kt-s2)] border border-[var(--kt-s5)] px-2 text-xs tabular-nums';

function Row({ icon: Icon, color, label, sub, onClick, active }) {
  return (
    <button type="button" onClick={onClick}
      className={`w-full text-left flex items-center gap-2 px-2 py-1 rounded-md cursor-pointer ${active ? 'bg-[var(--kt-selected)]' : 'hover:bg-[var(--kt-s2)]'}`}>
      {Icon ? <Icon size={13} className="shrink-0 text-[var(--kt-faint)]" /> : <span className="h-2 w-2 rounded-sm shrink-0" style={{ background: color }} />}
      <span className="min-w-0 flex-1">
        <span className="block text-xs truncate" style={{ fontFamily: 'var(--kt-font-script)' }}>{label}</span>
        {sub ? <span className="block text-[10px] text-[var(--kt-faint)] truncate">{sub}</span> : null}
      </span>
    </button>
  );
}

// Seconds field that commits on Enter or blur.
function TimeField({ label, value, onCommit, disabled }) {
  const [draft, setDraft] = useState(null);
  const shown = draft ?? value.toFixed(3);
  const commit = () => { if (draft != null) { const v = Number(draft); if (Number.isFinite(v)) onCommit(v); setDraft(null); } };
  return (
    <label className="flex flex-col gap-0.5 text-[10px] text-[var(--kt-faint)]">{label}
      <input className={inputCls} value={shown} disabled={disabled} inputMode="decimal"
        onChange={(e) => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.currentTarget.blur(); } if (e.key === 'Escape') { setDraft(null); e.currentTarget.blur(); } }} />
    </label>
  );
}

export default function AssetsPanel({
  project, edit, ctx, fps, selection, palette, onPickClip, onClipTimes, onToggleClip, onRegenerate, busy, tab, setTab,
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState({});
  const speakerTracks = edit.tracks.filter((t) => t.role === 'speaker');
  const lineClips = useMemo(() => {
    const m = {};
    for (const c of edit.clips) if (c.source === 'line') (m[c.track] = m[c.track] || []).push(c);
    for (const k of Object.keys(m)) m[k].sort((a, b) => a.start - b.start);
    return m;
  }, [edit.clips]);
  const needle = q.trim().toLowerCase();
  const matches = (seg) => !needle || `${seg.text} ${seg.translation}`.toLowerCase().includes(needle);
  const selectedClip = selection.length === 1 ? edit.clips.find((c) => c.id === selection[0]) : null;
  const seg = selectedClip?.source === 'line' ? ctx.lines[selectedClip.line] : null;

  const tabBtn = (id, label) => (
    <button type="button" onClick={() => setTab(id)}
      className={`h-8 px-3 text-[11px] font-semibold uppercase tracking-wider cursor-pointer border-b-2 -mb-px ${tab === id ? 'border-[var(--kt-accent)] text-[var(--kt-text)]' : 'border-transparent text-[var(--kt-faint)] hover:text-[var(--kt-text)]'}`}>{label}</button>
  );

  return (
    <section className="h-full min-w-0 flex flex-col bg-[var(--kt-s1)]" aria-label="Assets">
      <div className="h-8 shrink-0 flex border-b border-[var(--kt-s4)]">{tabBtn('project', 'Project')}{tabBtn('clip', 'Clip')}</div>
      {tab === 'project' ? (
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="p-2 shrink-0">
            <label className="relative block">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--kt-faint)]" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search lines" aria-label="Search lines"
                className="h-7 w-full rounded-md bg-[var(--kt-s2)] border border-[var(--kt-s5)] pl-7 pr-2 text-xs" />
            </label>
          </div>
          <div className="flex-1 min-h-0 overflow-auto px-1 pb-2">
            <div className="px-2 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--kt-faint)]">Media</div>
            <Row icon={project.is_video ? FileVideo : FileAudio} label={project.filename} sub={`Source · ${timecode(project.duration, fps)}`} onClick={() => onPickClip(project.is_video ? 'V1' : 'A1')} />
            {project.stems
              ? <Row icon={AudioLines} label="Background (music and effects)" sub={`Separated · ${project.stems.mode || ''}`} onClick={() => onPickClip('A2')} />
              : <div className="px-2 py-1 text-[11px] text-[var(--kt-faint)]">Background not separated yet (Voice-over tab).</div>}
            {speakerTracks.map((t, i) => {
              const clips = (lineClips[t.id] || []).filter((c) => ctx.lines[c.line] && matches(ctx.lines[c.line]));
              const isOpen = open[t.id] ?? !!needle;
              return (
                <div key={t.id} className="mt-1">
                  <button type="button" onClick={() => setOpen((o) => ({ ...o, [t.id]: !isOpen }))}
                    className="w-full flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-[var(--kt-s2)] cursor-pointer text-xs">
                    {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: palette[i % palette.length] }} />
                    <span className="font-medium truncate">{t.name}</span>
                    <span className="ml-auto text-[10px] text-[var(--kt-faint)]">{clips.length} lines</span>
                  </button>
                  {isOpen ? clips.map((c) => {
                    const s = ctx.lines[c.line];
                    return <Row key={c.id} color={palette[i % palette.length]} active={selection.includes(c.id)}
                      label={s.translation || s.text} sub={`${timecode(c.start, fps)} · ${clipLength(c, ctx).toFixed(2)}s${s.audio?.ready ? '' : ' · no speech yet'}${c.disabled ? ' · off' : ''}`}
                      onClick={() => onPickClip(c.id)} />;
                  }) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto p-3 flex flex-col gap-3 text-xs">
          {!selectedClip ? <div className="text-[var(--kt-faint)]">Select a clip on the timeline to see and edit it here.</div> : null}
          {selectedClip && !seg ? (
            <div className="flex flex-col gap-1">
              <div className="font-semibold">{edit.tracks.find((t) => t.id === selectedClip.track)?.name}</div>
              <div className="text-[var(--kt-faint)]">The source media stays fixed in this version of the editor. Cutting it comes with the cutting tools.</div>
            </div>
          ) : null}
          {seg ? (
            <>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-[var(--kt-faint)]">{seg.speaker} · line {seg.id}</div>
                <div className="mt-1 text-[var(--kt-muted)]" style={{ fontFamily: 'var(--kt-font-script)' }}>{seg.text}</div>
                <div className="mt-1 text-[13px]" style={{ fontFamily: 'var(--kt-font-script)' }}>{seg.translation || <span className="text-[var(--kt-faint)]">Not translated yet</span>}</div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <TimeField label="Timeline start (s)" value={selectedClip.start} disabled={!isEditable(selectedClip, edit)} onCommit={(v) => onClipTimes(selectedClip.id, { start: v })} />
                <TimeField label="Duration (s)" value={clipLength(selectedClip, ctx)} disabled />
                <TimeField label="Source in (s)" value={selectedClip.in} disabled={!isEditable(selectedClip, edit)} onCommit={(v) => onClipTimes(selectedClip.id, { in: v })} />
                <TimeField label="Source out (s)" value={clipOut(selectedClip, ctx)} disabled={!isEditable(selectedClip, edit)} onCommit={(v) => onClipTimes(selectedClip.id, { out: v })} />
              </div>
              <div className="text-[11px] text-[var(--kt-faint)] leading-relaxed">
                Original slot {timecode(seg.start, fps)} – {timecode(seg.end, fps)} ({(seg.end - seg.start).toFixed(2)}s).
                {seg.audio?.ready ? ` Speech is ${sourceLength(selectedClip, ctx).toFixed(2)}s${seg.audio.tempo > 1.001 ? `, sped up ${seg.audio.tempo.toFixed(2)}× to fit` : ''}.` : ' No speech generated yet.'}
                {' '}Ends at {timecode(clipEnd(selectedClip, ctx), fps)}.
              </div>
              {seg.audio?.stale ? <div className="text-[11px] text-[var(--kt-warn)]">The text or voice changed since this speech was generated.</div> : null}
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={busy || !(seg.translation || '').trim()} onClick={() => onRegenerate(seg.id)}
                  className="h-7 px-2.5 rounded-md text-xs font-semibold flex items-center gap-1.5 cursor-pointer border border-[var(--kt-s5)] bg-[var(--kt-s2)] hover:bg-[var(--kt-s3)] disabled:opacity-50 disabled:cursor-not-allowed">
                  <Mic2 size={12} />{seg.audio?.ready ? 'Regenerate speech' : 'Generate speech'}</button>
                <button type="button" disabled={!isEditable(selectedClip, edit)} onClick={() => onToggleClip([selectedClip.id])}
                  className="h-7 px-2.5 rounded-md text-xs font-semibold flex items-center gap-1.5 cursor-pointer border border-[var(--kt-s5)] bg-[var(--kt-s2)] hover:bg-[var(--kt-s3)] disabled:opacity-50 disabled:cursor-not-allowed">
                  {selectedClip.disabled ? <Eye size={12} /> : <EyeOff size={12} />}{selectedClip.disabled ? 'Turn clip on' : 'Turn clip off'}</button>
              </div>
            </>
          ) : null}
          {selection.length > 1 ? <div className="text-[var(--kt-faint)]">{selection.length} clips selected. Drag one to move them together, Alt+Left or Right nudges them a frame, Shift+E turns them on or off.</div> : null}
        </div>
      )}
    </section>
  );
}
