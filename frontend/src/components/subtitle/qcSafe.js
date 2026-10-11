/**
 * Guards for translation-QC suggestions, so applying a fix can never drop content from a subtitle.
 * The AI sometimes returns only the part of a cue it changed (one line or one sentence), not the whole cue.
 */

const flat = (t) => String(t || '').replace(/\s+/g, ' ').trim();
const bigrams = (t) => {
  const s = flat(t).replace(/[\s.,!?;:।॥…"'()\-–—]/g, '');
  const out = new Map();
  for (let i = 0; i < s.length - 1; i += 1) { const g = s.slice(i, i + 2); out.set(g, (out.get(g) || 0) + 1); }
  return out;
};

/** Dice similarity of two texts (0..1) on character pairs; works for any script. */
export function similarity(a, b) {
  const x = bigrams(a);
  const y = bigrams(b);
  let inter = 0;
  let nx = 0;
  let ny = 0;
  x.forEach((n) => { nx += n; });
  y.forEach((n) => { ny += n; });
  x.forEach((n, g) => { inter += Math.min(n, y.get(g) || 0); });
  return nx + ny ? (2 * inter) / (nx + ny) : 0;
}

function segments(text) {
  const lines = String(text || '').split('\n');
  if (lines.length > 1) return { parts: lines, join: '\n' };
  const m = String(text || '').match(/[^.?!।॥]+[.?!।॥]*\s*/g) || [text];
  return { parts: m.length > 1 ? m : [text], join: '' };
}

/**
 * The text to write for a suggestion, or null when it cannot be applied safely.
 * A suggestion that covers (about) the whole cue replaces it. A shorter one is treated as a replacement of the
 * single line or sentence it resembles most, and the rest of the cue is kept. If it matches nothing, it is refused.
 */
export function safeSuggestion(current, suggestion) {
  const cur = String(current || '');
  const sug = String(suggestion || '');
  if (!sug.trim()) return null;
  if (!cur.trim()) return sug;
  const cf = flat(cur).length;
  const sf = flat(sug).length;
  if (sf >= 0.7 * cf) return sug;
  const { parts, join } = segments(cur);
  if (parts.length < 2) return sug;
  let best = -1;
  let bestScore = 0;
  parts.forEach((p, i) => { const s = similarity(p, sug); if (s > bestScore) { bestScore = s; best = i; } });
  if (best < 0 || bestScore < 0.3) return null;
  const lead = join === '' ? (parts[best].match(/^\s*/) || [''])[0] : '';
  const trail = join === '' ? (parts[best].match(/\s*$/) || [''])[0] : '';
  const next = parts.map((p, i) => (i === best ? lead + sug.trim() + trail : p));
  return next.join(join);
}

function lev(a, b) {
  const m = [...a];
  const n = [...b];
  let prev = Array.from({ length: n.length + 1 }, (_, j) => j);
  for (let i = 1; i <= m.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= n.length; j += 1) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (m[i - 1] === n[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n.length];
}

/** True when two texts differ only by the spelling of a single word (a name respelled is not a real fix). */
export function isRespelling(a, b) {
  const x = flat(a).split(' ');
  const y = flat(b).split(' ');
  if (x.length !== y.length) return false;
  const diff = x.map((w, i) => [w, y[i]]).filter(([p, q]) => p !== q);
  if (diff.length !== 1) return false;
  const [p, q] = diff[0];
  return lev(p, q) <= Math.max(2, Math.ceil(0.4 * Math.max(p.length, q.length)));
}
