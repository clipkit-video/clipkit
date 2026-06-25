// Easing functions. All take and return progress in 0..1 (back / elastic /
// spring overshoot outside [0, 1] mid-curve by design).
//
// Names match the schema's EASING_FUNCTIONS const array in @clipkit/protocol,
// which is the single source of truth for valid easing names. Two parametric
// forms are also accepted: `cubic-bezier(x1, y1, x2, y2)` and `steps(n)` —
// parsed on first use and cached.

import type { EasingFunction } from '@clipkit/protocol';

type EaseFn = (t: number) => number;

const linear: EaseFn = (t) => t;

const easeIn: EaseFn = (t) => t * t;
const easeOut: EaseFn = (t) => t * (2 - t);
const easeInOut: EaseFn = (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t);

const easeInCubic: EaseFn = (t) => t * t * t;
const easeOutCubic: EaseFn = (t) => 1 - Math.pow(1 - t, 3);
const easeInOutCubic: EaseFn = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

const easeInQuad = easeIn;
const easeOutQuad = easeOut;
const easeInOutQuad = easeInOut;

const easeInQuart: EaseFn = (t) => t * t * t * t;
const easeOutQuart: EaseFn = (t) => 1 - Math.pow(1 - t, 4);
const easeInOutQuart: EaseFn = (t) =>
  t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2;

const easeInQuint: EaseFn = (t) => t * t * t * t * t;
const easeOutQuint: EaseFn = (t) => 1 - Math.pow(1 - t, 5);
const easeInOutQuint: EaseFn = (t) =>
  t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2;

const easeInSine: EaseFn = (t) => 1 - Math.cos((t * Math.PI) / 2);
const easeOutSine: EaseFn = (t) => Math.sin((t * Math.PI) / 2);
const easeInOutSine: EaseFn = (t) => -(Math.cos(Math.PI * t) - 1) / 2;

const easeInExpo: EaseFn = (t) => (t === 0 ? 0 : Math.pow(2, 10 * t - 10));
const easeOutExpo: EaseFn = (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t));
const easeInOutExpo: EaseFn = (t) => {
  if (t === 0) return 0;
  if (t === 1) return 1;
  return t < 0.5
    ? Math.pow(2, 20 * t - 10) / 2
    : (2 - Math.pow(2, -20 * t + 10)) / 2;
};

const easeInCirc: EaseFn = (t) => 1 - Math.sqrt(1 - Math.pow(t, 2));
const easeOutCirc: EaseFn = (t) => Math.sqrt(1 - Math.pow(t - 1, 2));
const easeInOutCirc: EaseFn = (t) =>
  t < 0.5
    ? (1 - Math.sqrt(1 - Math.pow(2 * t, 2))) / 2
    : (Math.sqrt(1 - Math.pow(-2 * t + 2, 2)) + 1) / 2;

const c1 = 1.70158;
const c2 = c1 * 1.525;
const c3 = c1 + 1;
const easeInBack: EaseFn = (t) => c3 * t * t * t - c1 * t * t;
const easeOutBack: EaseFn = (t) =>
  1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
const easeInOutBack: EaseFn = (t) =>
  t < 0.5
    ? (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2
    : (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2;

// Damped harmonic oscillator. Mass=1, damping=10, stiffness=100 — the classic
// springy defaults. Underdamped → overshoots ~5%, settles by t≈1.
// position(t) = 1 − e^(−ζω₀t) · [cos(ω_d t) + (ζω₀ / ω_d) · sin(ω_d t)]
const spring: EaseFn = (t) => {
  const mass = 1;
  const damping = 10;
  const stiffness = 100;
  const omega0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  // The animation runs at t ∈ [0, 1]; scale physics time so the spring is
  // mostly settled by the end of the easing curve. The spring naturally
  // settles by ~1s of physics time at these params; we let the curve play
  // over our [0, 1] window directly.
  const phys = t;
  if (zeta < 1) {
    const omegaD = omega0 * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * omega0 * phys) *
      (Math.cos(omegaD * phys) + ((zeta * omega0) / omegaD) * Math.sin(omegaD * phys));
  }
  // Critically damped fallback (rare with default params).
  return 1 - Math.exp(-omega0 * phys) * (1 + omega0 * phys);
};

// Elastic — decaying sinusoidal overshoot (easings.net formulas).
const c4 = (2 * Math.PI) / 3;
const c5 = (2 * Math.PI) / 4.5;
const elasticIn: EaseFn = (t) =>
  -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * c4);
const elasticOut: EaseFn = (t) =>
  Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
const elasticInOut: EaseFn = (t) =>
  t < 0.5
    ? -(Math.pow(2, 20 * t - 10) * Math.sin((20 * t - 11.125) * c5)) / 2
    : (Math.pow(2, -20 * t + 10) * Math.sin((20 * t - 11.125) * c5)) / 2 + 1;

// Bounce — piecewise parabolic "ball drop" (easings.net formulas).
const bounceOut: EaseFn = (t) => {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
};
const bounceIn: EaseFn = (t) => 1 - bounceOut(1 - t);
const bounceInOut: EaseFn = (t) =>
  t < 0.5 ? (1 - bounceOut(1 - 2 * t)) / 2 : (1 + bounceOut(2 * t - 1)) / 2;

