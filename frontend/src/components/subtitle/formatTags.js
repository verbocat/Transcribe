/**
 * Inline subtitle formatting: <b>/<i>/<u> tags and the {\anN} alignment tag.
 *
 * Alignment uses the numpad layout that SRT players, libass (FFmpeg burn-in) and
 * most subtitle tools understand:  7 8 9 = top, 4 5 6 = middle, 1 2 3 = bottom.
 * 2 (bottom centre) is the default and is never written out.
 */

export const DEFAULT_ALIGNMENT = 2;

const ALIGN_TAG = /\{\\an([1-9])\}/;
const ALIGN_TAG_G = /\{\\an[1-9]\}/g;
const LEADING_ALIGN = /^\{\\an[1-9]\}/;

/** Text with every markup tag removed: what the viewer reads and what CPL/CPS count. */
export const stripFormatting = (t) => (t || '').replace(/<[^>]+>/g, '').replace(ALIGN_TAG_G, '');

export function getAlignment(text) {
  const m = ALIGN_TAG.exec(text || '');
  return m ? Number(m[1]) : DEFAULT_ALIGNMENT;
}

export function setAlignment(text, an) {
  const body = (text || '').replace(ALIGN_TAG_G, '');
  return an === DEFAULT_ALIGNMENT ? body : `{\\an${an}}${body}`;
}

/** 'left' | 'center' | 'right' and 'top' | 'middle' | 'bottom' for an {\anN} value */
export function alignmentParts(an) {
  const col = (an - 1) % 3;
  const row = Math.floor((an - 1) / 3);
  return {
    horizontal: ['left', 'center', 'right'][col],
    vertical: ['bottom', 'middle', 'top'][row],
  };
}

export function alignmentFromParts(horizontal, vertical) {
  const col = { left: 0, center: 1, right: 2 }[horizontal];
  const row = { bottom: 0, middle: 1, top: 2 }[vertical];
  return row * 3 + col + 1;
}

/**
 * Toggle <tag> around a range of the text.
 * - No selection (start === end): wraps the whole subtitle, after any alignment tag.
 * - A selection: wraps only the selected words (surrounding spaces are left outside).
 * If that range is already wrapped in the same tag, the tag is removed instead.
 * Returns the new text plus the selection to restore (the wrapped content).
 */
export function toggleWrap(text, start, end, tag) {
  const value = text || '';
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const prefix = (LEADING_ALIGN.exec(value) || [''])[0].length;

  let s = start;
  let e = end;
  if (s === e) {
    s = prefix;
    e = value.length;
  } else {
    s = Math.max(s, prefix);
    e = Math.max(e, s);
  }
  while (s < e && /\s/.test(value[s])) s++;
  while (e > s && /\s/.test(value[e - 1])) e--;

  const inner = value.slice(s, e);
  const lower = (str) => str.toLowerCase();

  // The range itself is "<tag>…</tag>"
  if (inner.length >= open.length + close.length
    && lower(inner.slice(0, open.length)) === open
    && lower(inner.slice(-close.length)) === close) {
    const content = inner.slice(open.length, inner.length - close.length);
    return { text: value.slice(0, s) + content + value.slice(e), start: s, end: s + content.length };
  }
  // The range sits directly inside "<tag>" … "</tag>"
  if (lower(value.slice(s - open.length, s)) === open && lower(value.slice(e, e + close.length)) === close) {
    return {
      text: value.slice(0, s - open.length) + inner + value.slice(e + close.length),
      start: s - open.length,
      end: e - open.length,
    };
  }
  return {
    text: value.slice(0, s) + open + inner + close + value.slice(e),
    start: s + open.length,
    end: e + open.length,
  };
}

/**
 * Split formatted text into styled runs for display. Formatting carries across line
 * breaks, so "<i>line one\nline two</i>" is italic on both lines.
 */
export function formattedRuns(text) {
  const runs = [];
  let b = 0, i = 0, u = 0;
  const parts = (text || '').replace(ALIGN_TAG_G, '').split(/(<\/?[biu]>)/i);
  for (const part of parts) {
    if (!part) continue;
    const t = part.toLowerCase();
    if (t === '<b>') b++;
    else if (t === '</b>') b = Math.max(0, b - 1);
    else if (t === '<i>') i++;
    else if (t === '</i>') i = Math.max(0, i - 1);
    else if (t === '<u>') u++;
    else if (t === '</u>') u = Math.max(0, u - 1);
    else runs.push({ text: part.replace(/<[^>]+>/g, ''), bold: b > 0, italic: i > 0, underline: u > 0 });
  }
  return runs;
}
