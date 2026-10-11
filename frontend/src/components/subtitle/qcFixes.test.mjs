import test from 'node:test';
import assert from 'node:assert/strict';
import { planQcFixes, isQcFixable } from './subtitleTools.js';

const ctx = { fps: 24, cplLimit: 42, cpsLimit: 20, minDuration: 0.833, maxDuration: 7, maxLines: 2, rebroke: new Map() };
const ev = (id, start, end, text) => ({ id, start_time: start, end_time: end, start, end, duration: end - start, text, lines: text.split('\n') });
const item = (eventId, ruleId) => ({ key: `${eventId}|${ruleId}`, eventId, ruleId });

test('a gap error is cured on the EARLIER subtitle, not the flagged one', () => {
  const events = [ev(1, 0, 2.0, 'Hello there'), ev(2, 2.0, 4.0, 'General Kenobi')];
  const { events: out, results } = planQcFixes(events, [item(2, 'NF-GAP-MISSING')], ctx);
  assert.equal(results[0].ok, true);
  assert.ok(Math.abs(out[0].end_time - (2.0 - 2 / 24)) < 0.002);
  assert.equal(out[1].end_time, 4.0);
});

test('closing a gap that would make the earlier subtitle too short needs a human', () => {
  const events = [ev(1, 0, 0.9, 'Hi'), ev(2, 0.9, 2, 'Yo')];
  const { events: out, results } = planQcFixes(events, [item(2, 'NF-GAP-MISSING')], ctx);
  assert.equal(results[0].ok, false);
  assert.match(results[0].message, /No space between/);
  assert.equal(out[0].end_time, 0.9);
});

test('reading speed fix reports no room instead of pretending', () => {
  const events = [ev(1, 0, 1, 'a'.repeat(40)), ev(2, 1.1, 3, 'ok')];
  const { results } = planQcFixes(events, [item(1, 'NF-CPS-ADULT')], ctx);
  assert.equal(results[0].ok, false);
});

test('reading speed fix reaches the limit with room, without leaving a flicker gap', () => {
  const events = [ev(1, 0, 1, 'a'.repeat(30)), ev(2, 5, 6, 'ok')];
  const { events: out, results } = planQcFixes(events, [item(1, 'NF-CPS-ADULT')], ctx);
  assert.equal(results[0].ok, true);
  assert.ok(30 / (out[0].end_time - out[0].start_time) <= 18);
});

test('ellipsis, punctuation spacing and dual-speaker spacing really change the text', () => {
  const events = [ev(1, 0, 2, 'Wait...'), ev(2, 3, 5, 'Hello , world !'), ev(3, 6, 8, '- Hi\n- Yo')];
  const { events: out, results } = planQcFixes(events, [item(1, 'NF-ELLIPSIS'), item(2, 'NF-PUNCT-SPACE'), item(3, 'NF-DUAL-SPEAKER-SPACE')], ctx);
  assert.ok(results.every((r) => r.ok));
  assert.equal(out[0].text, 'Wait…');
  assert.equal(out[1].text, 'Hello, world!');
  assert.equal(out[2].text, '-Hi\n-Yo');
});

test('re-break that cannot fit the limits is human work', () => {
  const long = 'word '.repeat(40).trim();
  const events = [ev(1, 0, 3, long)];
  const rebroke = new Map([[1, long]]);
  const { results } = planQcFixes(events, [item(1, 'NF-CPL')], { ...ctx, rebroke });
  assert.equal(results[0].ok, false);
  assert.equal(isQcFixable('NF-CPL'), true);
});
