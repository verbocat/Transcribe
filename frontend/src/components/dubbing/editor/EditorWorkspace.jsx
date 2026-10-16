import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  Loader2, Undo2, Redo2, Magnet, ZoomIn, ZoomOut, Maximize2, MousePointer2, Keyboard, RotateCcw, AlertTriangle, X, Check, CloudOff,
  Scissors, MoveHorizontal, Columns2, ArrowRightToLine, Link2, Unlink2,
} from 'lucide-react';
import { call, send } from '../dubApi';
import { getSpeakerPalette, subscribeTheme } from '../../../theme/themeEngine';
import {
  historyInit, historyReducer, moveClips, toggleDisabled, setClipTimes, editPoints, sequenceEnd, liftClips, rippleDeleteClips,
  rippleDeleteRange, closeGap, razor, clipsAt, expandLinked, putBackLine,
} from './editModel';
import Timeline, { TOOLS } from './Timeline';
import ProgramMonitor from './ProgramMonitor';
import AssetsPanel from './AssetsPanel';
import useSequencePlayer from './useSequencePlayer';
import AudioMixer from './AudioMixer';
import { setClipLevels, addKeyframe, moveKeyframe, removeKeyframe, clearKeyframes } from './audioModel';

const SHORTCUTS = [
  ['Playback', [['Space', 'Play or pause'], ['J / K / L', 'Shuttle back, stop, forward (press again for faster)'], ['Left / Right', 'One frame (Shift: five frames)'],
    ['Up / Down', 'Previous or next edit point'], ['Home / End', 'Start or end of the edit']]],
  ['Tools', [['V', 'Selection: move clips, drag an edge to trim'], ['B', 'Ripple Edit: trim an edge and move everything after it'], ['N', 'Rolling Edit: move the cut between two clips'],
    ['Y', 'Slip: show another part of a clip\'s source'], ['C', 'Razor: click to cut (Shift: every track)'], ['Alt + click', 'Act on one clip, not its linked clips']]],
  ['Editing', [['Ctrl + K', 'Cut at the playhead (selected clips, or all)'], ['Ctrl + Shift + K', 'Cut every track at the playhead'], ['Delete', 'Remove clips and leave a gap, or close a selected gap'],
    ['Shift + Delete', 'Ripple delete: remove clips and close the gap'], ['Q / W', 'Ripple trim from the previous edit to the playhead / from the playhead to the next edit'],
    ['Alt + Left / Right', 'Nudge selected clips a frame (Shift: five)'], ['Shift + E', 'Turn selected clips on or off'], ['Ctrl + Z / Ctrl + Shift + Z', 'Undo / redo']]],
  ['Volume', [['Drag the yellow line', 'Clip gain'], ['Ctrl + click the line', 'Add a keyframe'], ['Drag / Alt + click a keyframe', 'Move / remove it'],
    ['Drag a corner square', 'Fade in or out'], ['Mixer tab', 'Track faders, master, ducking'], ['Double-click a fader', 'Back to 0 dB']]],
  ['Timeline', [['S', 'Snapping on or off'], ['Ctrl while dragging', 'Invert snapping for this drag'], ['= / -', 'Zoom in or out'], ['\\', 'Zoom to fit'],
    ['Ctrl + scroll', 'Zoom around the pointer'], ['Click empty track space', 'Select the gap there'], ['Ctrl + A / Esc', 'Select all / deselect'], ['Ctrl + S', 'Save now'], ['?', 'This list']]],
];
const TOOL_ICONS = { select: MousePointer2, ripple: ArrowRightToLine, roll: Columns2, slip: MoveHorizontal, razor: Scissors };
const TOOL_KEYS = { v: 'select', b: 'ripple', n: 'roll', y: 'slip', c: 'razor' };
const SPLIT_KEY = 'lt_dub_editor_split';
const EMPTY = { tracks: [], clips: [] };

function Tool({ icon: Icon, onClick, title, active, disabled, children }) {
  return (
    <button type="button" onClick={onClick} title={title} aria-label={title} aria-pressed={active === undefined ? undefined : !!active} disabled={disabled}
      className={`h-7 min-w-7 px-1.5 rounded-md flex items-center gap-1 text-[11px] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${active ? 'bg-[var(--kt-accent)]/20 text-[var(--kt-accent)]' : 'text-[var(--kt-muted)] hover:text-[var(--kt-text)] hover:bg-[var(--kt-s3)]'}`}>
      <Icon size={14} />{children}
    </button>
  );
}

