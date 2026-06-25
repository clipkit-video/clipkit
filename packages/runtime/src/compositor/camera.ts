// Scene camera (CKP/1.0 §4.4.2).
//
// The camera is the ROOT model matrix: a perspective lens P composed
// with an optional rigid pose V (the inverse camera transform), so the
// matrix applied at the root is `camera = P · V`.
//
// Lens P — CSS Transforms Level 2 perspective, in pixel space, about
// the origin (default canvas center):
//
//   P = T(ox, oy) · [1 0 0 0; 0 1 0 0; 0 0 1 0; 0 0 −1/d 1] · T(−ox, −oy)
//
// Pose V — the inverse of the camera's rigid world transform, taken
// about the origin (eye position e = (x,y,z), orientation R = Rz·Ry·Rx):
//
//   V = T(o) · R⁻¹ · T(−e) · T(−o)
//
// Identity pose (e = 0, R = I) ⇒ V = I ⇒ `camera = P` BIT-FOR-BIT: the
// trivial-pose fast path returns P unchanged, so lens-only documents
// (incl. animated perspective) render identically to a pre-pose runtime,
// and a document with no camera at all keeps the exact 2D path. The two
// consequences the rest of the pipeline leans on hold under P:
//   - z = 0 content is untouched (w stays 1, xy identity).
//   - Layers never see the camera: group layer rendering resets the
//     model matrix to identity (the §4.4.3 flattening rule).

import type { Camera, Keyframe, Expr } from '@clipkit/protocol';
import { interpolateKeyframes } from '../animation/keyframes.js';
import { isExpr, evalExpr } from '../animation/expr.js';
import { resolveLength, type CanvasDimensions } from './unit.js';
import { mat4Multiply } from './mat4.js';
import type { Mat4 } from './render-context.js';

/** Resolve a scalar pose field (number | Keyframe[] | Expr | undefined) at `time`.
 *  Camera expressions see `t` only (no per-element index/duration). */
function resolveScalar(
  field: number | Keyframe[] | Expr | undefined,
  time: number,
  fallback = 0,
): number {
  if (field === undefined) return fallback;
  if (isExpr(field)) return evalExpr(field, { t: time, dur: 0, i: 0, n: 1, value: fallback });
  return Array.isArray(field) ? interpolateKeyframes(field, time) : field;
}

/** Pure translation. */
function translate(tx: number, ty: number, tz: number): Mat4 {
  return { e: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, tx, ty, tz, 1], aff: false };
}

/**
 * Inverse of R = Rz·Ry·Rx (degrees). A rotation matrix is orthonormal,
 * so its inverse is its transpose — we build R's columns with the shared
 * Rz·Ry·Rx convention (matching mat4TRS3D / quadMatrix3D) and transpose
 * the 3×3 in place. Exact (no division).
 */
function rotationInverse(zRotDeg: number, yRotDeg: number, xRotDeg: number): Mat4 {
  const rz = (zRotDeg * Math.PI) / 180;
  const ry = (yRotDeg * Math.PI) / 180;
  const rx = (xRotDeg * Math.PI) / 180;
  const cz = Math.cos(rz), sz = Math.sin(rz);
  const cyr = Math.cos(ry), syr = Math.sin(ry);
  const cxr = Math.cos(rx), sxr = Math.sin(rx);
  const rot = (vx: number, vy: number, vz: number): [number, number, number] => {
    const y1 = vy * cxr - vz * sxr;
    const z1 = vy * sxr + vz * cxr;
    const x2 = vx * cyr + z1 * syr;
    const z2 = -vx * syr + z1 * cyr;
    return [x2 * cz - y1 * sz, x2 * sz + y1 * cz, z2];
  };
  const c0 = rot(1, 0, 0);
  const c1 = rot(0, 1, 0);
  const c2 = rot(0, 0, 1);
  // Transpose: row i of R becomes column i of R⁻¹.
  return {
    e: [
      c0[0], c1[0], c2[0], 0,
      c0[1], c1[1], c2[1], 0,
      c0[2], c1[2], c2[2], 0,
      0, 0, 0, 1,
    ],
    aff: false,
  };
}

export function cameraMatrix(camera: Camera, time: number, canvas: CanvasDimensions): Mat4 {
  let d = resolveScalar(camera.perspective, time, 1e-3);
  // Validation enforces > 0 on the static form; an animated curve could
  // still dip non-positive mid-flight. Clamp rather than divide by zero
  // — at d → 0 everything is degenerate anyway.
  if (!Number.isFinite(d) || d < 1e-3) d = 1e-3;
  const ox = camera.origin_x !== undefined
    ? resolveLength(camera.origin_x as never, canvas.width, canvas)
    : canvas.width / 2;
  const oy = camera.origin_y !== undefined
    ? resolveLength(camera.origin_y as never, canvas.height, canvas)
    : canvas.height / 2;

  // Lens P (today's matrix — unchanged).
  const P: Mat4 = {
    e: [
      1, 0, 0, 0,
      0, 1, 0, 0,
      -ox / d, -oy / d, 1, -1 / d,
      0, 0, 0, 1,
    ],
    aff: false,
  };

  // Pose. Trivial pose ⇒ return P unchanged (byte-exact reduction).
  const ex = resolveScalar(camera.x, time);
  const ey = resolveScalar(camera.y, time);
  const ez = resolveScalar(camera.z, time);
  const rxr = resolveScalar(camera.x_rotation, time);
  const ryr = resolveScalar(camera.y_rotation, time);
  const rzr = resolveScalar(camera.z_rotation, time);
  if (ex === 0 && ey === 0 && ez === 0 && rxr === 0 && ryr === 0 && rzr === 0) {
    return P;
  }

  // V = T(o) · R⁻¹ · T(−e) · T(−o).
  const V = mat4Multiply(
    mat4Multiply(
      mat4Multiply(translate(ox, oy, 0), rotationInverse(rzr, ryr, rxr)),
      translate(-ex, -ey, -ez),
    ),
    translate(-ox, -oy, 0),
  );

  // camera = P · V.
  return mat4Multiply(P, V);
}
