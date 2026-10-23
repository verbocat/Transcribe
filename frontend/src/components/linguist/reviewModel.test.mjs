import test from 'node:test';
import assert from 'node:assert/strict';
import { fmtTime, parseTime, toSrt, cps, cueAt, trackSet, buildSavedDraft, qcIssues, suggestionText } from './reviewModel.js';

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

test('qc findings travel with the draft and keep their resolved state', () => {
  const draft = { events: [], qc: { target: 'hi', issues: [{ index: 1, status: 'open', suggestion: ' fix ' }] } };
  assert.equal(qcIssues(draft).length, 1);
  const saved = buildSavedDraft(draft, { __main: [] }, [{ index: 1, status: 'resolved' }]);
  assert.equal(saved.qc.issues[0].status, 'resolved');
  assert.equal(saved.qc.target, 'hi');
  assert.deepEqual(qcIssues({}), []);
  assert.equal(suggestionText({ suggestion: '  ' }), null);
  assert.equal(suggestionText({ suggestion: 'x' }), 'x');
});

import { addEvent, ensureIds, mergeWithNext, remapIssues, removeEvent, setTimes, shiftFollowing, splitAt } from './reviewModel.js';

const ev = (id, s, e, text) => ({ id, start_time: s, end_time: e, start: s, end: e, text });
test('splitAt cuts the cue under the time and renumbers later findings', () => {
  const r = splitAt([ev(1, 0, 4, 'hello big world'), ev(2, 5, 6, 'next')], 2);
  assert.equal(r.events.length, 3);
  assert.equal(r.events[0].end_time, 2);
  assert.equal(r.events[1].start_time, 2.08);
  assert.equal(r.events[1].id, 3);
  assert.equal(r.issueMap(2), 3);
  assert.equal(r.issueMap(1), 1);
  assert.equal(splitAt([ev(1, 0, 4, 'x')], 4.5), null);
});
test('mergeWithNext joins text and moves the later finding onto the merged cue', () => {
  const r = mergeWithNext([ev(1, 0, 1, 'a'), ev(2, 2, 3, 'b'), ev(3, 4, 5, 'c')], 1);
  assert.equal(r.events.length, 2);
  assert.equal(r.events[0].text, 'a\nb');
  assert.equal(r.events[0].end_time, 3);
  assert.equal(r.issueMap(2), 1);
  assert.equal(r.issueMap(3), 2);
  assert.equal(mergeWithNext([ev(1, 0, 1, 'a')], 1), null);
});
test('removeEvent drops its finding and selects a neighbour', () => {
  const r = removeEvent([ev(1, 0, 1, 'a'), ev(2, 2, 3, 'b')], 1);
  assert.equal(r.events.length, 1);
  assert.equal(r.activeId, 2);
  assert.equal(r.issueMap(1), null);
  assert.equal(r.issueMap(2), 1);
});
test('addEvent keeps cues in time order', () => {
  const r = addEvent([ev(1, 0, 1, 'a'), ev(2, 5, 6, 'b')], 2, 3, 'new');
  assert.deepEqual(r.events.map((e) => e.text), ['a', 'new', 'b']);
  assert.equal(r.issueMap(2), 3);
});
test('shiftFollowing moves a cue and everything after it, never below zero', () => {
  const r = shiftFollowing([ev(1, 1, 2, 'a'), ev(2, 3, 4, 'b'), ev(3, 5, 6, 'c')], 2, 4);
  assert.deepEqual(r.events.map((e) => e.start_time), [1, 4, 6]);
  const back = shiftFollowing([ev(1, 1, 2, 'a'), ev(2, 3, 4, 'b')], 1, -5);
  assert.equal(back.events[0].start_time, 0);
});
test('setTimes, ensureIds and remapIssues', () => {
  assert.equal(setTimes([ev(1, 0, 1, 'a')], 1, 0.5, 2).events[0].duration, 1.5);
  assert.deepEqual(ensureIds([{ text: 'x' }, { id: 7, text: 'y' }]).map((e) => e.id), [8, 7]);
  const issues = [{ index: 2, track: 'hi' }, { index: 2, track: 'en' }];
  assert.deepEqual(remapIssues(issues, 'hi', (n) => n + 1).map((q) => q.index), [3, 2]);
});
