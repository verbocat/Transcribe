// Lightweight playhead time bus: the video player publishes the exact media time every frame,
// and UI that must move smoothly (timeline needle) subscribes and updates the DOM directly,
// without re-rendering React trees on every frame.

let currentTime = 0;
const listeners = new Set();

export function publishPlayhead(t) {
  if (typeof t !== 'number' || Number.isNaN(t)) return;
  currentTime = t;
  listeners.forEach(fn => fn(t));
}

export function getPlayhead() {
  return currentTime;
}

export function subscribePlayhead(fn) {
  listeners.add(fn);
  fn(currentTime);
  return () => listeners.delete(fn);
}
