const STORAGE_KEY = 'karya_speaker_names';
const MAX_NAMES = 200;

const isGeneric = (name) => /^speaker \d+$/i.test((name || '').trim());

export function loadSpeakerNames() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((n) => typeof n === 'string' && n.trim()) : [];
  } catch {
    return [];
  }
}

// Most recently used first; "Speaker 3" style placeholders are never remembered
export function rememberSpeakerName(name) {
  const clean = (name || '').trim();
  if (!clean || isGeneric(clean)) return;
  const next = [clean, ...loadSpeakerNames().filter((n) => n.toLowerCase() !== clean.toLowerCase())].slice(0, MAX_NAMES);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
}

// Names to offer: ones already on this transcript, the cast list, then everything used before in other projects.
export function nameSuggestions(prefix, { current = [], cast = [], exclude = [] } = {}) {
  const q = (prefix || '').trim().toLowerCase();
  const skip = new Set(exclude.map((n) => n.toLowerCase()));
  const seen = new Set();
  const out = [];
  [...current, ...cast.map((c) => c.name), ...loadSpeakerNames()].forEach((n) => {
    const key = (n || '').toLowerCase();
    if (!n || isGeneric(n) || seen.has(key) || skip.has(key)) return;
    seen.add(key);
    if (!q || key.startsWith(q)) out.push(n);
  });
  return out.slice(0, 6);
}
