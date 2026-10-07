import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Play, Square, Undo2, Redo2, Sparkles, ListMusic, Loader2 } from 'lucide-react';
import NameInput from './NameInput';
import { formatClock, formatStamp } from './speakerUtils';

const NEW_SPEAKER = '__new__';

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
  const queueRef = useRef(null);
  queueRef.current = queue;

  const names = useMemo(() => roster.map((r) => r.name), [roster]);
  const active = roster.find((r) => r.name === selected) || roster[0] || null;
  const lines = useMemo(() => (active ? segments.filter((s) => s.speaker === active.name) : []), [segments, active]);
  const byId = useMemo(() => new Map(segments.map((s) => [s.segment_id, s])), [segments]);

  // Keep the selection valid after renames and merges
  useEffect(() => { if (!active && roster[0]) setSelected(roster[0].name); }, [active, roster]);
  useEffect(() => { if (!isOpen) setQueue(null); }, [isOpen]);

  const stop = useCallback(() => {
    const q = queueRef.current;
    setQueue(null);
    const seg = q && byId.get(q.ids[q.i]);
    if (seg) onStop(seg.start_time);
  }, [byId, onStop]);

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

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && !e.defaultPrevented) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const playAll = () => { if (lines.length) setQueue({ ids: lines.map((l) => l.segment_id), i: 0 }); };
  const playOne = (seg) => { setQueue({ ids: [seg.segment_id], i: 0 }); };
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
            {roster.map((spk) => {
              const isActive = active && spk.name === active.name;
              return (
                <div
                  key={spk.name}
                  className="rounded-xl p-3 border"
                  onClick={() => setSelected(spk.name)}
                  style={{ background: isActive ? 'var(--ts-selected)' : 'var(--ts-raised)', borderColor: isActive ? 'rgba(var(--ts-accent-rgb), 0.5)' : 'var(--ts-line)', cursor: 'pointer' }}
                >
                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <span className="ts-spkdot" style={{ background: spk.color }} />
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
                  {lines.map((seg) => (
                    <div
                      key={seg.segment_id}
                      className="flex items-start gap-3"
                      style={{ padding: '10px 16px', borderBottom: '1px solid var(--ts-line-soft)', background: seg.segment_id === playingId ? 'var(--ts-selected)' : 'transparent' }}
                    >
                      <button
                        type="button" className="ts-playbtn" disabled={!canPlay} aria-label={`Play line ${seg.segment_id}`}
                        onClick={() => playOne(seg)}
                      >
                        <Play size={12} fill="currentColor" style={{ marginLeft: 1 }} />
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="ts-mono" style={{ color: 'var(--ts-faint)', fontSize: 11.5 }}>#{seg.segment_id} · {formatStamp(seg.start_time)}</div>
                        <div style={{ lineHeight: 1.5, fontFamily: 'var(--ts-font-script)' }}>{seg.transcript}</div>
                      </div>
                      <select
                        className="ts-field ts-field-sm" style={{ width: 128 }} value="" aria-label={`Move line ${seg.segment_id} to another speaker`}
                        onChange={(e) => { if (e.target.value) onMoveLine(seg.segment_id, e.target.value === NEW_SPEAKER ? null : e.target.value); }}
                      >
                        <option value="">Move to…</option>
                        {names.filter((n) => n !== active.name).map((n) => <option key={n} value={n}>{n}</option>)}
                        <option value={NEW_SPEAKER}>+ New speaker</option>
                      </select>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p style={{ color: 'var(--ts-muted)', padding: 48, textAlign: 'center' }}>No speakers yet.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
