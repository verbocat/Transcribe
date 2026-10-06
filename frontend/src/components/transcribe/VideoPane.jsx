import React, { useEffect, useRef } from 'react';

/**
 * Silent video that follows the waveform player (the waveform owns the audio).
 * `bus` is a plain subscription object, so playhead updates (every frame) re-render only this
 * video and never the transcript.
 */
export function createMediaBus() {
  const listeners = new Set();
  const bus = {
    time: 0,
    playing: false,
    emit(next) { Object.assign(bus, next); listeners.forEach((fn) => fn(bus)); },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
  return bus;
}

export default function VideoPane({ src, bus }) {
  const ref = useRef(null);

  useEffect(() => {
    const v = ref.current;
    if (!v || !bus) return undefined;
    const sync = (state) => {
      if (state.playing && v.paused) v.play().catch(() => {});
      if (!state.playing && !v.paused) v.pause();
      // Correct only real drift or a seek; constant nudging would stutter the picture
      if (Math.abs(v.currentTime - state.time) > (state.playing ? 0.4 : 0.05)) v.currentTime = state.time;
    };
    sync(bus);
    return bus.subscribe(sync);
  }, [bus, src]);

  return (
    <video
      ref={ref}
      src={src}
      muted
      playsInline
      preload="auto"
      aria-label="Video preview"
      style={{ width: '100%', display: 'block', background: '#000', borderRadius: 10, aspectRatio: '16 / 9', objectFit: 'contain' }}
    />
  );
}
