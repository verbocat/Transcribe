/**
 * Karya appearance engine.
 *
 * A theme is a small JSON object. `applyTheme` turns it into CSS variables on <html>:
 *   --kt-*            colours, fonts and shape used by index.css, studio.css and transcribe.css
 *   --color-<family>  Tailwind's own palettes (blue/indigo/slate/status), so utility classes follow too
 *   --radius-*, --spacing   Tailwind radius and spacing scales (corner roundness and density)
 * Persistence is localStorage; everything is guarded so a blocked store never breaks the app.
 */

const STORAGE_KEY = 'karya_theme_v1';
const EVENT = 'karya-theme-change';

// ------------------------------------------------------------------ colour maths
const HEX = /^#[0-9a-f]{6}$/i;
export const isHex = (v) => typeof v === 'string' && HEX.test(v.trim());

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
export function rgbToHex([r, g, b]) {
  const c = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}
/** t=0 -> a, t=1 -> b (sRGB) */
export function mix(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex(A.map((v, i) => v + (B[i] - v) * t));
}
export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
/** Dark or light text for a filled accent button, whichever reads better */
export function bestInk(accent) {
  const dark = mix(accent, '#000000', 0.9);
  return contrast(dark, accent) >= contrast('#ffffff', accent) ? dark : '#ffffff';
}
export function withAlpha(hex, alpha) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
/** A Tailwind-style 50..950 ramp around a base colour (base sits at 500) */
function ramp(base) {
  return {
    50: mix(base, '#ffffff', 0.92), 100: mix(base, '#ffffff', 0.84), 200: mix(base, '#ffffff', 0.7),
    300: mix(base, '#ffffff', 0.52), 400: mix(base, '#ffffff', 0.28), 500: base,
    600: mix(base, '#000000', 0.12), 700: mix(base, '#000000', 0.26), 800: mix(base, '#000000', 0.4),
    900: mix(base, '#000000', 0.55), 950: mix(base, '#000000', 0.7),
  };
}

// ------------------------------------------------------------------ fonts
const SCRIPT_FALLBACK = "'Noto Sans Devanagari', 'Noto Sans Bengali', 'Noto Sans Tamil', 'Noto Sans Telugu', 'Noto Sans Gujarati', 'Noto Sans Kannada'";
export const FONT_CHOICES = {
  ui: ['IBM Plex Sans', 'Inter', 'Source Sans 3', 'Noto Sans', 'Mukta', 'System UI'],
  script: ['Noto Sans', 'Mukta', 'Noto Serif Devanagari', 'Source Sans 3', 'IBM Plex Sans', 'Inter', 'System UI'],
  mono: ['IBM Plex Mono', 'JetBrains Mono', 'Fira Code', 'System Mono'],
};
function stack(kind, name) {
  if (name === 'System UI') return `${kind === 'script' ? "'Noto Sans', " : ''}${SCRIPT_FALLBACK}, system-ui, -apple-system, 'Segoe UI', sans-serif`;
  if (name === 'System Mono') return "ui-monospace, 'Cascadia Mono', Consolas, monospace";
  if (kind === 'mono') return `'${name}', ui-monospace, Consolas, monospace`;
  return `'${name}', ${SCRIPT_FALLBACK}, system-ui, sans-serif`;
}

// ------------------------------------------------------------------ defaults and presets
export const COLOR_KEYS = [
  'accent', 'accent2', 'bg', 'panel', 'raised', 'hover', 'border', 'borderStrong',
  'text', 'muted', 'faint', 'success', 'warn', 'danger',
];

export const DEFAULT_THEME = {
  name: 'Azure',
  colors: {
    accent: '#4d8dff', accent2: '#7a70ff',
    bg: '#0b0d12', panel: '#10131a', raised: '#171b25', hover: '#1e2330', border: '#252b3a', borderStrong: '#323a4f',
    text: '#e8ebf2', muted: '#a3abbc', faint: '#7d8699',
    success: '#10b981', warn: '#f5b84a', danger: '#ff6b81',
  },
  inkMode: 'auto',
  ink: '#06122f',
  fonts: { ui: 'IBM Plex Sans', script: 'Noto Sans', mono: 'IBM Plex Mono' },
  textScale: 100,
  transcriptSize: 15,
  radius: 100,
  density: 100,
  motion: true,
  speakers: ['#4d8dff', '#34d3a0', '#ff9f5a', '#c58bff', '#ff6b9d', '#f5d547', '#38c6f4', '#9be15d', '#ff7a7a', '#b6a2ff'],
};