export default function EditorWorkspace({ projectId, project, mediaUrl, dirtySegments, saveSegments, refresh, running, busy, wrap }) {
  const [hist, dispatch] = useReducer(historyReducer, null, () => historyInit(null));
  const edit = hist.present;
  const [fps, setFps] = useState(25);
  const [error, setError] = useState('');
  const [saveState, setSaveState] = useState('saved'); // saved | pending | saving | error
  const [selection, setSelection] = useState([]);
  const [gap, setGap] = useState(null);
  const [tool, setTool] = useState('select');
  const [linked, setLinked] = useState(true);
  const [snapping, setSnapping] = useState(true);
  const [pps, setPps] = useState(40);
  const [peaks, setPeaks] = useState({});
  const [linePeaks, setLinePeaks] = useState({});
  const [panelTab, setPanelTab] = useState('project');
  const [help, setHelp] = useState(false);
  const [palette, setPalette] = useState(getSpeakerPalette());
  const [split, setSplit] = useState(() => { try { return Number(localStorage.getItem(SPLIT_KEY)) || 0.46; } catch { return 0.46; } });
  const player = useRef(null);
  const black = useRef(null);
  const timelineApi = useRef({});
  const saved = useRef(null);
  const root = useRef(null);
  const duration = Number(project.duration) || 1;
  const maxPps = 400;
  const minPps = Math.min(maxPps, Math.max(0.05, 300 / duration));

  useEffect(() => subscribeTheme(() => setPalette(getSpeakerPalette())), []);

  const ctx = useMemo(() => ({ duration, lines: Object.fromEntries((project.segments || []).map((s) => [s.id, s])) }), [duration, project.segments]);
  const onBlack = useCallback((on) => { if (black.current) black.current.style.display = on ? 'block' : 'none'; }, []);
  const sp = useSequencePlayer({ projectId, edit: edit || EMPTY, ctx, video: player, mediaUrl, hasStems: !!project.stems, onBlack });
  const { getTime, seek } = sp;

  // ------------------------------------------------------------------ load + autosave
  useEffect(() => {
    let off = false;
    call(`/projects/${projectId}/edit`).then((d) => {
      if (off) return;
      saved.current = d.edit; dispatch({ type: 'reset', edit: d.edit }); setFps(d.fps || 25);
      setPps(Math.max(minPps, Math.min(maxPps, 1100 / duration)));
    }).catch((e) => setError(e.message));
    return () => { off = true; };
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveNow = useCallback(async (e) => {
    if (!e || e === saved.current) return;
    setSaveState('saving');
    try {
      await send('PUT', `/projects/${projectId}/edit`, { edit: e });
      saved.current = e; setSaveState((s) => (s === 'saving' ? 'saved' : s));
    } catch (err) { setSaveState('error'); setError(err.message); }
  }, [projectId]);
  useEffect(() => {
    if (!edit || edit === saved.current || hist.base) return undefined;
    setSaveState('pending');
    const t = setTimeout(() => saveNow(edit), 700);
    return () => clearTimeout(t);
  }, [edit, hist.base, saveNow]);
  // save on the way out (tab switch, back to projects)
  const latest = useRef(edit);
  useEffect(() => { latest.current = edit; });
  useEffect(() => () => { if (latest.current && latest.current !== saved.current) saveNow(latest.current); }, [saveNow]);
  // clips that no longer exist (undo, ripple) drop out of the selection
  useEffect(() => {
    if (!edit) return;
    const ids = new Set(edit.clips.map((c) => c.id));
    setSelection((s) => (s.every((id) => ids.has(id)) ? s : s.filter((id) => ids.has(id))));
  }, [edit]);

  // ------------------------------------------------------------------ waveforms
  useEffect(() => {
    call(`/projects/${projectId}/waveform/original`).then((d) => setPeaks((p) => ({ ...p, original: d.peaks }))).catch(() => {});
  }, [projectId]);
  useEffect(() => {
    if (!project.stems) return;
    call(`/projects/${projectId}/waveform/background`).then((d) => setPeaks((p) => ({ ...p, background: d.peaks }))).catch(() => {});
  }, [projectId, project.stems]);
  const revs = (project.segments || []).map((s) => `${s.id}:${s.audio?.rev ?? ''}`).join(',');
  useEffect(() => {
    call(`/projects/${projectId}/waveform/lines`).then((d) => setLinePeaks(d.lines || {})).catch(() => {});
  }, [projectId, revs]);

  // ------------------------------------------------------------------ transport
  const controls = useMemo(() => {
    const end = () => (edit ? sequenceEnd(edit, ctx) : duration);
    const points = () => (edit ? editPoints(edit, ctx) : [0, duration]);
    const jump = (t) => { seek(t); timelineApi.current.reveal?.(t); };
    return {
      toggle: sp.toggle,
      pause: sp.pause,
      forward: () => sp.shuttle(1),
      reverse: () => sp.shuttle(-1),
      step: (frames) => { if (sp.playing) sp.pause(); jump(getTime() + frames / fps); },
      goStart: () => jump(0),
      goEnd: () => jump(end()),
      prevEdit: () => { const t = getTime(); const pts = points().filter((x) => x < t - 1e-3); jump(pts.length ? pts[pts.length - 1] : 0); },
      nextEdit: () => { const t = getTime(); const pt = points().find((x) => x > t + 1e-3); jump(pt ?? end()); },
    };
  }, [edit, ctx, duration, fps, sp, seek, getTime]);

  // ------------------------------------------------------------------ edit actions
  const commit = useCallback((next) => dispatch({ type: 'commit', edit: next }), []);
  const nudge = (frames) => { if (edit && selection.length) commit(moveClips(edit, selection, frames / fps, ctx).edit); };
  const pickClip = (id) => {
    const c = edit?.clips.find((x) => x.id === id);
    if (!c) return;
    setSelection([id]); setGap(null);
    seek(c.start); timelineApi.current.reveal?.(c.start);
  };
  const remove = (ripple) => {
    if (gap) {
      const r = closeGap(edit, gap, ctx);
      if (r.error) setError(r.error); else { commit(r.edit); setGap(null); setError(''); }
      return;
    }
    if (!selection.length) return;
    if (!ripple) { commit(liftClips(edit, selection)); setSelection([]); return; }
    const r = rippleDeleteClips(edit, selection, ctx);
    if (r.error) setError(r.error); else { commit(r.edit); setSelection([]); setError(''); }
  };
  const addEdit = (all) => {
    const t = getTime();
    const under = clipsAt(edit, t, ctx).map((c) => c.id);
    const picked = under.filter((id) => selection.includes(id));
    const ids = all || !picked.length ? under : (linked ? expandLinked(edit, picked) : picked);
    commit(razor(edit, ids, t, ctx));
  };
  const rippleTrimToPlayhead = (side) => {
    const t = getTime();
    const pts = editPoints(edit, ctx);
    if (side === 'q') {
      const a = [...pts].reverse().find((x) => x < t - 1e-3) ?? 0;
      commit(rippleDeleteRange(edit, a, t, ctx)); seek(a);
    } else {
      const b = pts.find((x) => x > t + 1e-3);
      if (b != null) commit(rippleDeleteRange(edit, t, b, ctx));
    }
  };
  const putBack = (seg) => {
    const r = putBackLine(edit, seg, ctx);
    if (r.error) setError(r.error); else { commit(r.edit); setError(''); }
  };
  // clip volume from the inspector (the timeline's volume line edits the same values)
  const onLevels = (id, patch) => commit(setClipLevels(edit, [id], patch, ctx));
  const onKeyframes = (action, id, ...args) => {
    const c = edit.clips.find((x) => x.id === id);
    if (!c) return;
    if (action === 'add') {
      const [x, len] = args;
      if (x < 0 || x > len) { setError('Move the playhead over this clip to add a keyframe there.'); return; }
      commit(addKeyframe(edit, id, x));
    } else if (action === 'set') commit(moveKeyframe(edit, id, args[0], c.keyframes[args[0]].t, args[1]));
    else if (action === 'remove') commit(removeKeyframe(edit, id, args[0]));
    else if (action === 'clear') commit(clearKeyframes(edit, id));
  };
  const regenerate = (sid) => wrap(async () => {
    if (dirtySegments) await saveSegments();
    await send('POST', `/projects/${projectId}/speak`, { ids: [sid] });
    await refresh(true);
  });
  const resetEdit = async () => {
    if (!window.confirm('Undo every timeline edit: the media uncut and every line back at its own time? This cannot be undone.')) return;
    try { const d = await send('DELETE', `/projects/${projectId}/edit`); saved.current = d.edit; dispatch({ type: 'reset', edit: d.edit }); setSelection([]); setGap(null); } catch (e) { setError(e.message); }
  };

  // ------------------------------------------------------------------ keyboard
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (!edit) return;
      const k = e.key; const lk = k.length === 1 ? k.toLowerCase() : k; const mod = e.ctrlKey || e.metaKey;
      const done = () => { e.preventDefault(); e.stopPropagation(); };
      if (mod && lk === 'z') { dispatch({ type: e.shiftKey ? 'redo' : 'undo' }); done(); return; }
      if (mod && lk === 'y') { dispatch({ type: 'redo' }); done(); return; }
      if (mod && lk === 's') { saveNow(edit); done(); return; }
      if (mod && lk === 'a') { setSelection(edit.clips.map((c) => c.id)); setGap(null); done(); return; }
      if (mod && lk === 'k') { addEdit(e.shiftKey); done(); return; }
      if (mod) return;
      if (k === 'Delete' || k === 'Backspace') { remove(e.shiftKey || (k === 'Backspace' && e.altKey)); done(); return; }
      if (k === ' ') { controls.toggle(); done(); return; }
      if (lk === 'k') { controls.pause(); done(); return; }
      if (lk === 'l') { controls.forward(); done(); return; }
      if (lk === 'j') { controls.reverse(); done(); return; }
      if (k === 'ArrowLeft' || k === 'ArrowRight') {
        const n = (k === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 5 : 1);
        if (e.altKey) nudge(n); else controls.step(n);
        done(); return;
      }
      if (k === 'ArrowUp') { controls.prevEdit(); done(); return; }
      if (k === 'ArrowDown') { controls.nextEdit(); done(); return; }
      if (k === 'Home') { controls.goStart(); done(); return; }
      if (k === 'End') { controls.goEnd(); done(); return; }
      if (lk === 'e' && e.shiftKey) { if (selection.length) commit(toggleDisabled(edit, selection)); done(); return; }
      if (k === 'Escape') { setSelection([]); setGap(null); setHelp(false); done(); return; }
      if (lk === 'q' || lk === 'w') { rippleTrimToPlayhead(lk); done(); return; }
      if (TOOL_KEYS[lk] && !e.shiftKey && !e.altKey) { setTool(TOOL_KEYS[lk]); done(); return; }
      if (lk === 's') { setSnapping((v) => !v); done(); return; }
      if (k === '=' || k === '+') { timelineApi.current.zoom?.(1.5); done(); return; }
      if (k === '-' || k === '_') { timelineApi.current.zoom?.(1 / 1.5); done(); return; }
      if (k === '\\') { timelineApi.current.fit?.(); done(); return; }
      if (k === '?') { setHelp((h) => !h); done(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ------------------------------------------------------------------ panel split (drag the bar between monitor and timeline)
  const startSplit = (e) => {
    e.preventDefault();
    const box = root.current.getBoundingClientRect();
    const move = (ev) => setSplit(Math.max(0.2, Math.min(0.75, (ev.clientY - box.top) / box.height)));
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      setSplit((s) => { try { localStorage.setItem(SPLIT_KEY, String(s)); } catch { /* storage unavailable */ } return s; });
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  if (!edit) {
    return <div className="h-[calc(100vh-186px)] grid place-items-center">{error ? <span className="text-sm text-[var(--kt-danger)]">{error}</span> : <Loader2 className="animate-spin text-[var(--kt-accent)]" />}</div>;
  }
  const lineCount = edit.clips.filter((c) => c.source === 'line').length;
  const offCount = edit.clips.filter((c) => c.disabled).length;
  const seqEnd = sequenceEnd(edit, ctx);
  const removed = (edit.removed_lines || []).map((id) => ctx.lines[id]).filter(Boolean);
  const SaveIcon = saveState === 'error' ? CloudOff : saveState === 'saved' ? Check : Loader2;

  return (
    <div ref={root} className="relative h-[calc(100vh-186px)] min-h-[560px] flex flex-col rounded-lg border border-[var(--kt-s4)] overflow-hidden bg-[var(--kt-s0)]">
      {dirtySegments ? (
        <div className="shrink-0 px-3 py-1.5 flex items-center gap-2 text-xs bg-[var(--kt-warn)]/10 border-b border-[var(--kt-warn)]/30">
          <AlertTriangle size={13} className="text-[var(--kt-warn)]" />You have unsaved transcript or translation changes. The editor shows the saved lines.
          <button type="button" onClick={saveSegments} disabled={busy || running} className="ml-auto underline cursor-pointer disabled:opacity-50">Save them now</button>
        </div>
      ) : null}
      {error ? (
        <div role="alert" className="shrink-0 px-3 py-1.5 flex items-center gap-2 text-xs bg-[var(--kt-danger)]/10 border-b border-[var(--kt-danger)]/30">
          <AlertTriangle size={13} className="text-[var(--kt-danger)]" /><span className="flex-1">{error}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setError('')} className="cursor-pointer"><X size={13} /></button>
        </div>
      ) : null}

      <div className="flex min-h-0" style={{ height: `${split * 100}%` }}>
        <div className="w-[320px] shrink-0 border-r border-[var(--kt-s4)] min-h-0 hidden md:block">
          <AssetsPanel project={project} edit={edit} ctx={ctx} fps={fps} selection={selection} palette={palette} tab={panelTab} setTab={setPanelTab}
            onPickClip={(id) => { pickClip(id); }} onClipTimes={(id, patch) => commit(setClipTimes(edit, id, patch, ctx))}
            onToggleClip={(ids) => commit(toggleDisabled(edit, ids))} onRegenerate={regenerate} busy={busy || running}
            removed={removed} onPutBack={putBack} getTime={getTime} onLevels={onLevels} onKeyframes={onKeyframes}
            mixer={<AudioMixer edit={edit} dispatch={dispatch} palette={palette} meters={sp.meters} />} />
        </div>
        <div className="flex-1 min-w-0">
          <ProgramMonitor mediaUrl={mediaUrl} isVideo={project.is_video} player={player} black={black} fps={fps} duration={seqEnd} getTime={getTime}
            playing={sp.playing} rate={sp.playing ? sp.rate : 0} controls={controls} />
        </div>
      </div>

      <div role="separator" aria-orientation="horizontal" aria-label="Resize panels" onPointerDown={startSplit}
        className="h-1.5 shrink-0 cursor-row-resize bg-[var(--kt-s3)] hover:bg-[var(--kt-accent)]/50" />

      <div className="flex-1 min-h-0 flex flex-col">
        <div className="h-9 shrink-0 px-2 flex items-center gap-1 border-b border-[var(--kt-s4)] bg-[var(--kt-s1)] overflow-x-auto">
          {Object.entries(TOOLS).map(([id, t]) => (
            <Tool key={id} icon={TOOL_ICONS[id]} title={`${t.label} tool (${t.key})`} active={tool === id} onClick={() => setTool(id)} />
          ))}
          <span className="w-px h-4 bg-[var(--kt-s4)] mx-1 shrink-0" />
          <Tool icon={linked ? Link2 : Unlink2} title={`Linked selection ${linked ? 'on' : 'off'}: video and its audio pieces move together (Alt+click acts on one)`} active={linked} onClick={() => setLinked((v) => !v)} />
          <Tool icon={Magnet} title={`Snapping ${snapping ? 'on' : 'off'} (S)`} active={snapping} onClick={() => setSnapping((v) => !v)} />
          <span className="w-px h-4 bg-[var(--kt-s4)] mx-1 shrink-0" />
          <Tool icon={Undo2} title="Undo (Ctrl+Z)" disabled={!hist.past.length} onClick={() => dispatch({ type: 'undo' })} />
          <Tool icon={Redo2} title="Redo (Ctrl+Shift+Z)" disabled={!hist.future.length} onClick={() => dispatch({ type: 'redo' })} />
          <span className="w-px h-4 bg-[var(--kt-s4)] mx-1 shrink-0" />
          <Tool icon={ZoomOut} title="Zoom out (-)" onClick={() => timelineApi.current.zoom?.(1 / 1.5)} />
          <input type="range" aria-label="Timeline zoom" min={Math.log(minPps)} max={Math.log(maxPps)} step="0.01" value={Math.log(pps)}
            onChange={(e) => setPps(Math.exp(Number(e.target.value)))} className="w-24 shrink-0 accent-[var(--kt-accent)]" />
          <Tool icon={ZoomIn} title="Zoom in (=)" onClick={() => timelineApi.current.zoom?.(1.5)} />
          <Tool icon={Maximize2} title="Zoom to fit (\)" onClick={() => timelineApi.current.fit?.()} />
          <span className="ml-2 text-[11px] text-[var(--kt-faint)] hidden xl:inline whitespace-nowrap">
            {TOOLS[tool].label} · {lineCount} line clips{offCount ? ` · ${offCount} off` : ''}{removed.length ? ` · ${removed.length} lines removed` : ''} · edit {seqEnd.toFixed(1)}s
          </span>
          <div className="flex-1" />
          <span className={`flex items-center gap-1 text-[11px] shrink-0 ${saveState === 'error' ? 'text-[var(--kt-danger)]' : 'text-[var(--kt-faint)]'}`} title="The timeline saves itself as you edit">
            <SaveIcon size={12} className={saveState === 'saving' || saveState === 'pending' ? 'animate-spin' : ''} />
            {saveState === 'saved' ? 'Saved' : saveState === 'error' ? 'Not saved' : 'Saving'}
          </span>
          <Tool icon={RotateCcw} title="Reset the timeline: media uncut, every line back at its own time" onClick={resetEdit} />
          <Tool icon={Keyboard} title="Keyboard shortcuts (?)" active={help} onClick={() => setHelp((h) => !h)} />
        </div>
        <Timeline edit={edit} ctx={ctx} fps={fps} pps={pps} setPps={setPps} minPps={minPps} maxPps={maxPps} getTime={getTime} seek={seek}
          selection={selection} setSelection={(ids) => { setSelection(ids); if (ids.length) setGap(null); if (ids.length === 1 || (ids.length > 1 && expandLinked(edit, [ids[0]]).length === ids.length)) setPanelTab('clip'); }}
          dispatch={dispatch} snapping={snapping} peaks={peaks} linePeaks={linePeaks} palette={palette} filename={project.filename}
          scrollToRef={timelineApi} playing={sp.playing} tool={tool} linked={linked} gap={gap} setGap={setGap} />
      </div>

      {help ? (
        <div className="absolute inset-0 z-50 bg-black/50 grid place-items-center p-4" onClick={() => setHelp(false)}>
          <div role="dialog" aria-label="Keyboard shortcuts" className="max-w-6xl w-full max-h-full overflow-auto rounded-xl border border-[var(--kt-s5)] bg-[var(--kt-s1)] p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3"><div className="font-semibold text-sm">Keyboard shortcuts</div>
              <button type="button" aria-label="Close" onClick={() => setHelp(false)} className="cursor-pointer text-[var(--kt-faint)] hover:text-[var(--kt-text)]"><X size={15} /></button></div>
            <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-5">
              {SHORTCUTS.map(([group, rows]) => (
                <div key={group}><div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--kt-faint)] mb-2">{group}</div>
                  <dl className="flex flex-col gap-1.5 text-xs">{rows.map(([keys, what]) => (
                    <div key={keys} className="flex flex-col"><dt><kbd className="px-1.5 py-0.5 rounded border border-[var(--kt-s5)] bg-[var(--kt-s2)] text-[11px]" style={{ fontFamily: 'var(--kt-font-mono)' }}>{keys}</kbd></dt><dd className="text-[var(--kt-muted)] mt-0.5">{what}</dd></div>
                  ))}</dl></div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
