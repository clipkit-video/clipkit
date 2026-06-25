// Unit tests for the Tier-A expression evaluator (runtime/src/animation/expr.ts).
// This is the one runtime module that parses UNTRUSTED agent/user input, so the
// safety contract (reject anything outside the closed grammar; never execute) and
// determinism are the load-bearing properties. Pure logic → node:test, no render.
//
//   node --test packages/runtime/test/expr.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evalExpr, isExpr, compileExpr } from '../dist/index.js';

const scope = (o = {}) => ({ t: 0, dur: 1, i: 0, n: 1, value: 0, ...o });

test('isExpr distinguishes expression objects from other value forms', () => {
  assert.equal(isExpr({ expr: 't' }), true);
  assert.equal(isExpr(5), false);
  assert.equal(isExpr('50%'), false);
  assert.equal(isExpr([{ time: 0, value: 0 }]), false);
  assert.equal(isExpr(null), false);
  assert.equal(isExpr({ value: 1 }), false);
});

test('evaluates known formulas exactly', () => {
  assert.ok(Math.abs(evalExpr({ expr: '540 + sin(t * PI) * 30' }, scope({ t: 0.5 })) - 570) < 1e-9);
  assert.equal(evalExpr({ expr: 't * 90' }, scope({ t: 2 })), 180);
  assert.equal(evalExpr({ expr: 'clamp(t / 0.4, 0, 1)' }, scope({ t: 0.2 })), 0.5);
  assert.equal(evalExpr({ expr: '300 + i * 80' }, scope({ i: 3 })), 540);
  assert.equal(evalExpr({ expr: 'value * 2' }, scope({ value: 21 })), 42);
  assert.equal(evalExpr({ expr: 't > 1 ? 100 : 0' }, scope({ t: 2 })), 100);
});

test('noise/wiggle/random are deterministic and finite', () => {
  for (const src of ['wiggle(3, 12)', 'noise(t * 5)', 'random(7)']) {
    const a = evalExpr({ expr: src }, scope({ t: 0.37 }));
    const b = evalExpr({ expr: src }, scope({ t: 0.37 }));
    assert.equal(a, b, `${src} not deterministic`);
    assert.ok(Number.isFinite(a), `${src} non-finite`);
  }
});

test('hostile / malformed input falls back to the base value (never executes)', () => {
  const base = scope({ value: 42 });
  for (const bad of [
    'window',          // unknown identifier
    'a.b',             // member access
    'x = 1',           // assignment
    "'hello'",         // string literal
    'frobnicate(t)',   // unknown function
    't[0]',            // indexing
    'constructor',     // host-object probing
  ]) {
    assert.equal(evalExpr({ expr: bad }, base), 42, `"${bad}" should fall back, not evaluate`);
  }
});

test('non-finite results fall back to the base value', () => {
  assert.equal(evalExpr({ expr: '1 / 0' }, scope({ value: 7 })), 7);   // Infinity → fallback
  assert.equal(evalExpr({ expr: 'sqrt(0 - 1)' }, scope({ value: 7 })), 7); // NaN → fallback
});

test('compileExpr: valid → AST, garbage → null', () => {
  assert.notEqual(compileExpr('t * 2'), null);
  assert.equal(compileExpr('@@@'), null);
});
