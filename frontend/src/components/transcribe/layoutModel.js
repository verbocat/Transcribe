import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE } from '../../config';

/**
 * Transcribe Studio layout. A flat, serialisable object, same shape of idea as Subtitle Studio's
 * (see subtitle/layout/layoutModel.js): normalise on every read, presets are plain objects.
 *
 * Persistence: localStorage is the instant copy (and the only one when signed out). When signed in
 * the layout is also stored on the account (PUT /api/auth/preferences/transcribe_layout), and the
 * account copy wins on open, so the same layout follows the user to every device.
 */

const LS_KEY = 'karya_ts_layout_v1';
const REMOTE_KEY = 'transcribe_layout';

export const DEFAULT_LAYOUT = {
  speakersPos: 'left',   // left | right | hidden
  speakersW: 296,
  timelinePos: 'bottom', // bottom | hidden
  timelineH: 0,          // px, 0 = automatic (a share of the window)
  toolRail: true,        // the left rail with Translate, QC and Export
  showVideo: true,       // the small video monitor above the speaker list
  paneStyle: 'flat',     // flat | cards
  gap: 0,
  radius: 0,
};

const ENUMS = {
  speakersPos: ['left', 'right', 'hidden'],
  timelinePos: ['bottom', 'hidden'],
  paneStyle: ['flat', 'cards'],
};
const BOOLS = ['showVideo', 'toolRail'];
export const LIMITS = {
  speakersW: [220, 480, 4],
  timelineH: [0, 720, 2],
  gap: [0, 16, 1],
  radius: [0, 24, 1],
};
export const TIMELINE_MIN = 160;

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export function normalizeLayout(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const key of Object.keys(DEFAULT_LAYOUT)) {
    const def = DEFAULT_LAYOUT[key];
    const v = src[key];
    if (ENUMS[key]) out[key] = ENUMS[key].includes(v) ? v : def;
    else if (BOOLS.includes(key)) out[key] = typeof v === 'boolean' ? v : def;
    else {
      const [lo, hi] = LIMITS[key];
      const n = Number(v);
      let val = Number.isFinite(n) && v !== null && v !== '' ? clamp(Math.round(n), lo, hi) : def;
      if (key === 'timelineH' && val > 0 && val < TIMELINE_MIN) val = TIMELINE_MIN;
      out[key] = val;
    }
  }
  return out;
}

export const sameLayout = (a, b) => JSON.stringify(normalizeLayout(a)) === JSON.stringify(normalizeLayout(b));

const make = (patch) => normalizeLayout({ ...DEFAULT_LAYOUT, ...patch });

export const PRESETS = [
  { id: 'default', name: 'Default', hint: 'Speakers on the left, timeline below', layout: make({}) },
  { id: 'editing', name: 'Editing focus', hint: 'Wide transcript, slim speaker list', layout: make({ speakersW: 232, showVideo: false, timelineH: 220 }) },
  { id: 'timeline', name: 'Timeline focus', hint: 'More room for waveform and speaker rows', layout: make({ timelineH: 440 }) },
  { id: 'review', name: 'Review', hint: 'Video monitor and a roomy speaker list', layout: make({ speakersW: 380, timelineH: 240 }) },
  { id: 'mirrored', name: 'Speakers right', hint: 'Speaker list on the right', layout: make({ speakersPos: 'right' }) },
  { id: 'wide', name: 'Wide transcript', hint: 'Speaker list hidden, full-width lines', layout: make({ speakersPos: 'hidden' }) },
  { id: 'cards', name: 'Floating cards', hint: 'Rounded panes with breathing room', layout: make({ paneStyle: 'cards', gap: 10, radius: 14 }) },
  { id: 'focus', name: 'Transcript only', hint: 'Just the transcript', layout: make({ speakersPos: 'hidden', timelinePos: 'hidden' }) },
];

const readLocal = () => {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
};

const authHeader = () => {
  try {
    const t = localStorage.getItem('verbolabs_auth_token');
    return t ? { Authorization: `Bearer ${t}` } : null;
  } catch (_) {
    return null;
  }
};

/** `signedIn` is only used to (re)load the account copy when the person logs in. */
export function useTranscribeLayout(signedIn) {
  const [layout, setLayout] = useState(() => normalizeLayout(readLocal()));
  const [sync, setSync] = useState('local'); // local | loading | saved | saving | error
  const dirty = useRef(false);               // a change the account copy has not seen yet
  const loaded = useRef(false);              // the account copy has been fetched
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  // Open: take the account copy if there is one, otherwise upload what this browser has
  useEffect(() => {
    loaded.current = false;
    const headers = signedIn ? authHeader() : null;
    if (!headers) { setSync('local'); return undefined; }
    let cancelled = false;
    setSync('loading');
    fetch(`${API_BASE}/api/auth/preferences/${REMOTE_KEY}`, { headers })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => {
        if (cancelled) return;
        loaded.current = true;
        if (data?.value && !dirty.current) {
          setLayout(normalizeLayout(data.value));
          setSync('saved');
        } else {
          dirty.current = true; // nothing on the account yet (or edited meanwhile): push this browser's copy
          setLayout((l) => ({ ...l }));
        }
      })
      .catch(() => { if (!cancelled) { loaded.current = true; setSync('error'); } });
    return () => { cancelled = true; };
  }, [signedIn]);

  // Save (debounced so dragging a splitter doesn't hammer the server)
  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(layout)); } catch (_) { /* storage unavailable */ }
    if (!dirty.current || !loaded.current) return undefined;
    const headers = authHeader();
    if (!headers) return undefined;
    setSync('saving');
    const t = setTimeout(() => {
      fetch(`${API_BASE}/api/auth/preferences/${REMOTE_KEY}`, {
        method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ value: layoutRef.current }),
      })
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); dirty.current = false; setSync('saved'); })
        .catch(() => setSync('error'));
    }, 600);
    return () => clearTimeout(t);
  }, [layout]);

  const patch = useCallback((p) => {
    setLayout((l) => {
      const next = normalizeLayout({ ...l, ...(typeof p === 'function' ? p(l) : p) });
      if (sameLayout(next, l)) return l;
      dirty.current = true;
      return next;
    });
  }, []);
  const apply = useCallback((next) => { dirty.current = true; setLayout(normalizeLayout(next)); }, []);
  const reset = useCallback(() => apply(DEFAULT_LAYOUT), [apply]);

  const activePreset = PRESETS.find((p) => sameLayout(p.layout, layout)) || null;
  return { layout, patch, apply, reset, sync, activePreset };
}