const surfaces = (bg, panel, raised, hover, border, borderStrong) => ({ bg, panel, raised, hover, border, borderStrong });

export const PRESETS = [
  { id: 'azure', name: 'Azure', note: 'Default. Clean and professional.', theme: {} },
  { id: 'midnight', name: 'Midnight', note: 'Deeper navy, brighter blue.',
    theme: { colors: { accent: '#5aa2ff', accent2: '#8b7bff', ...surfaces('#060913', '#0a0f1d', '#101728', '#172036', '#1b2640', '#28365a') } } },
  { id: 'indigo', name: 'Indigo', note: 'Soft violet-blue.',
    theme: { colors: { accent: '#7c85ff', accent2: '#b07cff', ...surfaces('#0b0c14', '#11121c', '#181a27', '#212437', '#272a3e', '#353a55') } } },
  { id: 'violet', name: 'Violet', note: 'Plum surfaces, lavender accent.',
    theme: { colors: { accent: '#a78bfa', accent2: '#f472b6', ...surfaces('#0e0b14', '#14101c', '#1c1726', '#261f33', '#2d2640', '#3d3458') } } },
  { id: 'emerald', name: 'Emerald', note: 'Deep green-grey with a mint accent.',
    theme: { colors: { accent: '#2fbf8f', accent2: '#3b82f6', ...surfaces('#0a0f0e', '#0f1514', '#151d1c', '#1d2827', '#243230', '#31443f') } } },
  { id: 'classic', name: 'Classic teal', note: 'The original Karya look.',
    theme: { colors: { accent: '#00e5be', accent2: '#00b4d8', ...surfaces('#0b0d12', '#10131a', '#171b25', '#1e2330', '#252b3a', '#323a4f') } } },
  { id: 'rose', name: 'Rose', note: 'Warm dark with a coral accent.',
    theme: { colors: { accent: '#fb7185', accent2: '#f59e0b', ...surfaces('#0f0b0c', '#161012', '#1e1618', '#292024', '#30262a', '#44363b') } } },
  { id: 'amber', name: 'Amber', note: 'Gold on charcoal, broadcast feel.',
    theme: { colors: { accent: '#e3b341', accent2: '#f97316', ...surfaces('#0d0d0f', '#141416', '#1b1b1e', '#242428', '#2b2b30', '#3a3a41') } } },
  { id: 'graphite', name: 'Graphite', note: 'Neutral grey, understated steel blue.',
    theme: { colors: { accent: '#86a8d8', accent2: '#a3bfe6', ...surfaces('#0c0e12', '#12151b', '#191d25', '#222731', '#262c37', '#353d4c') } } },
  { id: 'contrast', name: 'High contrast', note: 'Maximum legibility.',
    theme: { colors: { accent: '#ffd60a', accent2: '#ff9f0a', ...surfaces('#000000', '#0a0a0a', '#121212', '#1c1c1c', '#6b6b6b', '#9a9a9a'),
      text: '#ffffff', muted: '#d0d0d0', faint: '#a8a8a8', success: '#3ddc84', warn: '#ffb020', danger: '#ff5c5c' } } },
];

export function themeFromPreset(id) {
  const p = PRESETS.find((x) => x.id === id) || PRESETS[0];
  return normalizeTheme({ ...clone(DEFAULT_THEME), ...p.theme, colors: { ...DEFAULT_THEME.colors, ...(p.theme.colors || {}) }, name: p.name });
}

// ------------------------------------------------------------------ validation
const clone = (o) => JSON.parse(JSON.stringify(o));
const clamp = (v, lo, hi, fallback) => (Number.isFinite(+v) ? Math.max(lo, Math.min(hi, +v)) : fallback);
const safeFont = (v, list, fallback) => (typeof v === 'string' && list.includes(v) ? v : fallback);