const REGISTRY: Record<EasingFunction, EaseFn> = {
  'linear': linear,
  'ease': easeInOut, // CSS "ease" is roughly the same shape
  'ease-in': easeIn,
  'ease-out': easeOut,
  'ease-in-out': easeInOut,
  'ease-in-cubic': easeInCubic,
  'ease-out-cubic': easeOutCubic,
  'ease-in-out-cubic': easeInOutCubic,
  'ease-in-quad': easeInQuad,
  'ease-out-quad': easeOutQuad,
  'ease-in-out-quad': easeInOutQuad,
  'ease-in-quart': easeInQuart,
  'ease-out-quart': easeOutQuart,
  'ease-in-out-quart': easeInOutQuart,
  'ease-in-quint': easeInQuint,
  'ease-out-quint': easeOutQuint,
  'ease-in-out-quint': easeInOutQuint,
  'ease-in-sine': easeInSine,
  'ease-out-sine': easeOutSine,
  'ease-in-out-sine': easeInOutSine,
  'ease-in-expo': easeInExpo,
  'ease-out-expo': easeOutExpo,
  'ease-in-out-expo': easeInOutExpo,
  'ease-in-circ': easeInCirc,
  'ease-out-circ': easeOutCirc,
  'ease-in-out-circ': easeInOutCirc,
  'ease-in-back': easeInBack,
  'ease-out-back': easeOutBack,
  'ease-in-out-back': easeInOutBack,
  'spring': spring,
  'elastic-in': elasticIn,
  'elastic-out': elasticOut,
  'elastic-in-out': elasticInOut,
  'bounce-in': bounceIn,
  'bounce-out': bounceOut,
  'bounce-in-out': bounceInOut,
};

// ── Parametric easings ──────────────────────────────────────────────────────

/**
 * CSS cubic-bezier timing function. Control points (x1, y1) / (x2, y2);
 * endpoints fixed at (0,0) and (1,1). Solve x(s) = t for the curve
 * parameter s via Newton-Raphson with a bisection fallback, then return
 * y(s). Same approach as every browser's implementation.
 */
function cubicBezier(x1: number, y1: number, x2: number, y2: number): EaseFn {
  // Polynomial coefficients for B(s) = ((a·s + b)·s + c)·s.
  const cxc = 3 * x1;
  const bxc = 3 * (x2 - x1) - cxc;
  const axc = 1 - cxc - bxc;
  const cyc = 3 * y1;
  const byc = 3 * (y2 - y1) - cyc;
  const ayc = 1 - cyc - byc;

  const sampleX = (s: number) => ((axc * s + bxc) * s + cxc) * s;
  const sampleY = (s: number) => ((ayc * s + byc) * s + cyc) * s;
  const sampleDX = (s: number) => (3 * axc * s + 2 * bxc) * s + cxc;

  return (t) => {
    // Newton-Raphson — converges in a few iterations for sane curves.
    let s = t;
    for (let i = 0; i < 8; i++) {
      const x = sampleX(s) - t;
      if (Math.abs(x) < 1e-6) return sampleY(s);
      const dx = sampleDX(s);
      if (Math.abs(dx) < 1e-6) break;
      s -= x / dx;
    }
    // Bisection fallback for flat-derivative regions.
    let lo = 0;
    let hi = 1;
    s = t;
    while (lo < hi) {
      const x = sampleX(s);
      if (Math.abs(x - t) < 1e-6) break;
      if (x < t) lo = s;
      else hi = s;
      s = (lo + hi) / 2;
      if (hi - lo < 1e-6) break;
    }
    return sampleY(s);
  };
}

/** CSS steps(n, end): n equidistant steps, jumping at each interval's end. */
function steps(n: number): EaseFn {
  return (t) => Math.floor(t * n) / n;
}

const CUBIC_BEZIER_RE =
  /^cubic-bezier\(\s*(-?\d*\.?\d+)\s*,\s*(-?\d*\.?\d+)\s*,\s*(-?\d*\.?\d+)\s*,\s*(-?\d*\.?\d+)\s*\)$/;
const STEPS_RE = /^steps\(\s*(\d+)\s*\)$/;

// Parsed-parametric cache. Invalid strings cache `null` so a bad schema
// value doesn't re-run the regexes every frame.
const parametricCache = new Map<string, EaseFn | null>();

function parseParametric(name: string): EaseFn | null {
  const cached = parametricCache.get(name);
  if (cached !== undefined) return cached;

  let fn: EaseFn | null = null;
  const bez = CUBIC_BEZIER_RE.exec(name);
  if (bez) {
    // x coordinates must stay in [0, 1] for x(s) to be invertible.
    const x1 = Math.min(1, Math.max(0, parseFloat(bez[1]!)));
    const x2 = Math.min(1, Math.max(0, parseFloat(bez[3]!)));
    fn = cubicBezier(x1, parseFloat(bez[2]!), x2, parseFloat(bez[4]!));
  } else {
    const st = STEPS_RE.exec(name);
    if (st) {
      const n = parseInt(st[1]!, 10);
      if (n > 0) fn = steps(n);
    }
  }

  parametricCache.set(name, fn);
  return fn;
}

/**
 * Apply an easing to a progress value in 0..1.
 * Accepts named easings and the parametric `cubic-bezier(...)` / `steps(n)`
 * forms. Unknown easings fall back to linear so a bad schema value never
 * throws.
 */
export function applyEasing(name: EasingFunction | string | undefined, t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  if (!name) return t;
  const fn = REGISTRY[name as EasingFunction] ?? parseParametric(name);
  return (fn ?? linear)(t);
}
