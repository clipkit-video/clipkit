// Spatial motion paths (§6.7) — `keyframe_animations` entries with
// `property: "position"` and [x, y] or [x, y, z] keyframe values.
//
// Each pair of consecutive keyframes is a cubic bezier segment:
//   P0 = a.value                  P3 = b.value
//   P1 = P0 + a.out_tangent       P2 = P3 + b.in_tangent
// with omitted tangents defaulting to the straight-line third-points
// (P1 = P0 + (P3−P0)/3, P2 = P3 − (P3−P0)/3) so handle-less paths are
// exact polyline motion. On a 3D path a 2-component tangent's z
// defaults to the straight-line third-point in z.
//
// Travel is ARC-LENGTH parameterized (normative): the destination
// keyframe's easing maps segment-local time to a fraction u of the
// segment's LENGTH, and the bezier parameter t is found on a 64-chord
// cumulative-length table (linear interpolation between chords). With
// linear easing the element moves at constant speed regardless of how
// the handles stretch the parameterization. 3D paths measure 3D chord
// lengths; 2D paths run the exact 2D expressions (byte-stable).
//
// auto_orient is strictly in-plane (§6.7): the tangent's xy projection
// drives z_rotation; dz never derives x_rotation/y_rotation.

import type { BaseElement, Keyframe, KeyframeAnimation } from '@clipkit/protocol';
import { applyEasing } from './easings.js';

export interface MotionPathSample {
  x: number;
  y: number;
  /** Path z for 3D paths (§6.7); null on 2D paths — element `z` untouched. */
  z: number | null;
  /** Path travel direction at the sample, degrees (atan2(dy, dx) — xy projection). */
  angle: number;
  /** Whether the animation requested auto-orientation. */
  autoOrient: boolean;
}

type Vec2 = readonly [number, number];
type Vec3 = readonly [number, number, number];

const CHORDS = 64;

function isSpatial(v: unknown): v is [number, number] | [number, number, number] {
  return (
    Array.isArray(v) &&
    (v.length === 2 || v.length === 3) &&
    v.every((n) => typeof n === 'number')
  );
}