export function normalizeTheme(input) {
  const t = input && typeof input === 'object' ? input : {};
  const d = DEFAULT_THEME;
  const colors = {};
  COLOR_KEYS.forEach((k) => {
    const v = t.colors && typeof t.colors[k] === 'string' ? t.colors[k].trim().toLowerCase() : '';
    colors[k] = isHex(v) ? v : d.colors[k];
  });
  const speakers = Array.isArray(t.speakers) ? t.speakers.filter(isHex).slice(0, 10) : [];
  while (speakers.length < 10) speakers.push(d.speakers[speakers.length]);
  return {
    name: typeof t.name === 'string' ? t.name.slice(0, 40) : 'Custom',
    colors,
    inkMode: t.inkMode === 'custom' ? 'custom' : 'auto',
    ink: isHex(t.ink) ? t.ink.toLowerCase() : d.ink,
    fonts: {
      ui: safeFont(t.fonts?.ui, FONT_CHOICES.ui, d.fonts.ui),
      script: safeFont(t.fonts?.script, FONT_CHOICES.script, d.fonts.script),
      mono: safeFont(t.fonts?.mono, FONT_CHOICES.mono, d.fonts.mono),
    },
    textScale: clamp(t.textScale, 85, 130, d.textScale),
    transcriptSize: clamp(t.transcriptSize, 12, 24, d.transcriptSize),
    radius: clamp(t.radius, 0, 220, d.radius),
    density: clamp(t.density, 80, 130, d.density),
    motion: t.motion !== false,
    speakers,
  };
}

// ------------------------------------------------------------------ resolve + apply
export function resolveTheme(raw) {
  const t = normalizeTheme(raw);
  const c = t.colors;
  const accentInk = t.inkMode === 'custom' ? t.ink : bestInk(c.accent);
  const [ar, ag, ab] = hexToRgb(c.accent);
  const vars = {
    '--kt-s0': c.bg, '--kt-s1': c.panel, '--kt-s2': c.raised, '--kt-s3': c.hover, '--kt-s4': c.border, '--kt-s5': c.borderStrong,
    '--kt-text': c.text, '--kt-muted': c.muted, '--kt-faint': c.faint,
    '--kt-accent': c.accent, '--kt-accent-rgb': `${ar}, ${ag}, ${ab}`,
    '--kt-accent-strong': mix(c.accent, '#000000', 0.14), '--kt-accent-soft': mix(c.accent, '#ffffff', 0.22),
    '--kt-accent-2': c.accent2, '--kt-info': mix(c.accent, '#ffffff', 0.4), '--kt-accent-ink': accentInk,
    '--kt-selected': mix(c.bg, c.accent, 0.14),
    '--kt-success': c.success, '--kt-warn': c.warn, '--kt-danger': c.danger,
    '--kt-font-ui': stack('ui', t.fonts.ui), '--kt-font-script': stack('script', t.fonts.script), '--kt-font-mono': stack('mono', t.fonts.mono),
    '--kt-scale': String(t.textScale / 100), '--kt-transcript-size': `${t.transcriptSize}px`,
    '--kt-density': String(t.density / 100),
  };
  const f = t.radius / 100;
  [['r1', 6], ['r2', 8], ['r3', 12], ['r4', 16]].forEach(([k, px]) => { vars[`--kt-${k}`] = `${(px * f).toFixed(2)}px`; });
  // Tailwind radius + spacing scales follow the same controls
  [['xs', 0.125], ['sm', 0.25], ['md', 0.375], ['lg', 0.5], ['xl', 0.75], ['2xl', 1], ['3xl', 1.5], ['4xl', 2]]
    .forEach(([k, rem]) => { vars[`--radius-${k}`] = `${(rem * f).toFixed(3)}rem`; });
  vars['--spacing'] = `${(0.25 * (t.density / 100)).toFixed(4)}rem`;
  vars['--font-sans'] = vars['--kt-font-ui'];
  vars['--font-mono'] = vars['--kt-font-mono'];

  // Tailwind colour families that the app uses as its accent
  const put = (family, base) => Object.entries(ramp(base)).forEach(([shade, hex]) => { vars[`--color-${family}-${shade}`] = hex; });
  put('blue', c.accent);
  put('indigo', c.accent2);
  // status families and text/surface slates only when the user moved them off the defaults
  const dc = DEFAULT_THEME.colors;
  if (c.success !== dc.success) { put('emerald', c.success); put('green', c.success); }
  if (c.warn !== dc.warn) { put('amber', c.warn); put('yellow', c.warn); }
  if (c.danger !== dc.danger) { put('rose', c.danger); put('red', c.danger); }
  if (['text', 'muted', 'faint'].some((k) => c[k] !== dc[k])) {
    vars['--color-slate-100'] = c.text; vars['--color-slate-200'] = c.text;
    vars['--color-slate-300'] = mix(c.text, c.muted, 0.5); vars['--color-slate-400'] = c.muted;
    vars['--color-slate-500'] = mix(c.muted, c.faint, 0.5); vars['--color-slate-600'] = c.faint;
  }
  if (['bg', 'panel', 'raised', 'hover', 'border'].some((k) => c[k] !== dc[k])) {
    vars['--color-slate-950'] = c.bg; vars['--color-slate-900'] = c.panel; vars['--color-slate-800'] = c.raised;
    vars['--color-slate-700'] = c.border;
  }
  return { theme: t, vars, hex: { ...c, accentInk, accentSoft: vars['--kt-accent-soft'], info: vars['--kt-info'] } };
}

