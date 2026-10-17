import test from 'node:test';
import assert from 'node:assert/strict';
import { fmtTime, parseTime, toSrt, cps, cueAt, trackSet, buildSavedDraft } from './reviewModel.js';

test('times round-trip', () => {
  assert.equal(fmtTime(62.5), '00:01:02.500');
  assert.equal(parseTime('00:01:02,500'), 62.5);
  assert.equal(parseTime('1:02.5'), 62.5);
  assert.equal(parseTime('62.5'), 62.5);
  assert.equal(parseTime('abc'), null);
  assert.equal(parseTime('1:2:3:4'), null);
});

test('srt skips empty cues and numbers the rest', () => {
  const srt = toSrt([{ start_time: 0, end_time: 1, text: 'a' }, { start_time: 1, end_time: 2, text: '  ' }, { start_time: 2, end_time: 3.5, text: 'b\nc' }]);
  assert.equal(srt, '1\n00:00:00,000 --> 00:00:01,000\na\n\n2\n00:00:02,000 --> 00:00:03,500\nb\nc\n');
});

test('reading speed ignores spaces and tags', () => {
  assert.equal(cps({ start_time: 0, end_time: 2, text: '<i>ab cd</i>' }), 2);
  assert.equal(cueAt([{ start_time: 0, end_time: 1 }, { start_time: 1, end_time: 2 }], 1.5), 1);
});

test('single and multi track drafts save back in the studio shape', () => {
  const single = trackSet({ events: [{ text: 'x' }] });
  assert.deepEqual(single.codes, ['__main']);
  assert.deepEqual(buildSavedDraft({ events: [], score: 1 }, { __main: [{ text: 'y' }] }).events, [{ text: 'y' }]);
  const multi = trackSet({ events: [], tracks: { hi: [{ text: 'a' }], en: [{ text: 'b' }] }, activeTrack: 'en' });
  assert.equal(multi.active, 'en');
  const saved = buildSavedDraft({ activeTrack: 'en', tracks: {} }, { hi: [{ text: 'a2' }], en: [{ text: 'b2' }] });
  assert.deepEqual(saved.events, [{ text: 'b2' }]);
  assert.equal(saved.activeTrack, 'en');
});
