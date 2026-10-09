// Versioned drafts for Transcribe Studio.
//
// A draft is split by size and by who needs it first:
//   - localStorage  `karya_autosave_<file>`  the lean, synchronous part: transcript, scores, languages (see localDrafts.js)
//   - IndexedDB     `studio`                 translated tracks, Centroid QC results + applied-fix state, timeline peaks
//   - IndexedDB     `media`                  the audio (and, within a size limit, the video) so the timeline comes back
//                                            without uploading the file again
// Cloud projects keep the same `studio` document (minus the media blobs) in the server's project store.
//
// DRAFT_VERSION 1 = the original draft (segments and scores only, translations in `transcribe_tracks_<file>`).
// DRAFT_VERSION 2 = adds the studio document and media. Older drafts still load; they just have less to restore.

export const DRAFT_VERSION = 2;
export const STUDIO_VERSION = 1;

// Limits so one long video cannot fill the browser's storage
export const MAX_AUDIO_BYTES = 400 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 600 * 1024 * 1024;
const PEAKS_STORED_PPS = 50;        // the timeline decodes 50 peaks per second
const PEAKS_SERVER_PPS = 10;        // cloud copy is coarser to stay small

const DB_NAME = 'lowerthird-transcribe';
const STUDIO_LS_PREFIX = 'karya_studio_';

