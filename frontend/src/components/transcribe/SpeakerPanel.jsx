import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Play, Square, Keyboard, Undo2, Redo2, Sparkles, ListMusic, Loader2 } from 'lucide-react';
import NameInput from './NameInput';
import { formatClock, formatStamp } from './speakerUtils';

/**
 * Speakers editor: every speaker with their lines, play them one after another, name speakers (with autocomplete),
 * merge two speakers, move a single line, and let AI re-check the labels. All edits go through `onChange`, which
 * records them in the editor's undo history.
 */
export default function SpeakerPanel({
  isOpen, onClose, roster, segments, cast, mediaBus, canPlay,
  onPlayOnce, onStop, onRename, onMerge, onMoveLine, onAiReview,
  canUndo, canRedo, onUndo, onRedo,
}) {
  const [selected, setSelected] = useState(null);
  const [queue, setQueue] = useState(null); // { ids, i } while "play all" runs
  const [ai, setAi] = useState({ busy: false, message: '' });
  const [cursorId, setCursorId] = useState(null); // line the keyboard is on
  const queueRef = useRef(null);
  queueRef.current = queue;
  const rowRefs = useRef(new Map());

  const names = useMemo(() => roster.map((r) => r.name), [roster]);
  const active = roster.find((r) => r.name === selected) || roster[0] || null;
  const lines = useMemo(() => (active ? segments.filter((s) => s.speaker === active.name) : []), [segments, active]);
  const byId = useMemo(() => new Map(segments.map((s) => [s.segment_id, s])), [segments]);

  const cursorIdx = Math.max(0, lines.findIndex((l) => l.segment_id === cursorId));
  const cursorSeg = lines[cursorIdx] || null;

  // Keep the selection valid after renames and merges
  useEffect(() => { if (!active && roster[0]) setSelected(roster[0].name); }, [active, roster]);
  useEffect(() => { if (!isOpen) setQueue(null); }, [isOpen]);

  const stopRef = useRef(() => {});
  const stop = useCallback(() => {
    const q = queueRef.current;
    setQueue(null);
    const seg = q && byId.get(q.ids[q.i]);
    if (seg) onStop(seg.start_time);
  }, [byId, onStop]);
  stopRef.current = stop;

  // Play all: start the first line, then move on when the playhead leaves the current one
  useEffect(() => {
    if (!queue) return;
    const seg = byId.get(queue.ids[queue.i]);
    if (!seg) { setQueue(null); return; }
    onPlayOnce(seg.start_time, seg.end_time);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue?.i, queue?.ids]);

  useEffect(() => {
    if (!mediaBus) return undefined;
    return mediaBus.subscribe((bus) => {
      const q = queueRef.current;
      if (!q) return;
      const seg = byId.get(q.ids[q.i]);
      if (!seg || bus.time < seg.end_time - 0.04) return;
      if (q.i + 1 < q.ids.length) setQueue({ ids: q.ids, i: q.i + 1 });
      else { setQueue(null); onStop(seg.end_time); }
    });
  }, [mediaBus, byId, onStop]);

  // Keep the highlighted line in view as the keyboard moves it
  useEffect(() => {
    const el = cursorSeg && rowRefs.current.get(cursorSeg.segment_id);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }, [cursorSeg?.segment_id]);

  const keyState = useRef({});
  keyState.current = { roster, active, lines, cursorIdx, cursorSeg, queue, canPlay };

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') { if (!e.defaultPrevented) onClose(); return; }
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      const tag = t && t.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
      const k = keyState.current;
      const playLine = (seg) => { if (seg && k.canPlay) setQueue({ ids: [seg.segment_id], i: 0 }); };
      const goLine = (delta) => {
        const seg = k.lines[Math.min(k.lines.length - 1, Math.max(0, k.cursorIdx + delta))];
        if (!seg) return;
        setCursorId(seg.segment_id);
        playLine(seg);
      };
      const goSpeaker = (delta) => {
        if (!k.roster.length || !k.active) return;
        const i = k.roster.findIndex((r) => r.name === k.active.name);
        const next = k.roster[(i + delta + k.roster.length) % k.roster.length];
        setSelected(next.name);
        setCursorId(null);
        setQueue(null);
      };
      if (tag === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return;
      let handled = true;
      if (e.key === 'ArrowDown') goLine(1);
      else if (e.key === 'ArrowUp') goLine(-1);
      else if (e.key === 'ArrowRight') goSpeaker(1);
      else if (e.key === 'ArrowLeft') goSpeaker(-1);
      else if (e.key === ' ') {
        if (k.queue) stopRef.current();
        else playLine(k.cursorSeg);
      } else if (e.key === 'Enter') {
        playLine(k.cursorSeg);
        const nxt = k.lines[k.cursorIdx + 1];
        if (nxt) setCursorId(nxt.segment_id);
        // Enter plays this line and moves the highlight on; the next Enter plays the next one
      } else if (/^[1-9]$/.test(e.key) || e.key.toLowerCase() === 'n') {
        const seg = k.cursorSeg;
        if (!seg) return;
        let target = null;
        if (e.key.toLowerCase() === 'n') target = null;
        else {
          const r = k.roster[Number(e.key) - 1];
          if (!r || r.name === k.active.name) return;
          target = r.name;
        }
        const after = k.lines[k.cursorIdx + 1] || k.lines[k.cursorIdx - 1];
        setCursorId(after ? after.segment_id : null);
        onMoveLine(seg.segment_id, target);
      } else handled = false;
      if (handled) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose, onMoveLine]);

  if (!isOpen) return null;

  const playAll = () => { if (lines.length) setQueue({ ids: lines.map((l) => l.segment_id), i: 0 }); };
  const playOne = (seg) => { setCursorId(seg.segment_id); setQueue({ ids: [seg.segment_id], i: 0 }); };
  const playingId = queue ? queue.ids[queue.i] : null;

  const runAi = async () => {
    setAi({ busy: true, message: '' });
    try {
      setAi({ busy: false, message: await onAiReview() });
    } catch (err) {
      setAi({ busy: false, message: `AI review failed: ${err.message || err}` });
    }
  };

  return (
    <div
      role="dialog" aria-modal="true" aria-label="Speakers"
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ zIndex: 70, background: 'rgba(5,7,11,0.78)', backdropFilter: 'blur(6px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ width: '100%', maxWidth: 1040, height: 'min(720px, 90vh)', display: 'flex', flexDirection: 'column', background: 'var(--ts-panel)', border: '1px solid var(--ts-line)', borderRadius: 16, color: 'var(--ts-text)', boxShadow: '0 24px 64px rgba(0,0,0,0.55)' }}>
        <div className="flex items-center gap-2" style={{ padding: '14px 20px', borderBottom: '1px solid var(--ts-line)' }}>
          <ListMusic size={18} style={{ color: 'var(--ts-accent)' }} />
          <h2 style={{ fontWeight: 600, fontSize: 15, flex: 1 }}>Speakers</h2>
          <button type="button" className="ts-btn ts-btn-sm" onClick={runAi} disabled={ai.busy || segments.length < 2} title="Have AI read the conversation and fix wrong or split speakers">
            {ai.busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Check with AI
          </button>
          <button type="button" className="ts-btn ts-btn-ghost ts-btn-icon ts-btn-sm" aria-label="Undo" title="Undo" disabled={!canUndo} onClick={onUndo}><Undo2 size={14} /></button>
          <button type="button" className="ts-btn ts-btn-ghost ts-btn-icon ts-btn-sm" aria-label="Redo" title="Redo" disabled={!canRedo} onClick={onRedo}><Redo2 size={14} /></button>
          <button type="button" className="ts-btn ts-btn-ghost ts-btn-icon" aria-label="Close" onClick={onClose}><X size={16} /></button>
        </div>
        {ai.message && (
          <p role="status" style={{ padding: '8px 20px', fontSize: 12.5, color: 'var(--ts-muted)', borderBottom: '1px solid var(--ts-line)' }}>{ai.message}</p>
        )}

        <div className="flex flex-1 min-h-0">
          {/* Speakers */}
          <div style={{ width: 340, borderRight: '1px solid var(--ts-line)', overflowY: 'auto', padding: 12 }} className="space-y-2.5">
            {roster.map((spk, idx) => {
              const isActive = active && spk.name === active.name;
              return (
                <div
                  key={spk.name}
                  className="rounded-xl border"
                  onClick={() => { setSelected(spk.name); setCursorId(null); }}
                  style={{ padding: 16, background: isActive ? 'var(--ts-selected)' : 'var(--ts-raised)', borderColor: isActive ? 'var(--ts-accent)' : 'var(--ts-line)', borderWidth: isActive ? 2 : 1, boxShadow: isActive ? '0 0 0 3px rgba(var(--ts-accent-rgb), 0.25)' : 'none', cursor: 'pointer', minHeight: 84 }}
                >
                  <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
                    {idx < 9 && (
                      <span className="ts-mono" title={`Press ${idx + 1} to move the highlighted line here`} style={{ minWidth: 28, height: 28, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: '#fff', background: spk.color }}>{idx + 1}</span>
                    )}
                    <NameInput
                      value={spk.name} label={`Name for ${spk.name}`} current={names} cast={cast}
                      onCommit={(name) => { onRename(spk.name, name); if (isActive) setSelected(name); }}
                    />
                  </div>
                  <div className="flex items-center justify-between mt-2.5">
                    <span className="ts-mono" style={{ color: 'var(--ts-muted)', fontSize: 12 }}>
                      {spk.count} lines · {formatClock(spk.seconds)}{spk.mixedGender ? ' · mixed gender' : spk.gender !== 'Unknown' ? ` · ${spk.gender}` : ''}
                    </span>
                    {roster.length > 1 && (
                      <select
                        className="ts-field ts-field-sm" style={{ width: 118 }} value="" aria-label={`Merge ${spk.name} into another speaker`}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => { if (e.target.value) { onMerge(spk.name, e.target.value); setSelected(e.target.value); } }}
                      >
                        <option value="">Merge into…</option>
                        {names.filter((n) => n !== spk.name).map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Lines of the selected speaker */}
          <div className="flex flex-col flex-1 min-w-0">
            {active ? (
              <>
                <div className="flex items-center gap-2" style={{ padding: '10px 16px', borderBottom: '1px solid var(--ts-line)' }}>
                  <span className="ts-spkdot" style={{ background: active.color }} />
                  <strong style={{ flex: 1 }}>{active.name}</strong>
                  {queue ? (
                    <button type="button" className="ts-btn ts-btn-sm" onClick={stop}><Square size={12} /> Stop</button>
                  ) : (
                    <button type="button" className="ts-btn ts-btn-sm ts-btn-primary" onClick={playAll} disabled={!canPlay || !lines.length}
                      title={canPlay ? 'Play every line of this speaker in order' : 'Add the audio or video file to listen'}>
                      <Play size={12} fill="currentColor" /> Play all {lines.length} lines
                    </button>
                  )}
                </div>
                <div style={{ overflowY: 'auto', flex: 1 }}>
                  {lines.map((seg) => {
                    const isCursor = cursorSeg && seg.segment_id === cursorSeg.segment_id;
                    return (
                      <div
                        key={seg.segment_id}
                        ref={(el) => { if (el) rowRefs.current.set(seg.segment_id, el); else rowRefs.current.delete(seg.segment_id); }}
                        onClick={() => setCursorId(seg.segment_id)}
                        style={{ padding: '14px 16px', borderBottom: '1px solid var(--ts-line-soft)', cursor: 'pointer',
                          borderLeft: `6px solid ${isCursor ? active.color : 'transparent'}`,
                          background: seg.segment_id === playingId ? 'var(--ts-selected)' : isCursor ? 'rgba(var(--ts-accent-rgb), 0.14)' : 'transparent',
                          outline: isCursor ? '2px solid var(--ts-accent)' : 'none', outlineOffset: -2 }}
                      >
                        <div className="flex items-start gap-3">
                          <button
                            type="button" className="ts-playbtn" disabled={!canPlay} aria-label={`Play line ${seg.segment_id}`}
                            style={{ width: 40, height: 40 }}
                            onClick={(e) => { e.stopPropagation(); playOne(seg); }}
                          >
                            <Play size={16} fill="currentColor" style={{ marginLeft: 1 }} />
                          </button>
                          <div className="flex-1 min-w-0">
                            <div className="ts-mono" style={{ color: 'var(--ts-faint)', fontSize: 12 }}>#{seg.segment_id} · {formatStamp(seg.start_time)}</div>
                            <div style={{ lineHeight: 1.5, fontSize: 16, fontFamily: 'var(--ts-font-script)' }}>{seg.transcript}</div>
                          </div>
                        </div>
                        {isCursor && (
                          <div className="flex flex-wrap items-center gap-2" style={{ marginTop: 10, paddingLeft: 52 }} onClick={(e) => e.stopPropagation()}>
                            <span style={{ fontSize: 12, color: 'var(--ts-muted)' }}>Move to</span>
                            {roster.map((r, idx) => r.name !== active.name && (
                              <button
                                key={r.name} type="button" className="ts-btn"
                                style={{ minHeight: 36, padding: '0 12px', fontWeight: 600, borderColor: r.color }}
                                onClick={() => { const nx = lines[cursorIdx + 1] || lines[cursorIdx - 1]; setCursorId(nx ? nx.segment_id : null); onMoveLine(seg.segment_id, r.name); }}
                              >
                                {idx < 9 && <kbd className="ts-mono" style={{ opacity: 0.7, marginRight: 6 }}>{idx + 1}</kbd>}{r.name}
                              </button>
                            ))}
                            <button
                              type="button" className="ts-btn" style={{ minHeight: 36, padding: '0 12px', fontWeight: 600 }}
                              onClick={() => { const nx = lines[cursorIdx + 1] || lines[cursorIdx - 1]; setCursorId(nx ? nx.segment_id : null); onMoveLine(seg.segment_id, null); }}
                            ><kbd className="ts-mono" style={{ opacity: 0.7, marginRight: 6 }}>N</kbd>+ New speaker</button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <p style={{ color: 'var(--ts-muted)', padding: 48, textAlign: 'center' }}>No speakers yet.</p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1" style={{ padding: '8px 20px', borderTop: '1px solid var(--ts-line)', fontSize: 12, color: 'var(--ts-muted)' }}>
          <Keyboard size={14} />
          <span><b>↑ ↓</b> previous / next line (plays it)</span>
          <span><b>← →</b> switch speaker</span>
          <span><b>Space</b> play / pause</span>
          <span><b>Enter</b> play and move on</span>
          <span><b>1–9</b> move line to speaker · <b>N</b> new speaker</span>
          <span><b>Esc</b> close</span>
        </div>
      </div>
    </div>
  );
}