let current = clone(DEFAULT_THEME);
let resolved = resolveTheme(current);
let appliedKeys = [];
const listeners = new Set();

export function applyTheme(raw, { persist = true } = {}) {
  resolved = resolveTheme(raw);
  current = resolved.theme;
  const root = document.documentElement;
  appliedKeys.forEach((k) => root.style.removeProperty(k));
  appliedKeys = Object.keys(resolved.vars);
  appliedKeys.forEach((k) => root.style.setProperty(k, resolved.vars[k]));
  root.style.fontSize = `${current.textScale}%`;
  root.classList.toggle('kt-reduce-motion', !current.motion);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', current.colors.bg);
  if (persist) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(current)); } catch { /* storage unavailable */ }
  }
  listeners.forEach((fn) => fn(current));
  window.dispatchEvent(new CustomEvent(EVENT, { detail: current }));
  return current;
}

export function loadTheme() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeTheme(JSON.parse(raw)) : clone(DEFAULT_THEME);
  } catch {
    return clone(DEFAULT_THEME);
  }
}

export function resetTheme() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  return applyTheme(clone(DEFAULT_THEME), { persist: false });
}

export function initTheme() {
  applyTheme(loadTheme(), { persist: false });
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) applyTheme(loadTheme(), { persist: false });
  });
}

// ------------------------------------------------------------------ read access for non-CSS consumers (canvas, JS)
export const getTheme = () => current;
export const getResolved = () => resolved;
/** Current colour by token, for canvas drawing: themeColor('accent') */
export function themeColor(key) {
  if (key === 'accentInk') return resolved.hex.accentInk;
  if (key === 'accentSoft') return resolved.hex.accentSoft;
  if (key === 'info') return resolved.hex.info;
  return resolved.hex[key] || DEFAULT_THEME.colors[key];
}
export const getSpeakerPalette = () => current.speakers;
export function subscribeTheme(fn) { listeners.add(fn); return () => listeners.delete(fn); }

// ------------------------------------------------------------------ import / export
export function exportThemeJson() {
  return JSON.stringify({ karyaTheme: 1, ...current }, null, 2);
}
export function importThemeJson(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('That file is not valid JSON.'); }
  if (!data || typeof data !== 'object' || !data.colors) throw new Error('This does not look like a Karya theme file.');
  return normalizeTheme(data);
}

// ------------------------------------------------------------------ open the dashboard from anywhere
export const OPEN_EVENT = 'karya-open-appearance';
export function openAppearance() { window.dispatchEvent(new Event(OPEN_EVENT)); }
