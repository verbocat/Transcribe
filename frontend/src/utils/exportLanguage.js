import { langName as shortListName } from '../components/subtitle/languages';
import { translateLangName } from '../data/languageCatalog';

// The subtitle short list first, then the full Transcribe Studio list, else the bare code
const langName = (c) => { const n = shortListName(c); return n !== c ? n : translateLangName(c); };

/**
 * Export language choices shared by Transcribe Studio and Subtitle Studio.
 * A choice is a string: 'src' (the original), 'tr:<code>' (one translated track) or 'both:<code>' (original + that track side by side).
 */

/** Options for the selector, from the track codes that exist. `sourceLabel` names the original language. */
export function exportLanguageOptions(trackCodes, sourceLabel) {
  const codes = (trackCodes || []).filter(Boolean);
  const opts = [{ value: 'src', label: `Original${sourceLabel ? ` (${sourceLabel})` : ''}` }];
  codes.forEach((c) => opts.push({ value: `tr:${c}`, label: langName(c) }));
  codes.forEach((c) => opts.push({ value: `both:${c}`, label: `Original + ${langName(c)}`, sideBySide: true }));
  return opts;
}

export function parseExportLanguage(value) {
  const [kind, code] = String(value || 'src').split(':');
  return { kind, code: code || null };
}

/** Whether a stored choice still points at something that exists. */
export function isValidExportLanguage(value, trackCodes) {
  const { kind, code } = parseExportLanguage(value);
  return kind === 'src' || (trackCodes || []).includes(code);
}

/** Suffix for file names so exports of different languages do not overwrite each other. */
export function exportLanguageSuffix(value) {
  const { kind, code } = parseExportLanguage(value);
  if (kind === 'tr') return `.${code}`;
  if (kind === 'both') return `.${code}+orig`;
  return '';
}

/** Matching cue in a track for a source cue: same id, else the nearest start time. */
function pairedCue(cues, id, start, byId) {
  const hit = byId.get(id);
  if (hit) return hit;
  let best = null;
  let bestGap = 0.5;
  cues.forEach((c) => {
    const gap = Math.abs((c.start_time ?? c.start ?? 0) - start);
    if (gap < bestGap) { best = c; bestGap = gap; }
  });
  return best;
}

/**
 * Subtitle Studio: the events to export for a choice.
 * `sourceEvents` are the original-language events, `trackEvents` the translated ones.
 * Single language: that language's events. Side by side: the original with the translation as a second line.
 */
export function eventsForExport(value, sourceEvents, trackEvents) {
  const { kind } = parseExportLanguage(value);
  if (kind === 'tr' && trackEvents) return trackEvents;
  if (kind === 'both' && trackEvents) {
    const byId = new Map(trackEvents.map((e) => [e.id, e]));
    return (sourceEvents || []).map((ev) => {
      const tr = pairedCue(trackEvents, ev.id, ev.start_time ?? ev.start ?? 0, byId);
      const text = tr?.text ? `${ev.text || ''}\n${tr.text}` : ev.text;
      return { ...ev, text };
    });
  }
  return sourceEvents || [];
}

/**
 * Transcribe Studio: segments for the server. A translated track replaces the transcript text;
 * side by side keeps the transcript and adds `translation`.
 */
export function segmentsForExport(value, segments, trackCues) {
  const { kind } = parseExportLanguage(value);
  if ((kind !== 'tr' && kind !== 'both') || !trackCues) return segments;
  const byId = new Map(trackCues.map((e) => [e.id, e]));
  return segments.map((seg) => {
    const tr = pairedCue(trackCues, seg.segment_id, seg.start_time ?? 0, byId);
    const text = tr?.text ?? '';
    return kind === 'tr' ? { ...seg, transcript: text } : { ...seg, translation: text };
  });
}
