// Validation tests for the Tier-A expression value form `{ expr }`. The protocol
// is the source of truth for WHERE expressions are legal: numeric properties only,
// and the expr object is strict. Nothing tested this before — it's the missing
// ripple-checklist item, and it locks the numeric-only boundary so a future schema
// edit can't silently widen or narrow it. Pure logic → node:test, no render.
//
//   node --test packages/protocol/test/expr-validation.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../dist/index.js';

// Minimal valid Source wrapping one shape element with the given overrides.
const src = (el) => ({
  output_format: 'mp4', width: 1920, height: 1080, duration: 2, frame_rate: 30,
  elements: [{ id: 'e', type: 'shape', shape: 'rectangle', layer: 1, time: 0, duration: 2, ...el }],
});
const ok = (el) => validate(src(el)).valid;

test('the base document (no expr) validates — sanity', () => {
  assert.equal(ok({}), true);
});

test('accepts {expr} on numeric properties', () => {
  for (const field of ['x', 'y', 'width', 'height', 'rotation', 'scale', 'opacity', 'blur_radius']) {
    assert.equal(ok({ [field]: { expr: 't * 2' } }), true, `${field} should accept {expr}`);
  }
});

test('accepts {expr} on an effect parameter', () => {
  assert.equal(ok({ effects: [{ type: 'glow', radius: { expr: '10 + sin(t * PI)' } }] }), true);
});

test('rejects {expr} on non-numeric fields (numeric-only in v1)', () => {
  assert.equal(ok({ fill_color: { expr: 't' } }), false, 'fill_color (color string)');
  assert.equal(ok({ blend_mode: { expr: 't' } }), false, 'blend_mode (enum)');
  const textSrc = {
    output_format: 'mp4', width: 1920, height: 1080, duration: 2, frame_rate: 30,
    elements: [{ id: 't', type: 'text', layer: 1, time: 0, duration: 2, text: { expr: 't' } }],
  };
  assert.equal(validate(textSrc).valid, false, 'text content (string)');
});

test('svg path `d` rejects {expr} (it is a path string); stroke_progress accepts it', () => {
  const svg = (path) => ({
    output_format: 'mp4', width: 1920, height: 1080, duration: 2, frame_rate: 30,
    elements: [{ id: 's', type: 'shape', layer: 1, time: 0, duration: 2, view_box: [0, 0, 100, 100], paths: [path] }],
  });
  assert.equal(validate(svg({ d: { expr: 't' } })).valid, false, 'd should reject expr');
  assert.equal(validate(svg({ d: 'M 0 0 L 10 10', stroke_progress: { expr: 't' } })).valid, true,
    'stroke_progress (numeric) should accept expr');
});

test('the expr object is strict: extra keys and empty strings are rejected', () => {
  assert.equal(ok({ x: { expr: 't', foo: 1 } }), false, 'extra key rejected (.strict)');
  assert.equal(ok({ x: { expr: '' } }), false, 'empty expr rejected (min 1)');
});
