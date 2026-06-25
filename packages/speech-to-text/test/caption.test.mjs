// Verifies the protocol bridge: toCaptionWords → schema-valid caption words.
// Pure (no model, no audio) — the part that touches the protocol.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCaptionWords, toCaptionSegments } from '../dist/caption.js';
import { captionElementSchema } from '@clipkit/protocol';

const result = {
  text: 'hello there world',
  duration: 2,
  words: [
    { text: 'hello', start: 0.0, end: 0.34 },
    { text: ' there', start: 0.34, end: 0.7 },
    { text: 'world', start: 0.7, end: 1.1 },
  ],
};

test('maps transcript words to caption words (trimmed, monotonic, nonnegative)', () => {
  const words = toCaptionWords(result);
  assert.deepEqual(words, [
    { text: 'hello', start: 0.0, end: 0.34 },
    { text: 'there', start: 0.34, end: 0.7 },
    { text: 'world', start: 0.7, end: 1.1 },
  ]);
});

test('produces a valid caption element', () => {
  const el = { id: 'cap', type: 'caption', time: 0, layer: 3, words: toCaptionWords(result) };
  const parsed = captionElementSchema.safeParse(el);
  assert.ok(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues));
});

test('offset shifts to element-relative time and clamps to ≥ 0', () => {
  const words = toCaptionWords(result, { offset: 0.5 });
  assert.equal(words[0].start, 0); // 0.0 - 0.5 → clamped to 0
  assert.ok(Math.abs(words[2].start - 0.2) < 1e-9); // 0.7 - 0.5
});

test('minDuration drops noise words', () => {
  const words = toCaptionWords(result, { minDuration: 0.4 });
  assert.deepEqual(words.map((w) => w.text), ['world']); // only the 0.4s word survives
});

const long = {
  text: 'one two three four five six seven eight',
  duration: 12,
  words: [
    { text: 'one', start: 0.0, end: 0.3 },
    { text: 'two', start: 0.3, end: 0.6 },
    { text: 'three', start: 0.6, end: 0.9 },
    // a long pause before "four" → new segment
    { text: 'four', start: 5.0, end: 5.3 },
    { text: 'five', start: 5.3, end: 5.6 },
  ],
};

test('toCaptionSegments splits on pauses and rebases word times', () => {
  const segs = toCaptionSegments(long, { maxGap: 0.6, maxWords: 6 });
  assert.equal(segs.length, 2); // the 4.1s gap before "four" breaks it
  assert.equal(segs[0].start, 0.0);
  assert.deepEqual(segs[0].words.map((w) => w.text), ['one', 'two', 'three']);
  assert.equal(segs[1].start, 5.0);
  assert.equal(segs[1].words[0].start, 0); // "four" rebased: 5.0 - 5.0 = 0
  assert.ok(Math.abs(segs[1].words[1].start - 0.3) < 1e-9); // "five": 5.3 - 5.0
});

test('toCaptionSegments caps words per segment', () => {
  const segs = toCaptionSegments(long, { maxWords: 2, maxGap: 99, maxDuration: 99 });
  assert.deepEqual(segs.map((s) => s.words.length), [2, 2, 1]);
});

test('each segment is a valid caption element', () => {
  for (const seg of toCaptionSegments(long)) {
    const el = { id: 'c', type: 'caption', time: seg.start, layer: 3, words: seg.words };
    assert.ok(captionElementSchema.safeParse(el).success);
  }
});
