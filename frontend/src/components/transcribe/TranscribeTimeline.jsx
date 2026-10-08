import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause, Square } from 'lucide-react';
import AudioWaveformTimeline from '../subtitle/AudioWaveformTimeline';
import { publishPlayhead, getPlayhead } from '../../utils/playheadBus';

const PEAKS_PER_SEC = 50;

/** Waveform peaks (0..1, 50 per second) decoded in the browser from the audio file. */
async function decodePeaks(url, signal) {
  const res = await fetch(url, { signal });
  const buf = await res.arrayBuffer();
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  try {
    const audio = await ctx.decodeAudioData(buf);
    const data = audio.getChannelData(0);
    const step = Math.max(1, Math.floor(audio.sampleRate / PEAKS_PER_SEC));
    const out = [];
    let max = 0;
    for (let i = 0; i < data.length; i += step) {
      let m = 0;
      const end = Math.min(data.length, i + step);
      for (let j = i; j < end; j++) { const v = Math.abs(data[j]); if (v > m) m = v; }
      out.push(m);
      if (m > max) max = m;
    }
    return max > 0 ? out.map((v) => v / max) : out;
  } finally {
    ctx.close?.().catch(() => {});
  }
}

const fmt = (s) => {
  if (!Number.isFinite(s)) return '00:00.0';
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${(s % 60).toFixed(1).padStart(4, '0')}`;
};

/**
 * Transcribe's timeline: the same scrolling, zooming, playhead scrubbing and segment drag/resize
 * controls as Subtitle Studio (AudioWaveformTimeline), driven by a plain <audio> element.
 * Transcript segments are presented to the timeline as subtitle events.
 */
export default function TranscribeTimeline({
  audioUrl, videoUrl, segments, activeSegmentId, setActiveSegmentId,
  onSegmentTimeChange, onSplit, onMerge, onAdd, onUndo, onRedo,
  playTargetTime, onTimeUpdate, onPlayStateChange,
}) {
  const audioRef = useRef(null);
  const loopRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [peaks, setPeaks] = useState([]);
  const [time, setTime] = useState(0);
  const cbRef = useRef({});
  cbRef.current = { onTimeUpdate, onPlayStateChange };

  const events = useMemo(() => (segments || []).map((s) => ({
    id: s.segment_id, start_time: s.start_time, end_time: s.end_time, text: s.text || '', speaker: s.speaker,
  })), [segments]);

  // Peaks for the waveform lane
  useEffect(() => {
    setPeaks([]);
    if (!audioUrl) return undefined;
    const ac = new AbortController();
    decodePeaks(audioUrl, ac.signal).then(setPeaks).catch(() => {});
    return () => ac.abort();
  }, [audioUrl]);

  // Playhead: published every frame while playing (the timeline needle and video follow it)
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return undefined;
    let raf = 0;
    const tick = () => {
      const t = a.currentTime;
      const loop = loopRef.current;
      if (loop && (t >= loop.end - 0.02 || t < loop.start - 0.2)) a.currentTime = loop.start;
      publishPlayhead(a.currentTime);
      cbRef.current.onTimeUpdate?.(a.currentTime);
      if (!a.paused) raf = requestAnimationFrame(tick);
    };
    const onPlay = () => { setPlaying(true); cbRef.current.onPlayStateChange?.(true); cancelAnimationFrame(raf); raf = requestAnimationFrame(tick); };
    const onPause = () => { setPlaying(false); cbRef.current.onPlayStateChange?.(false); };
    const onMeta = () => setDuration(a.duration || 0);
    const onEnd = () => { if (loopRef.current) { a.currentTime = loopRef.current.start; a.play().catch(() => {}); } };
    a.addEventListener('play', onPlay); a.addEventListener('pause', onPause);
    a.addEventListener('loadedmetadata', onMeta); a.addEventListener('ended', onEnd);
    if (a.readyState >= 1) onMeta();
    return () => {
      cancelAnimationFrame(raf);
      a.removeEventListener('play', onPlay); a.removeEventListener('pause', onPause);
      a.removeEventListener('loadedmetadata', onMeta); a.removeEventListener('ended', onEnd);
    };
  }, [audioUrl]);

  // Keep the readout in step with the playhead
  useEffect(() => {
    const id = setInterval(() => setTime(getPlayhead()), 100);
    return () => clearInterval(id);
  }, []);

  const seek = useCallback((t) => {
    const a = audioRef.current;
    loopRef.current = null;
    if (a && Number.isFinite(t)) a.currentTime = Math.max(0, t);
    publishPlayhead(Math.max(0, t));
    cbRef.current.onTimeUpdate?.(Math.max(0, t));
  }, []);

  const toggle = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    loopRef.current = null;
    if (a.paused) a.play().catch(() => {}); else a.pause();
  }, []);

  const stop = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    loopRef.current = null;
    a.pause();
  }, []);

  // Play / loop / stop requests from the transcript list
  useEffect(() => {
    const a = audioRef.current;
    if (!playTargetTime || !a) return;
    const start = parseFloat(playTargetTime.time) || 0;
    if (playTargetTime.pause) { loopRef.current = null; a.pause(); a.currentTime = start; publishPlayhead(start); return; }
    const end = playTargetTime.endTime !== undefined ? parseFloat(playTargetTime.endTime) : start + 3;
    loopRef.current = playTargetTime.loop ? { start, end } : null;
    a.currentTime = start;
    publishPlayhead(start);
    a.play().catch(() => {});
  }, [playTargetTime]);

  // Space plays / pauses, as in Subtitle Studio
  useEffect(() => {
    const onKey = (e) => {
      const el = e.target;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
      if (e.code === 'Space' && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); toggle(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);

  const playEvent = useCallback((id) => {
    const seg = (segments || []).find((s) => s.segment_id === id);
    if (!seg) return;
    const a = audioRef.current;
    if (!a) return;
    loopRef.current = null;
    a.currentTime = seg.start_time;
    publishPlayhead(seg.start_time);
    a.play().catch(() => {});
  }, [segments]);

  return (
    <div className="flex flex-col h-full min-h-0" style={{ background: 'var(--ss-bg)' }}>
      <audio ref={audioRef} src={audioUrl} preload="auto" />
      <div className="shrink-0 flex items-center gap-2 px-3 py-1.5" style={{ borderBottom: '1px solid var(--ss-line)' }}>
        <button type="button" className="ts-btn ts-btn-sm" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'} title="Play / pause (Space)">
          {playing ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <button type="button" className="ts-btn ts-btn-sm ts-btn-ghost" onClick={stop} aria-label="Stop" title="Stop">
          <Square size={13} />
        </button>
        <span className="font-mono tabular-nums" style={{ fontSize: 12, color: 'var(--ss-muted)' }}>
          {fmt(time)} / {fmt(duration)}
        </span>
      </div>
      <div className="flex-1 min-h-0">
        <AudioWaveformTimeline
          videoUrl={videoUrl || null}
          audioUrl={audioUrl}
          initialPeaks={peaks}
          hideBlockText
          events={events}
          duration={duration}
          activeEventId={activeSegmentId}
          setActiveEventId={setActiveSegmentId}
          onEventTimeChange={onSegmentTimeChange}
          onSeek={seek}
          onAddSubtitleAtTime={onAdd}
          onSplitAtTime={onSplit ? (t) => {
            const seg = (segments || []).find((x) => t > x.start_time + 0.05 && t < x.end_time - 0.05);
            if (seg) onSplit(seg.segment_id, t);
          } : null}
          onMergeWithNext={onMerge}
          onPlayEvent={playEvent}
          onUndo={onUndo}
          onRedo={onRedo}
        />
      </div>
    </div>
  );
}
