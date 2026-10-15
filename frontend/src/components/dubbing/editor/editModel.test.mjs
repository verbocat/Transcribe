import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clipEnd, moveClips, trimClip, toggleDisabled, setClipTimes, editPoints, audible, snapTargets,
  historyInit, historyReducer, timecode,
} from './editModel.js';

const ctx = {
  duration: 20,
  lines: {
    1: { id: 1, start: 1, end: 3, audio: { ready: true, duration: 2 } },
    2: { id: 2, start: 5, end: 7, audio: { ready: true, duration: 1.5 } },
    3: { id: 3, start: 9, end: 10, audio: { ready: false } },
  },
};
const edit = () => ({
  tracks: [{ id: 'A1', mute: true }, { id: 'S:A' }, { id: 'S:B', locked: true }],
  clips: [
    { id: 'A1', track: 'A1', source: 'media', start: 0, in: 0, out: 20 },
    { id: 'L1', track: 'S:A', source: 'line', line: 1, start: 1, in: 0, out: null },
    { id: 'L2', track: 'S:A', source: 'line', line: 2, start: 5, in: 0, out: null },
    { id: 'L3', track: 'S:B', source: 'line', line: 3, start: 9, in: 0, out: null },
  ],
});
const clip = (e, id) => e.clips.find((c) => c.id === id);

test('moving stops at neighbours and at zero; locked and media clips stay', () => {
  assert.equal(clip(moveClips(edit(), ['L1'], 10, ctx).edit, 'L1').start, 3); // L2 starts at 5, L1 is 2 s long
  assert.equal(clip(moveClips(edit(), ['L1'], -5, ctx).edit, 'L1').start, 0);
  assert.equal(clip(moveClips(edit(), ['L1', 'L2'], 4, ctx).edit, 'L2').start, 9); // both move together
  assert.equal(moveClips(edit(), ['L3', 'A1'], 1, ctx).edit.clips[3].start, 9);
});

test('snapping pulls an edge onto a target and reports it', () => {
  const e = edit();
  const targets = snapTargets(e, ctx, 4.2, new Set(['L1']));
  const { edit: out, snapAt } = moveClips(e, ['L1'], 0.15, ctx, { targets, threshold: 0.3 });
  assert.equal(snapAt, 1); // its own line start (1.0) is the closest target to 1.15
  assert.equal(clip(out, 'L1').start, 1);
  const r = moveClips(e, ['L1'], 1.1, ctx, { targets, threshold: 0.3 }); // end 4.1 -> playhead 4.2
  assert.equal(r.snapAt, 4.2);
  assert.equal(clip(r.edit, 'L1').start, 2.2);
});

test('trimming keeps a minimum length and the source bounds', () => {
  let c = clip(trimClip(edit(), 'L1', 'left', 0.5, ctx).edit, 'L1');
  assert.deepEqual([c.start, c.in], [1.5, 0.5]);
  c = clip(trimClip(edit(), 'L1', 'left', -3, ctx).edit, 'L1'); // cannot reveal before the source starts
  assert.deepEqual([c.start, c.in], [1, 0]);
  c = clip(trimClip(edit(), 'L1', 'right', -1.95, ctx).edit, 'L1');
  assert.equal(c.out, 0.1);
  c = clip(trimClip(edit(), 'L2', 'right', -0.5, ctx).edit, 'L2');
  assert.equal(c.out, 1);
  assert.equal(clip(trimClip({ ...edit(), clips: edit().clips.map((x) => (x.id === 'L2' ? { ...x, out: 1 } : x)) }, 'L2', 'right', 5, ctx).edit, 'L2').out, null);
  assert.equal(clipEnd(clip(edit(), 'L3'), ctx), 10); // no audio yet: the line's own slot
});

test('typed times, enable toggle, edit points, audible tracks', () => {
  const e = setClipTimes(edit(), 'L2', { start: 4, in: 0.25 }, ctx);
  assert.deepEqual([clip(e, 'L2').start, clip(e, 'L2').in], [4.25, 0.25]);
  const off = toggleDisabled(edit(), ['L1', 'L2']);
  assert.ok(clip(off, 'L1').disabled && clip(off, 'L2').disabled);
  assert.ok(!clip(toggleDisabled(off, ['L1']), 'L1').disabled);
  assert.deepEqual(editPoints(edit(), ctx), [0, 1, 3, 5, 6.5, 9, 10, 20]);
  assert.deepEqual(audible({ tracks: [{ id: 'a', mute: true }, { id: 'b', solo: true }, { id: 'c' }] }), { a: false, b: true, c: false });
});

test('history: a drag is one undo step; undo and redo walk it', () => {
  const a = edit();
  const b = moveClips(a, ['L1'], 1, ctx).edit;
  const c = moveClips(a, ['L1'], 2, ctx).edit;
  let h = historyInit(a);
  h = historyReducer(h, { type: 'begin' });
  h = historyReducer(h, { type: 'preview', edit: b });
  h = historyReducer(h, { type: 'preview', edit: c });
  h = historyReducer(h, { type: 'end' });
  assert.equal(h.past.length, 1);
  h = historyReducer(h, { type: 'undo' });
  assert.equal(h.present, a);
  h = historyReducer(h, { type: 'redo' });
  assert.equal(h.present, c);
  h = historyReducer(h, { type: 'begin' });
  h = historyReducer(h, { type: 'end' });
  assert.equal(h.past.length, 1); // a click without a change records nothing
});

test('timecode', () => {
  assert.equal(timecode(61.5, 25), '00:01:01:13');
  assert.equal(timecode(3600, 30), '01:00:00:00');
});
