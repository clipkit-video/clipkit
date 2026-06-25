// Unknown-key detection for @clipkit/lint — the logic behind the MCP server's
// "key not in the schema" warnings (set_project / add_element / edit_element on
// the way in; validate_project / load_project on inspect). Pure logic, so it's a
// node:test per TESTING-PLAN.md (probes are for things that render; this isn't).
//
// WHAT THIS SUITE KEEPS IN SYNC — each of these can drift silently otherwise:
//
//  1. Introspected known-key sets vs the real Zod schema. unknownKeys derives the
//     valid keys per element type by walking elementSchema/sourceSchema. If a
//     schema field is added/renamed, or a zod (or zod-to-json-schema) bump changes
//     how options/shapes introspect, a VALID source could start false-positiving,
//     or a real typo could slip through. → "valid source is clean" guards this.
//
//  2. The passthrough-vs-closed split. Detection relies on a real protocol quirk:
//     elements/source KEEP unknown keys (validator passes them through → caught by
//     introspection), while closed objects (effects, paths, keyframes) STRIP them
//     (→ caught by the input-vs-validated diff). If the protocol flips an object's
//     additionalProperties, the bucket AND which detector must catch it both
//     change. → the kept/stripped tests, incl. a state-level strip assertion.
//
//  3. Position-awareness. A real key at the WRONG nesting level must still be
//     flagged — detection rides the validator's per-position stripping, not a flat
//     "known anywhere" set. → the wrong-level test.
//
//  4. The "did you mean?" matcher: normalized camelCase↔snake_case (the dominant
//     LLM mistake) + 1-char typos, while staying silent on genuine nonsense. → the
//     suggestion tests guard the threshold from drifting into false hints or
//     losing the camelCase case.
//
//   node --test packages/lint/test/unknown-keys.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unknownKeys, droppedKeys, unrecognizedKeys } from '../dist/index.js';
import { validate } from '@clipkit/protocol';

// Minimal valid Source wrapping one element (callers supply the element body).
const src = (el) => ({
  output_format: 'mp4',
  width: 1920,
  height: 1080,
  duration: 3,
  frame_rate: 30,
  elements: [{ id: 'e', layer: 1, time: 0, duration: 3, ...el }],
});
const has = (list, needle) => list.some((s) => s.includes(needle));

// (1) Guards the introspected known-key sets: a fully valid source — including
// nested closed objects (effect, keyframes) — must produce ZERO flags. If this
// breaks, the schema and the known-key introspection have drifted apart.
test('a valid source (incl. nested objects) has no unrecognized keys', () => {
  const s = src({
    type: 'shape',
    shape: 'rectangle',
    x: 1,
    y: 1,
    width: 10,
    height: 10,
    fill_color: '#fff',
    opacity: 1,
    effects: [{ type: 'glass', blur_radius: 6 }],
    keyframe_animations: [{ property: 'x', keyframes: [{ time: 0, value: 0 }, { time: 1, value: 10, easing: 'ease-out' }] }],
  });
  const v = validate(s);
  assert.equal(v.valid, true);
  assert.deepEqual(unknownKeys(v.data), []);
  assert.deepEqual(droppedKeys(s, v.data), []);
});

// (2a) KEPT bucket: an element is passthrough, so an unknown key SURVIVES
// validation and stays in the saved project. The diff can't see it (it's in both
// input and output) — the introspection detector must. Guards the "elements keep
// unknown keys" half of the split.
test('unknown key on a passthrough element → kept, caught by introspection', () => {
  const s = src({ type: 'text', text: 'hi', x: 1, y: 1, glowAmount: 5 });
  const v = validate(s);
  assert.equal('glowAmount' in v.data.elements[0], true, 'passthrough: key must survive validation');
  assert.ok(has(unknownKeys(v.data), 'elements[0].glowAmount'), 'introspection must flag it');
  assert.deepEqual(droppedKeys(s, v.data), [], 'nothing was stripped');
});

