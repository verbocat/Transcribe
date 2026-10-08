import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Subtitle Studio layout model.
 *
 * A layout is a flat, serialisable object. `buildGrid()` turns it into CSS grid
 * tracks + areas for the three working panes (video, list, timeline). Because the
 * panes are always rendered in the same DOM order and only their grid areas
 * change, rearranging never remounts the video player or the waveform.
 */

const LS_STATE = 'karya_ss_layout_v1';
const LS_PRESETS = 'karya_ss_layout_presets_v1';

export const DEFAULT_LAYOUT = {
  sidebar: 'left',        // left | right | top | bottom | hidden
  sidebarLabels: true,
  videoPos: 'left',       // left | right | top | bottom | hidden
  videoW: 560,
  videoH: 340,
  timelinePos: 'bottom',  // bottom | top | hidden
  timelineH: 210,
  timelineSpan: 'full',   // full | list (only under the subtitle list when video is at a side)
  listMinW: 420,
  maximize: 'none',       // none | video | list | timeline
  qcDock: 'overlay',      // overlay | right | left | bottom
  qcSize: 460,
  showHeader: true,
  menuStyle: 'full',      // full | compact (one hamburger menu)
  showMediaPill: true,
  showSaveStatus: true,
  showFooter: true,
  showHints: true,        // shortcut hints in the status bar
  paneStyle: 'flat',      // flat | cards
  gap: 0,
  radius: 0,
  splitter: 6,
};

const ENUMS = {
  sidebar: ['left', 'right', 'top', 'bottom', 'hidden'],
  videoPos: ['left', 'right', 'top', 'bottom', 'hidden'],
  timelinePos: ['bottom', 'top', 'hidden'],
  timelineSpan: ['full', 'list'],
  maximize: ['none', 'video', 'list', 'timeline'],
  qcDock: ['overlay', 'right', 'left', 'bottom'],
  paneStyle: ['flat', 'cards'],
  menuStyle: ['full', 'compact'],
};
const BOOLS = ['sidebarLabels', 'showHeader', 'showMediaPill', 'showSaveStatus', 'showFooter', 'showHints'];

export const LIMITS = {
  videoW: [240, 1200, 4],
  videoH: [140, 720, 4],
  timelineH: [80, 640, 2],
  listMinW: [260, 900, 10],
  qcSize: [320, 760, 4],
  gap: [0, 16, 1],
  radius: [0, 24, 1],
  splitter: [2, 14, 1],
};

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
      out[key] = Number.isFinite(n) ? clamp(Math.round(n), lo, hi) : def;
    }
  }
  return out;
}

export const sameLayout = (a, b) =>
  JSON.stringify(normalizeLayout(a)) === JSON.stringify(normalizeLayout(b));

const make = (patch) => normalizeLayout({ ...DEFAULT_LAYOUT, ...patch });

