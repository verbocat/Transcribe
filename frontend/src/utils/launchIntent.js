// Hand-off from the Home screen to a studio: a dropped file or a saved project to open on arrival.
// Kept in memory only; a studio takes it once when it mounts.
let pending = null;

export function setLaunchIntent(tool, payload) {
  pending = { tool, ...payload };
}

export function takeLaunchIntent(tool) {
  if (!pending || pending.tool !== tool) return null;
  const intent = pending;
  pending = null;
  return intent;
}