// (2b) STRIPPED bucket + STATE assertion: a closed object (glass effect) drops
// the key during validation, so it's gone from the saved project. The
// introspection detector can't see it (already gone) — the diff must, with the
// correct nested path + index. The state assertion (key truly absent) is the
// regression guard the two separate code paths otherwise share no check for.
test('unknown key in a closed effect → stripped, caught by the diff at depth', () => {
  const s = src({
    type: 'shape', shape: 'rectangle', x: 1, y: 1, width: 10, height: 10, fill_color: '#fff',
    effects: [{ type: 'glass', bogusKey: 1 }],
  });
  const v = validate(s);
  assert.equal('bogusKey' in v.data.elements[0].effects[0], false, 'closed object must strip the key');
  assert.deepEqual(unknownKeys(v.data), [], 'introspection cannot see a stripped key');
  assert.ok(has(droppedKeys(s, v.data), 'elements[0].effects[0].bogusKey'), 'diff must flag it, at depth');
});

// (3) POSITION-AWARE: `property` is a valid key on a keyframe_animations CHANNEL,
// but not inside an individual keyframe. A flat "known anywhere" checker would
// wave it through; the diff (riding the validator's per-position strip) must flag
// the misplaced one and leave the correctly-placed keys alone.
test('a real key at the wrong nesting level is still flagged', () => {
  const s = src({
    type: 'shape', shape: 'rectangle', x: 1, y: 1, width: 10, height: 10, fill_color: '#fff',
    keyframe_animations: [{
      property: 'x', // valid here (channel level)
      keyframes: [
        { time: 0, value: 0, property: 'y' }, // `property` invalid INSIDE a keyframe → stripped
        { time: 1, value: 10, easing: 'ease-out' }, // all valid → untouched
      ],
    }],
  });
  const stripped = droppedKeys(s, validate(s).data);
  assert.ok(has(stripped, 'keyframe_animations[0].keyframes[0].property'), 'misplaced key flagged with full path');
  assert.ok(!has(stripped, 'easing'), 'correctly-placed keyframe-level key must NOT be flagged');
});

// (4a) "Did you mean?" — the dominant LLM mistake: camelCase for a snake_case
// field, even nested inside a closed effect. Normalized match must resolve it.
test('"did you mean" maps camelCase → snake_case (at depth)', () => {
  const s = src({
    type: 'shape', shape: 'rectangle', x: 1, y: 1, width: 10, height: 10, fill_color: '#fff',
    effects: [{ type: 'glass', blurRadius: 8 }],
  });
  const stripped = droppedKeys(s, validate(s).data);
  assert.ok(has(stripped, 'blurRadius') && has(stripped, 'did you mean blur_radius?'), JSON.stringify(stripped));
});

// (4b) "Did you mean?" — a 1-char typo gets the fix; genuine nonsense stays
// silent (the threshold must not invent misleading hints).
test('"did you mean" handles a typo and stays silent on nonsense', () => {
  const s = src({ type: 'text', text: 'hi', x: 1, y: 1, fill_colour: '#fff', frobnicate: 1 });
  const kept = unknownKeys(validate(s).data);
  assert.ok(kept.some((k) => k.includes('fill_colour') && k.includes('did you mean fill_color?')), JSON.stringify(kept));
  assert.ok(kept.some((k) => k.includes('frobnicate') && !k.includes('did you mean')), 'nonsense → no suggestion');
});

// (5) The combined helper unions both buckets (used where a single flat list is
// wanted). Guards that neither side gets dropped from the union.
test('unrecognizedKeys unions kept + stripped', () => {
  const s = src({
    type: 'shape', shape: 'rectangle', x: 1, y: 1, width: 10, height: 10, fill_color: '#fff',
    glowAmount: 5, effects: [{ type: 'glass', bogusKey: 1 }],
  });
  const all = unrecognizedKeys(s, validate(s).data);
  assert.ok(has(all, 'glowAmount'), 'kept key present');
  assert.ok(has(all, 'bogusKey'), 'stripped key present');
});