function numberOr(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

function bezier(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): [number, number] {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return [
    a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
    a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
  ];
}

function bezierDeriv(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): [number, number] {
  const mt = 1 - t;
  const a = 3 * mt * mt;
  const b = 6 * mt * t;
  const c = 3 * t * t;
  return [
    a * (p1[0] - p0[0]) + b * (p2[0] - p1[0]) + c * (p3[0] - p2[0]),
    a * (p1[1] - p0[1]) + b * (p2[1] - p1[1]) + c * (p3[1] - p2[1]),
  ];
}

function controlPoints(a: Keyframe, b: Keyframe): [Vec2, Vec2, Vec2, Vec2] {
  const p0 = a.value as [number, number];
  const p3 = b.value as [number, number];
  const p1: Vec2 = a.out_tangent
    ? [p0[0] + a.out_tangent[0], p0[1] + a.out_tangent[1]]
    : [p0[0] + (p3[0] - p0[0]) / 3, p0[1] + (p3[1] - p0[1]) / 3];
  const p2: Vec2 = b.in_tangent
    ? [p3[0] + b.in_tangent[0], p3[1] + b.in_tangent[1]]
    : [p3[0] - (p3[0] - p0[0]) / 3, p3[1] - (p3[1] - p0[1]) / 3];
  return [p0, p1, p2, p3];
}

/** Sample one 2D segment at length-fraction u ∈ [0, 1]. */
function sampleSegment(a: Keyframe, b: Keyframe, u: number): { point: [number, number]; angle: number } {
  const [p0, p1, p2, p3] = controlPoints(a, b);

  // 64-chord cumulative length table (normative).
  const lengths = new Float64Array(CHORDS + 1);
  let prev = p0 as [number, number];
  for (let i = 1; i <= CHORDS; i++) {
    const pt = bezier(p0, p1, p2, p3, i / CHORDS);
    lengths[i] = lengths[i - 1]! + Math.hypot(pt[0] - prev[0], pt[1] - prev[1]);
    prev = pt;
  }
  const total = lengths[CHORDS]!;

  let t: number;
  if (total <= 0) {
    t = u; // degenerate (all points coincide)
  } else {
    const target = u * total;
    let i = 1;
    while (i < CHORDS && lengths[i]! < target) i++;
    const l0 = lengths[i - 1]!;
    const l1 = lengths[i]!;
    const f = l1 > l0 ? (target - l0) / (l1 - l0) : 0;
    t = (i - 1 + f) / CHORDS;
  }

  const point = bezier(p0, p1, p2, p3, t);
  let [dx, dy] = bezierDeriv(p0, p1, p2, p3, t);
  if (dx === 0 && dy === 0) {
    // Degenerate derivative (coincident control points) — fall back to
    // the segment's chord direction.
    dx = p3[0] - p0[0];
    dy = p3[1] - p0[1];
  }
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  return { point, angle };
}

// ── 3D variants (§6.7 3D paths) ─────────────────────────────────────

function vec3Of(v: [number, number] | [number, number, number]): Vec3 {
  return [v[0], v[1], v.length === 3 ? v[2] : 0];
}

function bezier3(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, t: number): [number, number, number] {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return [
    a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
    a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
    a * p0[2] + b * p1[2] + c * p2[2] + d * p3[2],
  ];
}

function bezierDeriv3(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, t: number): [number, number, number] {
  const mt = 1 - t;
  const a = 3 * mt * mt;
  const b = 6 * mt * t;
  const c = 3 * t * t;
  return [
    a * (p1[0] - p0[0]) + b * (p2[0] - p1[0]) + c * (p3[0] - p2[0]),
    a * (p1[1] - p0[1]) + b * (p2[1] - p1[1]) + c * (p3[1] - p2[1]),
    a * (p1[2] - p0[2]) + b * (p2[2] - p1[2]) + c * (p3[2] - p2[2]),
  ];
}

function controlPoints3(a: Keyframe, b: Keyframe): [Vec3, Vec3, Vec3, Vec3] {
  const p0 = vec3Of(a.value as [number, number] | [number, number, number]);
  const p3 = vec3Of(b.value as [number, number] | [number, number, number]);
  // A 2-component handle's z defaults to the straight-line third-point
  // in z (mirrors the fully-omitted-handle rule, per axis).
  const ot = a.out_tangent;
  const p1: Vec3 = ot
    ? [p0[0] + ot[0], p0[1] + ot[1], ot.length === 3 ? p0[2] + ot[2] : p0[2] + (p3[2] - p0[2]) / 3]
    : [p0[0] + (p3[0] - p0[0]) / 3, p0[1] + (p3[1] - p0[1]) / 3, p0[2] + (p3[2] - p0[2]) / 3];
  const it = b.in_tangent;
  const p2: Vec3 = it
    ? [p3[0] + it[0], p3[1] + it[1], it.length === 3 ? p3[2] + it[2] : p3[2] - (p3[2] - p0[2]) / 3]
    : [p3[0] - (p3[0] - p0[0]) / 3, p3[1] - (p3[1] - p0[1]) / 3, p3[2] - (p3[2] - p0[2]) / 3];
  return [p0, p1, p2, p3];
}

/** Sample one 3D segment at length-fraction u ∈ [0, 1]. */
function sampleSegment3(
  a: Keyframe,
  b: Keyframe,
  u: number,
): { point: [number, number, number]; angle: number } {
  const [p0, p1, p2, p3] = controlPoints3(a, b);

  // 64-chord cumulative length table over the 3D curve (normative).
  const lengths = new Float64Array(CHORDS + 1);
  let prev = p0 as [number, number, number];
  for (let i = 1; i <= CHORDS; i++) {
    const pt = bezier3(p0, p1, p2, p3, i / CHORDS);
    lengths[i] = lengths[i - 1]! + Math.hypot(pt[0] - prev[0], pt[1] - prev[1], pt[2] - prev[2]);
    prev = pt;
  }
  const total = lengths[CHORDS]!;

  let t: number;
  if (total <= 0) {
    t = u;
  } else {
    const target = u * total;
    let i = 1;
    while (i < CHORDS && lengths[i]! < target) i++;
    const l0 = lengths[i - 1]!;
    const l1 = lengths[i]!;
    const f = l1 > l0 ? (target - l0) / (l1 - l0) : 0;
    t = (i - 1 + f) / CHORDS;
  }

  const point = bezier3(p0, p1, p2, p3, t);
  let [dx, dy] = bezierDeriv3(p0, p1, p2, p3, t);
  if (dx === 0 && dy === 0) {
    // Degenerate xy derivative (z-only travel or coincident control
    // points) — fall back to the segment chord's xy projection; if
    // that is zero too the angle is 0 by atan2 convention.
    dx = p3[0] - p0[0];
    dy = p3[1] - p0[1];
  }
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  return { point, angle };
}

/**
 * Resolve the element's `position` motion path at element-local time.
 * Returns null when the element has no position path. Endpoint clamps
 * hold the first/last point with the adjacent segment's end tangent.
 */
export function resolveMotionPath(
  element: BaseElement,
  localTime: number,
): MotionPathSample | null {
  const anims = element.keyframe_animations as KeyframeAnimation[] | undefined;
  if (!anims) return null;
  const anim = anims.find((a) => a.property === 'position');
  if (!anim) return null;
  const kfs = anim.keyframes.filter((k) => isSpatial(k.value));
  if (kfs.length === 0) return null;
  const autoOrient = anim.auto_orient === true;

  // A path is 3D when any keyframe carries [x, y, z] (validation
  // requires agreement; the `some` is runtime defensiveness).
  if (kfs.some((k) => (k.value as number[]).length === 3)) {
    return resolve3DPath(kfs, anim, localTime, autoOrient);
  }

  if (kfs.length === 1) {
    const p = kfs[0]!.value as [number, number];
    return { x: p[0], y: p[1], z: null, angle: 0, autoOrient };
  }

  const first = kfs[0]!;
  const last = kfs[kfs.length - 1]!;
  if (localTime <= numberOr(first.time, 0)) {
    const { point, angle } = sampleSegment(first, kfs[1]!, 0);
    return { x: point[0], y: point[1], z: null, angle, autoOrient };
  }
  if (localTime >= numberOr(last.time, 0)) {
    const { point, angle } = sampleSegment(kfs[kfs.length - 2]!, last, 1);
    return { x: point[0], y: point[1], z: null, angle, autoOrient };
  }

  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i]!;
    const b = kfs[i + 1]!;
    const at = numberOr(a.time, 0);
    const bt = numberOr(b.time, 0);
    if (localTime >= at && localTime <= bt) {
      const span = bt - at;
      const localT = span > 0 ? (localTime - at) / span : 0;
      const u = applyEasing(b.easing, localT);
      const { point, angle } = sampleSegment(a, b, u);
      return { x: point[0], y: point[1], z: null, angle, autoOrient };
    }
  }

  const p = last.value as [number, number];
  return { x: p[0], y: p[1], z: null, angle: 0, autoOrient };
}

