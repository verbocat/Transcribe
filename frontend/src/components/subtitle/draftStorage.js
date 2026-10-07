// Local draft (autosave) payload for the Subtitle Studio.
// `events` is always the track on screen, so drafts written before language tracks existed still load unchanged.

export const draftKey = (fileName) => `karya_subtitle_autosave_${fileName || 'draft_subtitle'}`;

/** Build the JSON-serialisable draft. Per-cue QC flags live on the events, so they travel with each track. */
export function buildDraft(d, now = new Date()) {
  const tracks = { ...(d.tracks || {}) };
  if (d.activeTrack) tracks[d.activeTrack] = d.events; // the track on screen is newer than its stored copy
  const hasTracks = Object.keys(tracks).length > 0;
  return {
    events: d.events,
    complianceScore: d.complianceScore,
    totalErrors: d.totalErrors,
    totalWarnings: d.totalWarnings,
    settings: { language: d.language, contentType: d.contentType, cplLimit: d.cplLimit, cpsLimit: d.cpsLimit, frameRate: d.frameRate, sdhMode: d.sdhMode },
    ...(hasTracks ? { tracks, activeTrack: d.activeTrack || null, sourceTrack: d.sourceTrack || null } : {}),
    timestamp: now.toISOString(),
  };
}

/** Normalise a stored draft (old or new shape) into what the editor needs to restore. */
export function readDraft(draft) {
  const events = Array.isArray(draft?.events) ? draft.events : [];
  const rawTracks = draft?.tracks && typeof draft.tracks === 'object' ? draft.tracks : {};
  const tracks = {};
  Object.entries(rawTracks).forEach(([code, evs]) => { if (Array.isArray(evs)) tracks[code] = evs; });
  let activeTrack = typeof draft?.activeTrack === 'string' && tracks[draft.activeTrack] ? draft.activeTrack : null;
  let sourceTrack = typeof draft?.sourceTrack === 'string' && tracks[draft.sourceTrack] ? draft.sourceTrack : null;
  if (!activeTrack) {
    // a track set without a usable active language would leave the editor unable to switch; fall back to the source-only view
    return { events, tracks: {}, activeTrack: null, sourceTrack: null };
  }
  tracks[activeTrack] = events;
  if (!sourceTrack) sourceTrack = activeTrack;
  return { events, tracks, activeTrack, sourceTrack };
}
