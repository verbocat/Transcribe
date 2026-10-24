import { createContext, useContext } from 'react';

/**
 * Right-to-left languages the tool offers (Centroid codes). Text in one of these is always laid out
 * right-to-left and right-aligned: in the text boxes, the subtitle list, the video preview and the timeline blocks.
 */
export const RTL_CODES = new Set(['ar', 'he', 'fa', 'ur', 'ps', 'ug', 'yi']);

const RTL_NAMES = { arabic: 'ar', hebrew: 'he', persian: 'fa', urdu: 'ur', pashto: 'ps', uyghur: 'ug', yiddish: 'yi' };

const RTL_CHARS = /[֐-ࣿיִ-﷿ﹰ-﻿]/g;
const LTR_CHARS = /[A-Za-zÀ-ɏͰ-ϿЀ-ӿऀ-෿฀-໿぀-鿿가-힯]/g;

/** Base code ('ar-sa' -> 'ar') from a Centroid code or a language name such as "Arabic" */
function baseCode(lang) {
  if (!lang) return '';
  const s = String(lang).trim();
  return (RTL_NAMES[s.toLowerCase()] || s.toLowerCase()).split(/[-_]/)[0];
}

export function isRtlLang(lang) {
  return RTL_CODES.has(baseCode(lang));
}

/** True when the text is mostly right-to-left letters (used only when the language is not known, e.g. an opened SRT) */
export function isRtlText(text) {
  const t = String(text || '').replace(/<[^>]+>|\{\\an\d\}/g, '');
  const rtl = (t.match(RTL_CHARS) || []).length;
  if (!rtl) return false;
  return rtl >= (t.match(LTR_CHARS) || []).length;
}

/** 'rtl' for an RTL language (always, even for a line of Latin names), and for text that is itself right-to-left (e.g. an opened SRT with no language set) */
export function cueDir(lang, text) {
  return isRtlLang(lang) || isRtlText(text) ? 'rtl' : 'ltr';
}

/** Props for an element holding subtitle text: dir plus right alignment for RTL, nothing for LTR */
export function cueDirProps(lang, text) {
  return cueDir(lang, text) === 'rtl' ? { dir: 'rtl', style: { textAlign: 'right' } } : {};
}

/** Language of the cues on screen, provided by Subtitle Studio so rows, boxes and timeline blocks need no extra props */
export const CueLangContext = createContext(null);
export const useCueLang = () => useContext(CueLangContext);
