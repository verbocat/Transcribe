import { useCallback, useEffect, useState } from 'react';

/** Editor preferences that are not QC rules (those live in SubtitleApp) and not layout. */
const KEY = 'karya_ss_prefs_v1';

export const DEFAULT_PREFS = {
  autosaveSec: 60,        // 0 = off
  seekStep: 2,            // seconds for the arrow-key seek
  tcFormat: 'time',       // time (mm:ss.mmm) | frames (hh:mm:ss:ff)
  confirmGenerate: true,  // ask before replacing subtitles with a fresh generation
  newSubDuration: 2.4,    // seconds for a newly added subtitle
  newSubText: 'New dialogue subtitle line',
  localExtraction: 'always', // always | never: pull the audio out in the browser so only the audio is uploaded, never the video
};

export const AUTOSAVE_CHOICES = [0, 30, 60, 120, 300];

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export function normalizePrefs(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const num = (v, def, lo, hi) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? clamp(Number(v), lo, hi) : def);
  return {
    autosaveSec: AUTOSAVE_CHOICES.includes(Number(s.autosaveSec)) ? Number(s.autosaveSec) : DEFAULT_PREFS.autosaveSec,
    seekStep: num(s.seekStep, DEFAULT_PREFS.seekStep, 0.5, 30),
    tcFormat: s.tcFormat === 'frames' ? 'frames' : 'time',
    confirmGenerate: typeof s.confirmGenerate === 'boolean' ? s.confirmGenerate : DEFAULT_PREFS.confirmGenerate,
    newSubDuration: num(s.newSubDuration, DEFAULT_PREFS.newSubDuration, 0.5, 10),
    newSubText: typeof s.newSubText === 'string' ? s.newSubText.slice(0, 120) : DEFAULT_PREFS.newSubText,
    // 'large' was the old default (videos of 100 MB+ only); it now means the new default, 'always'
    localExtraction: s.localExtraction === 'never' ? 'never' : 'always',
  };
}

/** Read the saved preferences outside React (e.g. inside a callback). */
export function loadPrefs() {
  try {
    return normalizePrefs(JSON.parse(localStorage.getItem(KEY) || 'null'));
  } catch (_) {
    return { ...DEFAULT_PREFS };
  }
}

export function useStudioPrefs() {
  const [prefs, setPrefs] = useState(() => {
    try {
      return normalizePrefs(JSON.parse(localStorage.getItem(KEY) || 'null'));
    } catch (_) {
      return { ...DEFAULT_PREFS };
    }
  });

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (_) { /* storage unavailable */ }
  }, [prefs]);

  const setPref = useCallback((key, value) => setPrefs((p) => normalizePrefs({ ...p, [key]: value })), []);
  const resetPrefs = useCallback(() => setPrefs({ ...DEFAULT_PREFS }), []);
  return { prefs, setPref, resetPrefs };
}

/** Timecode for the status bar. */
export function formatTimecode(seconds, format, fps) {
  const t = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  if (format === 'frames') {
    const rate = Math.max(1, Math.round(fps || 24));
    const total = Math.floor(t * rate + 1e-6);
    const ff = total % rate;
    const secs = Math.floor(total / rate);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(Math.floor(secs / 3600))}:${p(Math.floor((secs % 3600) / 60))}:${p(secs % 60)}:${p(ff)}`;
  }
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const ms = Math.floor((t % 1) * 1000);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}
