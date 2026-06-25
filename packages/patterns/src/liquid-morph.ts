// liquidMorph — flow ONE path-form `shape` through a sequence of shapes, so a
// shape stretches into a travelling path and reforms as the next shape (the
// "shape → moving path → shape" move from the Transition Tour).
//
// The motion reads as LIQUID because each morph passes through a "blob": the
// half-way corners rounded as much as possible, so the path swells and flows
// instead of sliding in a straight line. The blob is a flow-THROUGH waypoint
// (accelerate in, decelerate out) — never a stop — so a hop A→B is one
// continuous motion, not two.
//
// Every shape is a rounded polygon with the SAME number of corners in the same
// order, so any two morph point-for-point with no twist (a triangle/arrow uses
// a hidden collinear corner to reach the shared count). The end shapes are
// exact; only the in-between is liquid.
//
// Emits ONE primitive `shape` element with a keyframed `paths[].d`. The runtime
// never sees "liquidMorph" — it's authoring-time sugar over the protocol.

import type { Element, Keyframe, Easing } from '@clipkit/protocol';

type Pt = [number, number];

/** One waypoint in the flow. */
export interface MorphShape {
  /**
   * Corner points (clockwise) in `view_box` units. EVERY shape in the flow
   * MUST have the same number of corners so they morph role-for-role. For a
   * triangle/arrow, repeat a collinear point to pad to the shared count.
   */
  corners: Pt[];
  /** Corner radius (view_box units). Clamped per corner to half the shorter edge. */
  radius?: number;
  /** Comp time (seconds) at which this shape is fully formed. */
  at: number;
  /** Hold this shape for N seconds after `at` before morphing onward. Default 0. */
  hold?: number;
  /** Easing as this shape settles. Default `'ease-out-sine'` (a flow-through). */
  easing?: Easing;
}

export interface LiquidMorphProps {
  id: string;
  /** Shapes to flow through, in order. Need at least 2. */
  shapes: MorphShape[];
  /** Fill color (hex) or `"url(#id)"`. */
  fill: string;
  /** Center + box (the path's `view_box` maps onto this). */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Path coordinate space. Default `[0, 0, width, height]`. */
  view_box?: [number, number, number, number];
  layer?: number;
  /** Element start time. Default 0 (so `at` values read as comp time). */
  time?: number;
  duration: number;
  /**
   * How liquid the in-between is: 0 = straight morph (no blob), 1 = maximally
   * round blob swell. Default 1.
   */
  liquidity?: number;
  /** Extra fields merged onto the element (e.g. `opacity`, `keyframe_animations`). */
  extra?: Partial<Element>;
}

const unit = (a: Pt, b: Pt): Pt => {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
  return [dx / L, dy / L];
};
const r1 = (x: number) => Math.round(x * 10) / 10;

// Corners + radius → `M + N·(L Q) + Z`. Same N ⇒ two paths morph. Each corner
// is one smooth quadratic; radius clamps to half the shorter edge so tight
// corners can't overlap (no balls/nubs).
function roundPoly(corners: Pt[], radius: number): string {
  const n = corners.length;
  const s = corners.map((c, i) => {
    const prev = corners[(i - 1 + n) % n]!, next = corners[(i + 1) % n]!;
    const rr = Math.min(radius, Math.hypot(c[0] - prev[0], c[1] - prev[1]) / 2, Math.hypot(c[0] - next[0], c[1] - next[1]) / 2);
    const di = unit(c, prev), doo = unit(c, next);
    return { i: [c[0] + di[0] * rr, c[1] + di[1] * rr] as Pt, c, o: [c[0] + doo[0] * rr, c[1] + doo[1] * rr] as Pt };
  });
  let d = `M ${r1(s[0]!.o[0])} ${r1(s[0]!.o[1])}`;
  for (let k = 1; k <= n; k++) {
    const v = s[k % n]!;
    d += ` L ${r1(v.i[0])} ${r1(v.i[1])} Q ${r1(v.c[0])} ${r1(v.c[1])} ${r1(v.o[0])} ${r1(v.o[1])}`;
  }
  return d + ' Z';
}

const lerpC = (a: Pt[], b: Pt[], t: number): Pt[] =>
  a.map((p, i) => [p[0] + (b[i]![0] - p[0]) * t, p[1] + (b[i]![1] - p[1]) * t] as Pt);

// The liquid in-between: the half-way corners rounded by `liquidity` (1 = max).
const blob = (a: Pt[], b: Pt[], liquidity: number): string =>
  roundPoly(lerpC(a, b, 0.5), 999 * liquidity);

/**
 * Flow a path-form `shape` through `shapes`, liquid morphs between each.
 *
 * @example
 * // a triangle → a line that streaks off-screen left → a play arrow
 * liquidMorph({
 *   id: 'flow', fill: '#EF4444',
 *   x: 960, y: 540, width: 1920, height: 1080, duration: 6,
 *   shapes: [
 *     { corners: TRIANGLE, radius: 16, at: 0, hold: 1 },
 *     { corners: LINE,     radius: 20, at: 1.5, hold: 0.5 },  // the "moving path"
 *     { corners: PLAY,     radius: 16, at: 2.7 },
 *   ],
 * });
 */
export function liquidMorph(props: LiquidMorphProps): Element {
  const {
    id, shapes, fill, x, y, width, height, duration,
    view_box = [0, 0, width, height],
    layer = 1,
    time = 0,
    liquidity = 1,
    extra,
  } = props;

  if (shapes.length < 2) throw new Error('liquidMorph: need at least 2 shapes');
  const n = shapes[0]!.corners.length;
  for (const s of shapes) {
    if (s.corners.length !== n) {
      throw new Error(`liquidMorph: every shape needs ${n} corners (got ${s.corners.length}); pad triangles/arrows with a collinear point`);
    }
  }

  const d: Keyframe[] = [];
  const first = shapes[0]!;
  const d0 = roundPoly(first.corners, first.radius ?? 0);
  d.push({ time: first.at, value: d0 });
  let prevEnd = first.at;
  if (first.hold) { prevEnd = first.at + first.hold; d.push({ time: prevEnd, value: d0 }); }

  for (let i = 1; i < shapes.length; i++) {
    const s = shapes[i]!, p = shapes[i - 1]!;
    const dTarget = roundPoly(s.corners, s.radius ?? 0);
    if (liquidity > 0) {
      // Flow through a blob at the time-midpoint: accelerate in, decelerate out.
      const mid = (prevEnd + s.at) / 2;
      d.push({ time: mid, value: blob(p.corners, s.corners, liquidity), easing: 'ease-in-sine' });
      d.push({ time: s.at, value: dTarget, easing: s.easing ?? 'ease-out-sine' });
    } else {
      d.push({ time: s.at, value: dTarget, easing: s.easing ?? 'ease-in-out-sine' });
    }
    prevEnd = s.at;
    if (s.hold) { prevEnd = s.at + s.hold; d.push({ time: prevEnd, value: dTarget }); }
  }

  return {
    id,
    type: 'shape',
    layer,
    time,
    duration,
    x,
    y,
    x_anchor: '50%',
    y_anchor: '50%',
    width,
    height,
    view_box,
    paths: [{ fill, d }],
    ...extra,
  } as Element;
}