/** Built-in presets. The first nine answer to Alt+1 … Alt+9. */
export const BUILTIN_PRESETS = [
  { id: 'classic', name: 'Classic', hint: 'Video left, list centre, timeline below', layout: make({}) },
  { id: 'editor', name: 'Editor', hint: 'Roomy subtitle list, small video', layout: make({ videoW: 380, timelineH: 170, listMinW: 560 }) },
  { id: 'cinema', name: 'Cinema', hint: 'Large video, narrow list', layout: make({ videoW: 840, timelineH: 180, listMinW: 360 }) },
  { id: 'stacked', name: 'Stacked', hint: 'Video on top, list beneath', layout: make({ videoPos: 'top', videoH: 340, timelineH: 190 }) },
  { id: 'timeline-pro', name: 'Timeline pro', hint: 'Tall waveform for precise timing', layout: make({ videoW: 420, timelineH: 380 }) },
  { id: 'mirrored', name: 'Mirrored', hint: 'Video and tools on the right', layout: make({ videoPos: 'right', sidebar: 'right' }) },
  { id: 'review', name: 'QC review', hint: 'QC report docked beside the list', layout: make({ videoW: 460, timelineH: 170, qcDock: 'right', qcSize: 460 }) },
  { id: 'under-list', name: 'Tall video', hint: 'Video full height, timeline under the list', layout: make({ videoW: 520, timelineSpan: 'list', timelineH: 240 }) },
  { id: 'top-timeline', name: 'Timeline on top', hint: 'Waveform above the workspace', layout: make({ timelinePos: 'top', videoW: 480 }) },
  { id: 'cards', name: 'Floating cards', hint: 'Rounded panes with breathing room', layout: make({ paneStyle: 'cards', gap: 10, radius: 14, splitter: 4, videoW: 520 }) },
  { id: 'transcript', name: 'Transcript', hint: 'List only with a slim timeline', layout: make({ videoPos: 'hidden', timelineH: 150 }) },
  { id: 'audio', name: 'Audio first', hint: 'No video, large waveform', layout: make({ videoPos: 'hidden', timelineH: 340, sidebar: 'top' }) },
  { id: 'zen', name: 'Zen', hint: 'Subtitle list only, nothing else', layout: make({ videoPos: 'hidden', timelinePos: 'hidden', sidebar: 'hidden', showFooter: false }) },
];

/* ───────────────────────── grid builder ───────────────────────── */

const FLEX = 'minmax(0, 1fr)';

/**
 * Returns { cols, rows, areas, vis, sv, st }.
 * sv / st describe the two splitters (null when absent):
 *   { key, axis: 'x' | 'y', sign: 1 | -1 } — new size = start + sign * pointer delta.
 */
export function buildGrid(L) {
  const max = L.maximize;
  const vis = {
    video: max === 'none' ? L.videoPos !== 'hidden' : max === 'video',
    list: max === 'none' ? true : max === 'list',
    timeline: max === 'none' ? L.timelinePos !== 'hidden' : max === 'timeline',
  };
  const S = Math.max(L.splitter, L.gap);
  // Fixed-size tracks may shrink on small windows instead of forcing overflow
  const px = (n) => `minmax(0, ${n}px)`;
  const gapPx = (n) => `${n}px`;

  // ── stage = video + list
  let stage;
  let sv = null;
  if (vis.video && vis.list) {
    if (L.videoPos === 'left' || L.videoPos === 'right') {
      const left = L.videoPos === 'left';
      const listTrack = `minmax(${L.listMinW}px, 1fr)`;
      stage = {
        cols: left ? [px(L.videoW), gapPx(S), listTrack] : [listTrack, gapPx(S), px(L.videoW)],
        rows: [FLEX],
        areas: [left ? ['v', 'sv', 'l'] : ['l', 'sv', 'v']],
        side: true,
      };
      sv = { key: 'videoW', axis: 'x', sign: left ? 1 : -1 };
    } else {
      const top = L.videoPos !== 'bottom';
      stage = {
        cols: [FLEX],
        rows: top ? [px(L.videoH), gapPx(S), FLEX] : [FLEX, gapPx(S), px(L.videoH)],
        areas: top ? [['v'], ['sv'], ['l']] : [['l'], ['sv'], ['v']],
        side: false,
      };
      sv = { key: 'videoH', axis: 'y', sign: top ? 1 : -1 };
    }
  } else if (vis.video) {
    stage = { cols: [FLEX], rows: [FLEX], areas: [['v']], side: false };
  } else if (vis.list) {
    stage = { cols: [FLEX], rows: [FLEX], areas: [['l']], side: false };
  } else {
    stage = null; // only the timeline is shown
  }

  if (!stage) {
    return { cols: [FLEX], rows: [FLEX], areas: [['t']], vis, sv: null, st: null };
  }
  if (!vis.timeline) {
    return { cols: stage.cols, rows: stage.rows, areas: stage.areas, vis, sv, st: null };
  }

  const tTop = L.timelinePos === 'top';
  const st = { key: 'timelineH', axis: 'y', sign: tTop ? 1 : -1 };

  // Timeline tucked under the list only (video keeps its full height)
  if (L.timelineSpan === 'list' && stage.side && sv) {
    const rows = tTop ? [px(L.timelineH), gapPx(S), FLEX] : [FLEX, gapPx(S), px(L.timelineH)];
    const [a, b, c] = stage.areas[0];
    const listCol = stage.areas[0].indexOf('l');
    const mk = (cell) => {
      const row = [a, b, c];
      row[listCol] = cell;
      return row;
    };
    const areas = tTop ? [mk('t'), mk('st'), mk('l')] : [mk('l'), mk('st'), mk('t')];
    // the video + its splitter span all three rows
    return { cols: stage.cols, rows, areas, vis, sv, st };
  }

  const n = stage.cols.length;
  const fill = (name) => Array(n).fill(name);
  return {
    cols: stage.cols,
    rows: tTop ? [px(L.timelineH), gapPx(S), ...stage.rows] : [...stage.rows, gapPx(S), px(L.timelineH)],
    areas: tTop ? [fill('t'), fill('st'), ...stage.areas] : [...stage.areas, fill('st'), fill('t')],
    vis,
    sv,
    st,
  };
}

