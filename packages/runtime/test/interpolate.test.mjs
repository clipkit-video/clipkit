// Unit tests for keyframe interpolation (runtime/src/animation/keyframes.ts).
// Every animated property flows through this; it fails silently (wrong number,
// not a crash), so it earns direct coverage. Pure logic → node:test, no render.
//
//   node --test packages/runtime/test/interpolate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpolateKeyframes, interpolateColorKeyframes } from '../dist/animation/keyframes.js';

const kf = (t, v, easing) => ({ time: t, value: v, ...(easing ? { easing } : {}) });

test('numeric: exact endpoints, clamping, linear midpoint', () => {
  const k = [kf(0, 10, 'linear'), kf(2, 30, 'linear')];
  assert.equal(interpolateKeyframes(k, 0), 10);    // exact first
  assert.equal(interpolateKeyframes(k, 2), 30);    // exact last
  assert.equal(interpolateKeyframes(k, 1), 20);    // linear midpoint
  assert.equal(interpolateKeyframes(k, -5), 10);   // clamp before first
  assert.equal(interpolateKeyframes(k, 99), 30);   // clamp after last
});

test('numeric: single and empty keyframe lists', () => {
  assert.equal(interpolateKeyframes([kf(0, 42)], 5), 42);
  assert.equal(interpolateKeyframes([], 5), 0);
});

test('numeric: monotonic non-decreasing between ascending values', () => {
  const k = [kf(0, 0, 'ease-in-out'), kf(1, 100, 'ease-in-out')];
  let prev = -Infinity;
  for (let t = 0; t <= 1.00001; t += 0.1) {
    const v = interpolateKeyframes(k, Math.min(t, 1));
    assert.ok(v >= prev - 1e-6, `not monotonic at t=${t.toFixed(2)}: ${v} < ${prev}`);
    prev = v;
  }
});

test('color: channels interpolate; black→white midpoint is neutral gray', () => {
  // RGBA is a [r,g,b,a] array, channels 0..1.
  const k = [kf(0, '#000000'), kf(1, '#ffffff')];
  assert.deepEqual(
    [interpolateColorKeyframes(k, 0)[0], interpolateColorKeyframes(k, 1)[0]], [0, 1]);
  const mid = interpolateColorKeyframes(k, 0.5);
  assert.ok(Math.abs(mid[0] - mid[1]) < 1e-6 && Math.abs(mid[1] - mid[2]) < 1e-6, 'channels not equal');
  assert.ok(mid[0] > 0.2 && mid[0] < 0.8, `midpoint not mid-gray: ${mid[0]}`);
});
