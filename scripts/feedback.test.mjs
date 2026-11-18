import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeIdentity, sanitizeSentCounts } from '../src/lib/feedback-state.js';
import { acquireMediaStream, disposeAudioElement, stopMediaStream } from '../src/lib/media-lifecycle.js';

test('stored identity tolerates null, arrays, and malformed field types', () => {
  const empty = { firstName: '', lastName: '', schoolId: '', otherName: '' };
  for (const value of [null, false, 32, 'name', [], [1]]) assert.deepEqual(sanitizeIdentity(value), empty);
  assert.deepEqual(sanitizeIdentity({ firstName: null, lastName: 14, schoolId: {}, otherName: [] }), empty);
  assert.deepEqual(sanitizeIdentity({ firstName: 'Алия', lastName: 'Серік', schoolId: 'head-office', otherName: 'Мектеп', extra: true }), {
    firstName: 'Алия', lastName: 'Серік', schoolId: 'head-office', otherName: 'Мектеп',
  });
  assert.equal(sanitizeIdentity({ firstName: 'x'.repeat(500) }).firstName.length, 80);
});

test('sent counts cannot turn strings, arrays, or prototype keys into counters', () => {
  for (const value of [null, '2', [], [2], false]) assert.deepEqual(sanitizeSentCounts(value), {});
  const input = JSON.parse('{"math-1":2,"english-1":"3","bad":-1,"float":1.5,"__proto__":8,"overflow":9007199254740991}');
  assert.deepEqual(sanitizeSentCounts(input), { 'math-1': 2 });
});

test('a permission result arriving after cancellation stops every microphone track', async () => {
  let resolve;
  let current = true;
  let stopped = 0;
  const pending = acquireMediaStream(() => new Promise((r) => { resolve = r; }), () => current);
  current = false;
  resolve({ getTracks: () => [{ stop: () => { stopped++; } }, { stop: () => { stopped++; } }] });
  assert.equal(await pending, null);
  assert.equal(stopped, 2);
});

test('active permission results stay usable and rejection remains observable', async () => {
  let stopped = false;
  const stream = { getTracks: () => [{ stop: () => { stopped = true; } }] };
  assert.equal(await acquireMediaStream(async () => stream, () => true), stream);
  assert.equal(stopped, false);
  const denied = new Error('permission denied');
  await assert.rejects(acquireMediaStream(async () => { throw denied; }, () => true), denied);
});

test('a failing track does not prevent releasing remaining media tracks', () => {
  let stopped = false;
  stopMediaStream({ getTracks: () => [{ stop() { throw new Error('gone'); } }, { stop() { stopped = true; } }] });
  assert.equal(stopped, true);
  assert.doesNotThrow(() => stopMediaStream(null));
});

test('audio disposal disconnects callbacks before pausing and releasing the source', () => {
  const calls = [];
  const audio = {
    onpause: () => assert.fail('stale component callback'),
    pause() { calls.push('pause'); this.onpause?.(); },
    removeAttribute(name) { calls.push(`remove:${name}`); },
    load() { calls.push('load'); },
  };
  disposeAudioElement(audio);
  assert.deepEqual(calls, ['pause', 'remove:src', 'load']);
  for (const event of ['timeupdate', 'play', 'pause', 'ended', 'loadedmetadata', 'error']) assert.equal(audio[`on${event}`], null);
  assert.doesNotThrow(() => disposeAudioElement(null));
});
