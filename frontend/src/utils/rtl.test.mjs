import test from 'node:test';
import assert from 'node:assert/strict';
import { isRtlLang, isRtlText, cueDir, cueDirProps } from './rtl.js';

test('RTL languages by code, regional code and name', () => {
  for (const l of ['ar', 'he', 'fa', 'ur', 'ps', 'ug', 'yi', 'ar-sa', 'Arabic', 'Urdu']) assert.equal(isRtlLang(l), true, l);
  for (const l of ['en', 'hi', 'ta', 'Hindi', '', null]) assert.equal(isRtlLang(l), false, String(l));
});

test('an RTL language is always right-to-left, even for a line of Latin names', () => {
  assert.equal(cueDir('ar', 'Netflix'), 'rtl');
  assert.deepEqual(cueDirProps('ur', 'abc'), { dir: 'rtl', style: { textAlign: 'right' } });
});

test('unlabelled text is judged by its letters', () => {
  assert.equal(isRtlText('مرحبا بالعالم'), true);
  assert.equal(isRtlText('שלום עולם'), true);
  assert.equal(isRtlText('hello <i>world</i>'), false);
  assert.equal(cueDir(null, 'नमस्ते'), 'ltr');
  assert.deepEqual(cueDirProps('en', 'hello'), {});
});