function resolve3DPath(
  kfs: Keyframe[],
  anim: KeyframeAnimation,
  localTime: number,
  autoOrient: boolean,
): MotionPathSample {
  if (kfs.length === 1) {
    const p = vec3Of(kfs[0]!.value as [number, number] | [number, number, number]);
    return { x: p[0], y: p[1], z: p[2], angle: 0, autoOrient };
  }

  const first = kfs[0]!;
  const last = kfs[kfs.length - 1]!;
  if (localTime <= numberOr(first.time, 0)) {
    const { point, angle } = sampleSegment3(first, kfs[1]!, 0);
    return { x: point[0], y: point[1], z: point[2], angle, autoOrient };
  }
  if (localTime >= numberOr(last.time, 0)) {
    const { point, angle } = sampleSegment3(kfs[kfs.length - 2]!, last, 1);
    return { x: point[0], y: point[1], z: point[2], angle, autoOrient };
  }

  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i]!;
    const b = kfs[i + 1]!;
    const at = numberOr(a.time, 0);
    const bt = numberOr(b.time, 0);
    if (localTime >= at && localTime <= bt) {
      const span = bt - at;
      const localT = span > 0 ? (localTime - at) / span : 0;
      const u = applyEasing(b.easing, localT);
      const { point, angle } = sampleSegment3(a, b, u);
      return { x: point[0], y: point[1], z: point[2], angle, autoOrient };
    }
  }

  const p = vec3Of(last.value as [number, number] | [number, number, number]);
  return { x: p[0], y: p[1], z: p[2], angle: 0, autoOrient };
}
