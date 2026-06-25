// Unit tests for the easing curves (runtime/src/animation/easings.ts). Every
// curve is a normalized progress function on [0,1] used everywhere keyframes
// interpolate, so the invariants below hold for all of them. Pure logic →
// node:test, no render.
//
//   node --test packages/runtime/test/easing.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEasing } from '../dist/index.js';

const EASINGS = [
  'linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out',
  'ease-in-cubic', 'ease-out-cubic', 'ease-in-out-cubic',
  'ease-in-quad', 'ease-out-quad', 'ease-in-out-quad',
  'ease-in-quart', 'ease-out-quart', 'ease-in-out-quart',
  'ease-in-quint', 'ease-out-quint', 'ease-in-out-quint',
  'ease-in-sine', 'ease-out-sine', 'ease-in-out-sine',
  'ease-in-expo', 'ease-out-expo', 'ease-in-out-expo',
  'ease-in-circ', 'ease-out-circ', 'ease-in-out-circ',
  'ease-in-back', 'ease-out-back', 'ease-in-out-back', 'spring',
];

test('every easing pins endpoints: f(0)=0, f(1)=1', () => {
  for (const e of EASINGS) {
    assert.ok(Math.abs(applyEasing(e, 0)) < 1e-6, `${e}(0) != 0 (got ${applyEasing(e, 0)})`);
    assert.ok(Math.abs(applyEasing(e, 1) - 1) < 1e-6, `${e}(1) != 1 (got ${applyEasing(e, 1)})`);
  }
});

test('non-overshoot easings are monotonic non-decreasing on [0,1]', () => {
  const monotone = EASINGS.filter((e) => !e.includes('back') && e !== 'spring');
  for (const e of monotone) {
    let prev = -Infinity;
    for (let t = 0; t <= 1.00001; t += 0.05) {
      const v = applyEasing(e, Math.min(t, 1));
      assert.ok(v >= prev - 1e-6, `${e} not monotonic at t=${t.toFixed(2)}: ${v} < ${prev}`);
      prev = v;
    }
  }
});

test('ease-in lags and ease-out leads linear at the midpoint', () => {
  assert.ok(applyEasing('ease-in', 0.5) < 0.5, 'ease-in should be below linear at t=0.5');
  assert.ok(applyEasing('ease-out', 0.5) > 0.5, 'ease-out should be above linear at t=0.5');
});

test('unknown easing name is handled gracefully (finite, no throw)', () => {
  const v = applyEasing('not-a-real-easing', 0.5);
  assert.ok(Number.isFinite(v), 'unknown easing returned non-finite');
});