/* ───────────────────────── persistence + hook ───────────────────────── */

const readJSON = (key) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
};

const loadState = () => {
  const saved = readJSON(LS_STATE);
  return {
    layout: normalizeLayout(saved?.layout),
    activeId: typeof saved?.activeId === 'string' ? saved.activeId : saved?.layout ? null : 'classic',
    previous: null,
  };
};

const loadCustom = () => {
  const saved = readJSON(LS_PRESETS);
  if (!Array.isArray(saved)) return [];
  return saved
    .filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string')
    .map((p) => ({ id: p.id, name: p.name.slice(0, 40), layout: normalizeLayout(p.layout) }));
};

const newId = () => `u_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function useStudioLayout() {
  const [state, setState] = useState(loadState);
  const [custom, setCustom] = useState(loadCustom);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Debounced so dragging a splitter doesn't hammer localStorage
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(LS_STATE, JSON.stringify({ layout: state.layout, activeId: state.activeId }));
      } catch (_) { /* storage unavailable */ }
    }, 250);
    return () => clearTimeout(t);
  }, [state.layout, state.activeId]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_PRESETS, JSON.stringify(custom));
    } catch (_) { /* storage unavailable */ }
  }, [custom]);

  /** Continuous tweaks (sliders, splitters). Does not snapshot for Revert. */
  const patch = useCallback((p) => {
    setState((s) => {
      const next = normalizeLayout({ ...s.layout, ...(typeof p === 'function' ? p(s.layout) : p) });
      return sameLayout(next, s.layout) ? s : { ...s, layout: next };
    });
  }, []);

  /** Discrete jumps (presets, mirror, reset). Remembers where we came from. */
  const jump = useCallback((next, activeId = null) => {
    setState((s) => ({
      layout: normalizeLayout(next),
      activeId,
      previous: { layout: s.layout, activeId: s.activeId },
    }));
  }, []);

  const allPresets = [...BUILTIN_PRESETS, ...custom];
  const findPreset = (id) => allPresets.find((p) => p.id === id);

  const applyPreset = useCallback((id) => {
    const p = [...BUILTIN_PRESETS, ...custom].find((x) => x.id === id);
    if (p) jump(p.layout, p.id);
  }, [custom, jump]);

  const applyBuiltinByIndex = useCallback((i) => {
    const p = BUILTIN_PRESETS[i];
    if (p) jump(p.layout, p.id);
  }, [jump]);

  const reset = useCallback(() => jump(DEFAULT_LAYOUT, 'classic'), [jump]);

  const revert = useCallback(() => {
    setState((s) => (s.previous ? { layout: s.previous.layout, activeId: s.previous.activeId, previous: null } : s));
  }, []);

  const mirror = useCallback((axis) => {
    const flipH = { left: 'right', right: 'left', top: 'top', bottom: 'bottom', hidden: 'hidden' };
    const flipV = { top: 'bottom', bottom: 'top', left: 'left', right: 'right', hidden: 'hidden', overlay: 'overlay' };
    const cur = stateRef.current.layout;
    if (axis === 'h') {
      jump({ ...cur, videoPos: flipH[cur.videoPos], sidebar: flipH[cur.sidebar], qcDock: flipH[cur.qcDock] || cur.qcDock });
    } else {
      jump({
        ...cur,
        timelinePos: cur.timelinePos === 'top' ? 'bottom' : cur.timelinePos === 'bottom' ? 'top' : 'hidden',
        videoPos: flipV[cur.videoPos],
        sidebar: flipV[cur.sidebar],
      });
    }
  }, [jump]);

  const savePreset = useCallback((name) => {
    const clean = String(name || '').trim().slice(0, 40);
    if (!clean) return null;
    const id = newId();
    setCustom((c) => [...c, { id, name: clean, layout: stateRef.current.layout }]);
    setState((s) => ({ ...s, activeId: id }));
    return id;
  }, []);

  /** Overwrite a custom preset with the layout currently on screen. */
  const updatePreset = useCallback((id) => {
    setCustom((c) => c.map((p) => (p.id === id ? { ...p, layout: stateRef.current.layout } : p)));
    setState((s) => ({ ...s, activeId: id }));
  }, []);

  const renamePreset = useCallback((id, name) => {
    const clean = String(name || '').trim().slice(0, 40);
    if (!clean) return;
    setCustom((c) => c.map((p) => (p.id === id ? { ...p, name: clean } : p)));
  }, []);

  const deletePreset = useCallback((id) => {
    setCustom((c) => c.filter((p) => p.id !== id));
    setState((s) => (s.activeId === id ? { ...s, activeId: null } : s));
  }, []);

  const duplicatePreset = useCallback((id) => {
    const p = [...BUILTIN_PRESETS, ...custom].find((x) => x.id === id);
    if (!p) return;
    const copy = { id: newId(), name: `${p.name} copy`.slice(0, 40), layout: p.layout };
    setCustom((c) => [...c, copy]);
  }, [custom]);

  const exportJSON = useCallback(() => JSON.stringify(
    { kind: 'karya-subtitle-layouts', version: 1, current: stateRef.current.layout, presets: custom.map(({ name, layout }) => ({ name, layout })) },
    null,
    2,
  ), [custom]);

  /** Returns the number of presets imported, or -1 when the file is not a layout file. */
  const importJSON = useCallback((text) => {
    let data;
    try { data = JSON.parse(text); } catch (_) { return -1; }
    if (!data || typeof data !== 'object') return -1;
    const incoming = Array.isArray(data.presets)
      ? data.presets
      : data.layout ? [{ name: data.name || 'Imported layout', layout: data.layout }] : [];
    const clean = incoming
      .filter((p) => p && p.layout && typeof p.layout === 'object')
      .map((p) => ({ id: newId(), name: String(p.name || 'Imported layout').slice(0, 40), layout: normalizeLayout(p.layout) }));
    if (!clean.length && !(data.current && typeof data.current === 'object')) return -1;
    if (clean.length) setCustom((c) => [...c, ...clean]);
    if (data.current && typeof data.current === 'object') jump(data.current, null);
    return clean.length;
  }, [jump]);

  const active = findPreset(state.activeId);
  const modified = Boolean(active) && !sameLayout(active.layout, state.layout);

  return {
    layout: state.layout,
    activeId: state.activeId,
    activePreset: active || null,
    modified,
    canRevert: Boolean(state.previous),
    custom,
    patch,
    applyPreset,
    applyBuiltinByIndex,
    reset,
    revert,
    mirror,
    savePreset,
    updatePreset,
    renamePreset,
    deletePreset,
    duplicatePreset,
    exportJSON,
    importJSON,
  };
}
