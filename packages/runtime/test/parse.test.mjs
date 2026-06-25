// Unit tests for value parsing: length resolution (runtime/src/compositor/unit.ts)
// and color parsing (runtime/src/compositor/color.ts). These turn the protocol's
// string forms ('50%', 'vw', hex, rgb()) into numbers/RGBA and fail silently on
// bad input. Pure logic → node:test, no render.
//
//   node --test packages/runtime/test/parse.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLength } from '../dist/compositor/unit.js';
import { parseColor } from '../dist/compositor/color.js';

const canvas = { width: 1000, height: 800 };

test('resolveLength: number / px / % / vw / vh / fallback', () => {
  assert.equal(resolveLength(100, 200, canvas), 100);          // raw number
  assert.equal(resolveLength('100px', 200, canvas), 100);      // explicit px
  assert.equal(resolveLength('50%', 200, canvas), 100);        // 50% of ref 200
  assert.equal(resolveLength('50vw', 200, canvas), 500);       // 50% of width 1000
  assert.equal(resolveLength('50vh', 200, canvas), 400);       // 50% of height 800
  assert.equal(resolveLength(undefined, 200, canvas, 7), 7);   // missing → fallback
  assert.equal(resolveLength('garbage', 200, canvas, 7), 7);   // unparseable → fallback
});

test('parseColor: hex / rgb() / alpha / default white', () => {
  const eq = (c, r, g, b, a = 1) => // RGBA is a [r,g,b,a] array, channels 0..1
    Math.abs(c[0] - r) < 0.01 && Math.abs(c[1] - g) < 0.01 &&
    Math.abs(c[2] - b) < 0.01 && Math.abs(c[3] - a) < 0.01;
  assert.ok(eq(parseColor('#ff0000'), 1, 0, 0), 'red hex');
  assert.ok(eq(parseColor('#00ff00'), 0, 1, 0), 'green hex');
  assert.ok(eq(parseColor('rgb(0, 0, 255)'), 0, 0, 1), 'blue rgb()');
  assert.ok(eq(parseColor('rgba(255,255,255,0.5)'), 1, 1, 1, 0.5), 'rgba alpha');
  assert.ok(eq(parseColor(undefined), 1, 1, 1), 'undefined → white default');
});
