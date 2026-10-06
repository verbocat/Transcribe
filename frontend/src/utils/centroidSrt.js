/**
 * SRT helpers for the Centroid translate / QC panel: parse (keeps line breaks and text intact),
 * serialise, and bundle several SRT files into a zip without extra dependencies.
 */
import { formatTimeSeconds } from './localExporter';

const TIME_RE = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;

const toSec = (h, m, s, f) => Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(f.padEnd(3, '0').slice(0, 3)) / 1000;

export function parseSrtText(content) {
  if (!content) return [];
  const text = content.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const cues = [];
  for (const block of text.split(/\n\s*\n/)) {
    const lines = block.trim().split('\n');
    const ti = lines.findIndex((l) => l.includes('-->'));
    if (ti < 0) continue;
    const m = lines[ti].match(TIME_RE);
    if (!m) continue;
    const body = lines.slice(ti + 1).map((l) => l.trim()).filter(Boolean).join('\n');
    if (!body) continue;
    cues.push({
      id: cues.length + 1,
      start_time: toSec(m[1], m[2], m[3], m[4]),
      end_time: toSec(m[5], m[6], m[7], m[8]),
      text: body,
    });
  }
  return cues;
}

export function cuesToSrt(cues, textKey = 'text') {
  return cues
    .map((c, i) => `${i + 1}\n${formatTimeSeconds(c.start_time ?? c.start, ',')} --> ${formatTimeSeconds(c.end_time ?? c.end, ',')}\n${c[textKey] || ''}\n`)
    .join('\n');
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---- minimal "store" zip writer (no compression) ----
let CRC_TABLE = null;
function crc32(bytes) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function buildZip(files) {
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  const u16 = (v) => new Uint8Array([v & 255, (v >>> 8) & 255]);
  const u32 = (v) => new Uint8Array([v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]);
  const push = (arr, ...parts) => parts.forEach((p) => arr.push(p));

  for (const f of files) {
    const name = enc.encode(f.name);
    const data = enc.encode(f.content);
    const crc = crc32(data);
    const header = [];
    push(header, u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name);
    const headerLen = header.reduce((n, p) => n + p.length, 0);
    chunks.push(...header, data);
    const entry = [];
    push(entry, u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name);
    central.push(entry);
    offset += headerLen + data.length;
  }
  const centralStart = offset;
  let centralLen = 0;
  for (const e of central) {
    chunks.push(...e);
    centralLen += e.reduce((n, p) => n + p.length, 0);
  }
  chunks.push(u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(centralLen), u32(centralStart), u16(0));
  return new Blob(chunks, { type: 'application/zip' });
}
