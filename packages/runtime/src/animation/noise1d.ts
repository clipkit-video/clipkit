// Normative 1D value noise (§6.2 `drift`) — the time-domain sibling of
// the §4.7 fractal-noise spec: the same PCG hash over an integer
// lattice, quintic-faded linear interpolation between corners.
// Integer math is wrapping 32-bit unsigned, so identical seeds produce
// identical motion on every runtime.

function pcg(v: number): number {
  const s = (Math.imul(v >>> 0, 747796405) + 2891336453) >>> 0;
  const w = Math.imul(((s >>> ((s >>> 28) + 4)) ^ s) >>> 0, 277803737) >>> 0;
  return ((w >>> 22) ^ w) >>> 0;
}

function h01(i: number, seed: number): number {
  return pcg(((i | 0) >>> 0) ^ pcg(seed >>> 0)) / 4294967295;
}

/** Deterministic, time-independent [0, 1) hash of a seed (for `random(seed)`). */
export function hash01(seed: number): number {
  return pcg(seed >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1] at coordinate x for a given seed. */
export function noise1d(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * f * (f * (f * 6 - 15) + 10);
  const a = h01(i, seed);
  const b = h01(i + 1, seed);
  return a + (b - a) * u;
}