let dbPromise = null;
function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('media')) db.createObjectStore('media', { keyPath: 'name' });
      if (!db.objectStoreNames.contains('studio')) db.createObjectStore('studio', { keyPath: 'name' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch((e) => { dbPromise = null; throw e; });
  return dbPromise;
}

async function idbGet(store, name) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const r = db.transaction(store, 'readonly').objectStore(store).get(name);
    r.onsuccess = () => resolve(r.result || null);
    r.onerror = () => reject(r.error);
  });
}
async function idbPut(store, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
async function idbDelete(store, name) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(name);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

const jsonSize = (v) => { try { return JSON.stringify(v).length; } catch { return Infinity; } };

// ---- studio document -----------------------------------------------------------------------------------------

/** Wraps what the studio reports (tracks, QC, ...) plus timeline data into a versioned document. */
export function buildStudioDoc({ studio, peaks, peaksPps, duration }) {
  return {
    version: STUDIO_VERSION,
    tracks: studio?.tracks || {},
    activeTrack: studio?.activeTrack || null,
    listView: studio?.listView || 'side',
    qcView: studio?.qcView || 'karya',
    exportChoice: studio?.exportChoice || null,
    centroid: studio?.centroid || null,
    peaks: peaks || [],
    peaksPps: peaksPps || PEAKS_STORED_PPS,
    duration: duration || 0,
  };
}

export function hasStudioContent(doc) {
  return Boolean(doc && (Object.keys(doc.tracks || {}).length || doc.centroid?.qc || (doc.peaks || []).length));
}

/** Peaks resampled (max of each bucket) from one rate to another, 2 decimals */
export function resamplePeaks(peaks, fromPps, toPps) {
  if (!peaks?.length || fromPps <= toPps) return (peaks || []).map((v) => Math.round(v * 100) / 100);
  const k = fromPps / toPps;
  const out = [];
  for (let i = 0; i < peaks.length; i += k) {
    let m = 0;
    const end = Math.min(peaks.length, Math.ceil(i + k));
    for (let j = Math.floor(i); j < end; j += 1) if (peaks[j] > m) m = peaks[j];
    out.push(Math.round(m * 100) / 100);
  }
  return out;
}

/** The studio document as stored on the server: same data, coarser peaks. */
export function studioDocForServer(doc) {
  if (!doc) return null;
  return { ...doc, peaks: resamplePeaks(doc.peaks, doc.peaksPps || PEAKS_STORED_PPS, PEAKS_SERVER_PPS), peaksPps: PEAKS_SERVER_PPS };
}

/** Accepts a studio document from any older shape and returns the current one (or null). */
export function normalizeStudioDoc(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const tracks = raw.tracks && typeof raw.tracks === 'object' ? raw.tracks : {};
  return {
    version: STUDIO_VERSION,
    tracks,
    activeTrack: raw.activeTrack && tracks[raw.activeTrack] ? raw.activeTrack : (raw.active && tracks[raw.active] ? raw.active : null),
    listView: raw.listView === 'only' ? 'only' : 'side',
    qcView: raw.qcView === 'centroid' ? 'centroid' : 'karya',
    exportChoice: raw.exportChoice || null,
    centroid: raw.centroid && typeof raw.centroid === 'object' ? raw.centroid : null,
    peaks: Array.isArray(raw.peaks) ? raw.peaks : [],
    peaksPps: raw.peaksPps || PEAKS_STORED_PPS,
    duration: Number(raw.duration) || 0,
  };
}

export async function saveStudioDoc(name, doc) {
  if (!name || !doc) return;
  try {
    await idbPut('studio', { name, data: doc, savedAt: Date.now() });
    try { localStorage.removeItem(STUDIO_LS_PREFIX + name); } catch { /* ignore */ }
    return;
  } catch { /* fall through to localStorage */ }
  try {
    // Small studios only: peaks are the bulk and the timeline can live without them
    const lean = jsonSize(doc) > 2_000_000 ? { ...doc, peaks: [] } : doc;
    localStorage.setItem(STUDIO_LS_PREFIX + name, JSON.stringify(lean));
  } catch { /* storage full or unavailable */ }
}

/** The saved studio document for a file, from IndexedDB, then localStorage, then the pre-version-2 track store. */
export async function loadStudioDoc(name) {
  if (!name) return null;
  try {
    const rec = await idbGet('studio', name);
    if (rec?.data) return normalizeStudioDoc(rec.data);
  } catch { /* try the next source */ }
  try {
    const raw = localStorage.getItem(STUDIO_LS_PREFIX + name);
    if (raw) return normalizeStudioDoc(JSON.parse(raw));
  } catch { /* none */ }
  try {
    // Drafts from before version 2 kept only the translated tracks, per file name
    const legacy = JSON.parse(localStorage.getItem(`transcribe_tracks_${name}`) || 'null');
    if (legacy?.tracks && Object.keys(legacy.tracks).length) return normalizeStudioDoc({ tracks: legacy.tracks, activeTrack: legacy.active });
  } catch { /* none */ }
  return null;
}

// ---- media ---------------------------------------------------------------------------------------------------

/**
 * Keeps the media in this browser so the timeline can be rebuilt without uploading again.
 * `audio` is the small extracted track (or the audio file itself); `video` is the original and only kept under the size limit.
 * Resolves to { audio: bool, video: bool } describing what was kept.
 */
export async function saveMedia(name, { audio, video }) {
  const kept = { audio: false, video: false };
  if (!name || (!audio && !video)) return kept;
  const keepAudio = audio && audio.size <= MAX_AUDIO_BYTES ? audio : null;
  const keepVideo = video && video.size <= MAX_VIDEO_BYTES ? video : null;
  if (!keepAudio && !keepVideo) return kept;
  try {
    await idbPut('media', {
      name, savedAt: Date.now(),
      audio: keepAudio, audioName: keepAudio?.name || '', audioType: keepAudio?.type || '',
      video: keepVideo, videoName: keepVideo?.name || '', videoType: keepVideo?.type || '',
    });
    try { navigator.storage?.persist?.(); } catch { /* ignore */ }
    return { audio: Boolean(keepAudio), video: Boolean(keepVideo) };
  } catch (e) {
    console.warn('Could not keep the media for restore (storage full?)', e);
    return kept;
  }
}

/** { audio: Blob|null, video: Blob|null, ... } or null when this browser has no copy */
export async function loadMedia(name) {
  if (!name) return null;
  try {
    const rec = await idbGet('media', name);
    if (!rec || (!rec.audio && !rec.video)) return null;
    return rec;
  } catch { return null; }
}

export async function removeDraftExtras(name) {
  if (!name) return;
  await Promise.allSettled([idbDelete('studio', name), idbDelete('media', name)]);
  try { localStorage.removeItem(STUDIO_LS_PREFIX + name); } catch { /* ignore */ }
}

// ---- the lean draft ------------------------------------------------------------------------------------------

export function buildDraft({ segments, complianceScore, totalErrors, totalWarnings, filename, detectedLanguage, script, hasMedia, hasVideo, duration }) {
  return {
    version: DRAFT_VERSION,
    timestamp: new Date().toISOString(),
    filename: filename || '',
    segments,
    complianceScore,
    totalErrors,
    totalWarnings,
    detectedLanguage: detectedLanguage || '',
    script: script || '',
    media: { stored: Boolean(hasMedia), video: Boolean(hasVideo), duration: duration || 0 },
  };
}

/** Any draft (version 1 had no version field) in the current shape. */
export function normalizeDraft(raw) {
  if (!raw || !Array.isArray(raw.segments)) return null;
  return {
    version: Number(raw.version) || 1,
    timestamp: raw.timestamp || null,
    filename: raw.filename || '',
    segments: raw.segments,
    complianceScore: raw.complianceScore,
    totalErrors: raw.totalErrors || 0,
    totalWarnings: raw.totalWarnings || 0,
    detectedLanguage: raw.detectedLanguage || '',
    script: raw.script || '',
    media: { stored: Boolean(raw.media?.stored), video: Boolean(raw.media?.video), duration: Number(raw.media?.duration) || 0 },
  };
}
