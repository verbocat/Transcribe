/**
 * Local Subtitle Exporter for Subtitle Studio.
 * Generates Netflix-compliant timed text deliverables (SRT, VTT, TTML, TXT)
 * entirely inside the browser without requiring backend network calls.
 */

import { stripFormatting, getAlignment, alignmentParts } from '../components/subtitle/formatTags';

const ALIGN_TAGS = /\{\\an[1-9]\}/g;

// WebVTT has no {\anN}; the same placement is expressed as cue settings
function vttCueSettings(text) {
  if (!/\{\\an[1-9]\}/.test(text)) return '';
  const { horizontal, vertical } = alignmentParts(getAlignment(text));
  const settings = [];
  if (vertical === 'top') settings.push('line:0');
  else if (vertical === 'middle') settings.push('line:50%');
  if (horizontal === 'left') settings.push('align:start');
  else if (horizontal === 'right') settings.push('align:end');
  return settings.length ? ` ${settings.join(' ')}` : '';
}

export function formatTimeSeconds(seconds, separator = ',') {
  if (seconds == null || isNaN(seconds)) return `00:00:00${separator}000`;
  const secNum = Math.max(0, parseFloat(seconds));
  const hrs = Math.floor(secNum / 3600);
  const mins = Math.floor((secNum % 3600) / 60);
  const secs = Math.floor(secNum % 60);
  let millis = Math.round((secNum - Math.floor(secNum)) * 1000);
  if (millis >= 1000) {
    millis = 999;
  }
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}${separator}${String(millis).padStart(3, '0')}`;
}

export function exportSrtLocally(events) {
  if (!events || events.length === 0) return '';
  const entries = [];
  events.forEach((ev, idx) => {
    const s = ev.start_time ?? ev.start ?? 0.0;
    const e = ev.end_time ?? ev.end ?? 0.0;
    const text = String(ev.text || '').replace(/\.\.\./g, '…');
    entries.push(`${idx + 1}\n${formatTimeSeconds(s, ',')} --> ${formatTimeSeconds(e, ',')}\n${text}\n`);
  });
  return entries.join('\n');
}

export function exportVttLocally(events) {
  if (!events || events.length === 0) return 'WEBVTT\n\n';
  const lines = ['WEBVTT\n'];
  events.forEach((ev, idx) => {
    const s = ev.start_time ?? ev.start ?? 0.0;
    const e = ev.end_time ?? ev.end ?? 0.0;
    const raw = String(ev.text || '');
    const text = raw.replace(ALIGN_TAGS, '').replace(/\.\.\./g, '…');
    lines.push(String(idx + 1));
    lines.push(`${formatTimeSeconds(s, '.')} --> ${formatTimeSeconds(e, '.')}${vttCueSettings(raw)}`);
    lines.push(text);
    lines.push('');
  });
  return lines.join('\n');
}

export function exportTxtLocally(events) {
  if (!events || events.length === 0) return '';
  const lines = [];
  events.forEach((ev) => {
    const s = formatTimeSeconds(ev.start_time ?? ev.start ?? 0.0, '.');
    const e = formatTimeSeconds(ev.end_time ?? ev.end ?? 0.0, '.');
    const speaker = (ev.speakers && ev.speakers[0]) || ev.speaker || 'Speaker';
    const text = stripFormatting(ev.text).replace(/\n/g, ' ').replace(/\.\.\./g, '…');
    lines.push(`[${s} --> ${e}] ${speaker}: ${text}`);
  });
  return lines.join('\n');
}

export function exportTtmlLocally(events, language = 'en') {
  const xml = [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" xml:lang="${language}">`,
    '  <head>',
    '    <styling>',
    '      <style xml:id="default" tts:color="white" tts:fontFamily="sansSerif" tts:fontSize="100%" tts:textAlign="center" tts:origin="10% 10%" tts:extent="80% 80%"/>',
    '    </styling>',
    '    <layout>',
    '      <region xml:id="bottomCenter" style="default" tts:origin="10% 80%" tts:extent="80% 10%"/>',
    '      <region xml:id="topCenter" style="default" tts:origin="10% 10%" tts:extent="80% 10%"/>',
    '    </layout>',
    '  </head>',
    '  <body>',
    '    <div region="bottomCenter">'
  ];

  (events || []).forEach((ev) => {
    const s = formatTimeSeconds(ev.start_time ?? ev.start ?? 0.0, '.');
    const e = formatTimeSeconds(ev.end_time ?? ev.end ?? 0.0, '.');
    let text = String(ev.text || '')
      .replace(ALIGN_TAGS, '')
      .replace(/\.\.\./g, '…')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Convert back italic spans
    text = text.replace(/&lt;i&gt;/g, '<span tts:fontStyle="italic">');
    text = text.replace(/&lt;\/i&gt;/g, '</span>');
    text = text.replace(/\n/g, '<br/>');

    xml.push(`      <p begin="${s}" end="${e}">${text}</p>`);
  });

  xml.push('    </div>');
  xml.push('  </body>');
  xml.push('</tt>');

  return xml.join('\n');
}

export function downloadLocally(content, filename, mimeType = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
