// The FINISHING CHAIN — the polish pros put on every sound to make it crisp.
// A synth produces a raw sound; this is the "mastering" stage every sound runs
// through. Order matters (same as a real chain):
//
//   transient shape → air EQ → oversampled saturation → parallel comp → M/S width → ceiling
//
// All in code, license-clean. (Convolution reverb is the one technique we DON'T
// do here — it needs an impulse response, which is a recording; deferred like
// organic foley.)

import type { Sfx } from './sfx.js';

export interface FinishOptions {
  /** Attack emphasis (snap/punch), 0..1. Default 0.3. */
  transient?: number;
  /** High-shelf "air" boost (crispness), 0..1. Default 0.5. */
  air?: number;
  /** Oversampled (anti-aliased) saturation amount, 0..1. Default 0.5. */
  drive?: number;
  /** Parallel-compression mix (density/punch), 0..1. Default 0.2. */
  parallel?: number;
  /** Stereo widening of the highs (lows stay mono), 0..1. Default 0.25. */
  width?: number;
}

// ── 1. transient shaping: emphasise the attack (fast env above slow env) ──────
function transientShape(L: Float32Array, R: Float32Array, sr: number, amount: number): void {
  if (amount <= 0) return;
  const fu = 1 - Math.exp(-1 / (0.0008 * sr)), fd = 1 - Math.exp(-1 / (0.02 * sr));
  const su = 1 - Math.exp(-1 / (0.005 * sr)), sd = 1 - Math.exp(-1 / (0.08 * sr));
  let ef = 0, es = 0;
  for (let i = 0; i < L.length; i++) {
    const m = Math.max(Math.abs(L[i]!), Math.abs(R[i]!));
    ef += (m > ef ? fu : fd) * (m - ef);
    es += (m > es ? su : sd) * (m - es);
    const g = 1 + amount * Math.min(2, Math.max(0, ef - es) * 6);
    L[i]! *= g; R[i]! *= g;
  }
}

// ── 2. air EQ: high-shelf boost (crisp) + sub-rumble cleanup ──────────────────
function airEQ(L: Float32Array, R: Float32Array, sr: number, air: number): void {
  const a9 = 1 - Math.exp((-2 * Math.PI * 9000) / sr);
  const a30 = 1 - Math.exp((-2 * Math.PI * 30) / sr);
  let lp9L = 0, lp9R = 0, lp30L = 0, lp30R = 0;
  for (let i = 0; i < L.length; i++) {
    lp9L += a9 * (L[i]! - lp9L); lp30L += a30 * (L[i]! - lp30L);
    L[i] = (L[i]! - lp30L) + air * (L[i]! - lp9L);
    lp9R += a9 * (R[i]! - lp9R); lp30R += a30 * (R[i]! - lp30R);
    R[i] = (R[i]! - lp30R) + air * (R[i]! - lp9R);
  }
}

// ── 3. oversampled saturation: 2× to keep distortion harmonics from aliasing ──
function oversampledSat(buf: Float32Array, drive: number): void {
  if (drive <= 0) return;
  const d = 1 + drive * 2, norm = Math.tanh(d) || 1;
  let prev = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i]!;
    const a = Math.tanh(((prev + x) * 0.5) * d); // interpolated midpoint (the 2× sample)
    const b = Math.tanh(x * d);
    buf[i] = ((a + b) * 0.5) / norm;             // average pair = lowpass before decimating
    prev = x;
  }
}

// ── 4. parallel ("New York") compression: add a squashed copy for density ─────
function parallelComp(L: Float32Array, R: Float32Array, sr: number, amount: number): void {
  if (amount <= 0) return;
  const au = 1 - Math.exp(-1 / (0.002 * sr)), ad = 1 - Math.exp(-1 / (0.1 * sr));
  const thr = 0.15, ratio = 4, makeup = 1.8;
  let env = 0;
  for (let i = 0; i < L.length; i++) {
    const m = Math.max(Math.abs(L[i]!), Math.abs(R[i]!));
    env += (m > env ? au : ad) * (m - env);
    const gr = env > thr ? (thr + (env - thr) / ratio) / env : 1;
    L[i]! += amount * L[i]! * gr * makeup;
    R[i]! += amount * R[i]! * gr * makeup;
  }
}

// ── 5. mid/side width: widen the highs, keep the lows mono (no phase mush) ─────
function msWidth(L: Float32Array, R: Float32Array, sr: number, width: number): void {
  if (width <= 0) return;
  const a200 = 1 - Math.exp((-2 * Math.PI * 200) / sr);
  let sLP = 0;
  for (let i = 0; i < L.length; i++) {
    const mid = (L[i]! + R[i]!) * 0.5, side = (L[i]! - R[i]!) * 0.5;
    sLP += a200 * (side - sLP);
    const s = sLP + (side - sLP) * (1 + width); // lows (sLP) mono, highs widened
    L[i] = mid + s; R[i] = mid - s;
  }
}

/** Run a sound through the finishing chain → a crisp, "mastered" version. */
export function finish(audio: Sfx, opts: FinishOptions = {}): Sfx {
  const L = Float32Array.from(audio.left), R = Float32Array.from(audio.right);
  const sr = audio.sampleRate;
  transientShape(L, R, sr, opts.transient ?? 0.3);
  airEQ(L, R, sr, opts.air ?? 0.5);
  oversampledSat(L, opts.drive ?? 0.5); oversampledSat(R, opts.drive ?? 0.5);
  parallelComp(L, R, sr, opts.parallel ?? 0.2);
  msWidth(L, R, sr, opts.width ?? 0.25);
  for (let i = 0; i < L.length; i++) { L[i] = Math.max(-1, Math.min(1, L[i]!)); R[i] = Math.max(-1, Math.min(1, R[i]!)); }
  return { left: L, right: R, sampleRate: sr };
}
