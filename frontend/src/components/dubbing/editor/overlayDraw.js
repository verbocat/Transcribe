// Draws text overlays. The program monitor draws with these functions, and the same drawing (at the video's own size) is
// sent to the server as a PNG for the render, so a title or subtitle looks the same in the preview and the final video.
// The browser shapes every script (Devanagari included), which the server's fonts could not be trusted to do.
import { useEffect, useRef, useState } from 'react';
import { api } from '../dubApi';

export const FONT_STACKS = {
  sans: '"Noto Sans", "Noto Sans Devanagari", "IBM Plex Sans", Arial, sans-serif',
  serif: '"Noto Serif", "Noto Serif Devanagari", Georgia, serif',
  mono: '"IBM Plex Mono", "Noto Sans Mono", monospace',
};

const rgba = (hex, a) => {
  const n = parseInt((hex || '#000000').slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

function wrap(g, text, maxW) {
  const lines = [];
  for (const para of String(text || '').split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { lines.push(''); continue; }
    let line = words[0];
    for (const w of words.slice(1)) {
      const next = `${line} ${w}`;
      if (g.measureText(next).width <= maxW) line = next; else { lines.push(line); line = w; }
    }
    lines.push(line);
  }
  return lines;
}

/** Draw one text clip into a W x H picture (sizes in the style are fractions of H, positions fractions of W / H). */
export function drawText(g, W, H, text, style) {
  const s = style || {};
  const px = Math.max(4, (s.size ?? 0.06) * H);
  g.save();
  g.font = `${s.italic ? 'italic ' : ''}${s.bold ? '700' : '400'} ${px}px ${FONT_STACKS[s.font] || FONT_STACKS.sans}`;
  g.textBaseline = 'middle';
  const maxW = (s.width ?? 0.8) * W;
  const lines = wrap(g, text, maxW);
  const lh = px * 1.25;
  const blockH = lines.length * lh;
  const cx = (s.x ?? 0.5) * W;
  let top = (s.y ?? 0.5) * H - blockH / 2;
  top = Math.max(0, Math.min(H - blockH, top));
  const align = s.align || 'center';
  g.textAlign = align;
  const ax = align === 'left' ? cx - maxW / 2 : align === 'right' ? cx + maxW / 2 : cx;
  lines.forEach((line, i) => {
    const y = top + lh * (i + 0.5);
    const w = g.measureText(line).width;
    if (s.box && line) {
      const padX = px * 0.3; const padY = px * 0.12;
      const x0 = align === 'left' ? ax : align === 'right' ? ax - w : ax - w / 2;
      g.fillStyle = rgba(s.box_color, s.box_opacity ?? 0.6);
      g.fillRect(x0 - padX, y - lh / 2 - padY / 2, w + padX * 2, lh + padY);
    }
    if (s.shadow) { g.shadowColor = 'rgba(0,0,0,0.65)'; g.shadowBlur = px * 0.15; g.shadowOffsetY = px * 0.05; }
    if (s.outline > 0) {
      g.lineJoin = 'round'; g.lineWidth = s.outline * H * 2; g.strokeStyle = s.outline_color || '#000000';
      g.strokeText(line, ax, y);
      g.shadowColor = 'transparent';
    }
    g.fillStyle = s.color || '#ffffff';
    g.fillText(line, ax, y);
    g.shadowColor = 'transparent';
  });
  g.restore();
}

async function fontsFor(style) {
  try {
    const px = 48;
    await document.fonts.load(`${style?.bold ? '700' : '400'} ${px}px ${FONT_STACKS[style?.font] || FONT_STACKS.sans}`, 'Aaनमस्ते');
    await document.fonts.ready;
  } catch { /* fonts API unavailable: draw with what is there */ }
}

/** The PNG the server overlays for a text clip: the video's size, transparent around the text. */
export async function renderOverlayPng(clip, dims) {
  await fontsFor(clip.style);
  const c = document.createElement('canvas');
  c.width = dims.width; c.height = dims.height;
  drawText(c.getContext('2d'), dims.width, dims.height, clip.text, clip.style);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not draw the text.'))), 'image/png'));
}

/**
 * Keeps the server supplied with the pictures of the edit's text clips: each picture is drawn and sent once (they are
 * named by their content). Returns { pending, error } for the toolbar.
 */
export function useOverlayUploads(projectId, edit, dims) {
  const known = useRef(null);
  const busy = useRef(false);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState('');
  const latest = useRef(edit);
  useEffect(() => { latest.current = edit; });

  useEffect(() => {
    if (!dims || !edit) return undefined;
    let cancelled = false;
    const run = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        if (!known.current) {
          const r = await fetch(api(`/projects/${projectId}/overlays`));
          known.current = new Set(r.ok ? (await r.json()).names : []);
        }
        for (;;) {
          const todo = (latest.current?.clips || []).filter((c) => c.source === 'text' && c.image && !known.current.has(c.image));
          const unique = [...new Map(todo.map((c) => [c.image, c])).values()];
          if (!cancelled) setPending(unique.length);
          if (!unique.length) break; // keeps going after edits made meanwhile: it always reads the latest edit
          const c = unique[0];
          const png = await renderOverlayPng(c, dims);
          const r = await fetch(api(`/projects/${projectId}/overlays/${c.image}`), { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: png });
          if (!r.ok) throw new Error(`The text picture could not be saved (${r.status}).`);
          known.current.add(c.image);
        }
        if (!cancelled) setError('');
      } catch (e) {
        if (!cancelled) setError(e.message || 'Text pictures could not be sent.');
      } finally {
        busy.current = false;
      }
    };
    const t = setTimeout(run, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [projectId, edit, dims]);

  return { pending, error };
}
