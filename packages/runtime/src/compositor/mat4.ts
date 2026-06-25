// 4×4 transform helpers for the group transform stack (CKP/1.0 §4.4).
//
// Column-major, f64 (plain number[] — NOT Float32Array: the compositor
// math must stay double-precision so 2D documents keep their exact
// CKP/1.0 float behavior). Element e[col*4 + row]:
//
//   [ e0  e4  e8  e12 ]      2D-affine embedding:  a = e0, b = e1,
//   [ e1  e5  e9  e13 ]                            c = e4, d = e5,
//   [ e2  e6  e10 e14 ]                            tx = e12, ty = e13
//   [ e3  e7  e11 e15 ]
//
// The `aff` flag marks matrices whose z/w rows and columns are trivial
// (a pure 2D affine embedded in 4×4). When BOTH operands are affine,
// multiply/apply run the exact same float expressions the Mat3 stack
// used — so documents with no 3D fields and no camera produce
// bit-identical doubles, and therefore byte-identical frames, to the
// CKP/1.0 pipeline (the MAT4-PLAN item-2 equivalence gate). The general
// 16-term path engages only once real 3D enters a chain.
//
// Pure pixel math, no DOMMatrix (absent in some worker environments).
// All operations return new matrices — the stack is push/pop by
// reassignment, never mutation.

import type { Mat4 } from './render-context.js';
import { quadMatrix3D } from './transform.js';

export function mat4Identity(): Mat4 {
  return {
    e: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    aff: true,
  };
}

/**
 * Multiply m1 * m2 — apply m1's transform AFTER m2's. Used when
 * stacking: the parent group's matrix is multiplied by the child's
 * local matrix to get the cumulative one.
 */
export function mat4Multiply(m1: Mat4, m2: Mat4): Mat4 {
  if (m1.aff && m2.aff) {
    const a1 = m1.e[0], b1 = m1.e[1], c1 = m1.e[4], d1 = m1.e[5], tx1 = m1.e[12], ty1 = m1.e[13];
    const a2 = m2.e[0], b2 = m2.e[1], c2 = m2.e[4], d2 = m2.e[5], tx2 = m2.e[12], ty2 = m2.e[13];
    return {
      e: [
        a1 * a2 + c1 * b2, b1 * a2 + d1 * b2, 0, 0,
        a1 * c2 + c1 * d2, b1 * c2 + d1 * d2, 0, 0,
        0, 0, 1, 0,
        a1 * tx2 + c1 * ty2 + tx1, b1 * tx2 + d1 * ty2 + ty1, 0, 1,
      ],
      aff: true,
    };
  }
  const a = m1.e, b = m2.e;
  const e = new Array<number>(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      e[col * 4 + row] =
        a[row] * b[col * 4] +
        a[4 + row] * b[col * 4 + 1] +
        a[8 + row] * b[col * 4 + 2] +
        a[12 + row] * b[col * 4 + 3];
    }
  }
  return { e, aff: false };
}

/**
 * Apply matrix to a point in the z=0 plane: returns [worldX, worldY].
 * General matrices include the perspective divide; affine matrices use
 * the exact 2D expressions.
 */
export function mat4ApplyToPoint(m: Mat4, x: number, y: number): [number, number] {
  if (m.aff) {
    return [m.e[0] * x + m.e[4] * y + m.e[12], m.e[1] * x + m.e[5] * y + m.e[13]];
  }
  const e = m.e;
  const px = e[0] * x + e[4] * y + e[12];
  const py = e[1] * x + e[5] * y + e[13];
  const pw = e[3] * x + e[7] * y + e[15];
  return pw !== 0 && pw !== 1 ? [px / pw, py / pw] : [px, py];
}

/**
 * Extract the in-plane rotation angle (degrees) baked into the matrix —
 * the screen-space angle of the transformed x basis vector.
 */
export function mat4Rotation(m: Mat4): number {
  return Math.atan2(m.e[1], m.e[0]) * (180 / Math.PI);
}

/** Extract the scale factor along the X axis (handles negative scale). */
export function mat4ScaleX(m: Mat4): number {
  return Math.sqrt(m.e[0] * m.e[0] + m.e[1] * m.e[1]);
}

/** Extract the scale factor along the Y axis. */
export function mat4ScaleY(m: Mat4): number {
  return Math.sqrt(m.e[4] * m.e[4] + m.e[5] * m.e[5]);
}

/**
 * Apply the current group stack's transform to a local draw spec.
 * Each element renderer calls this with its locally-computed center
 * coordinates, rotation, and opacity; the helper returns world-space
 * values ready for the backend. When the model matrix is identity (the
 * root case), this is a no-op.
 *
 * Valid ONLY for affine chains — this decomposition cannot represent
 * perspective. 3D subtrees take the full-matrix hand-off instead
 * (MAT4-PLAN items 3/6).
 */
export function applyModelTransform(
  modelMatrix: Mat4,
  opacityFactor: number,
  localCx: number,
  localCy: number,
  localRotation: number,
  localOpacity01: number,
  localWidth: number,
  localHeight: number,
): { cx: number; cy: number; rotation: number; opacity01: number; width: number; height: number } {
  const [cx, cy] = mat4ApplyToPoint(modelMatrix, localCx, localCy);
  return {
    cx,
    cy,
    rotation: localRotation + mat4Rotation(modelMatrix),
    opacity01: localOpacity01 * opacityFactor,
    width: localWidth * mat4ScaleX(modelMatrix),
    height: localHeight * mat4ScaleY(modelMatrix),
  };
}

/**
 * Build a Mat4 for a translate-rotate-scale transform around an anchor
 * point inside a (width × height) box. Mirrors CSS transform semantics
 * with `transform-origin: anchor_x anchor_y`; same float expressions as
 * the CKP/1.0 Mat3 builder.
 *
 *   1. Translate to (x, y)
 *   2. Translate by -(width * x_anchor, height * y_anchor) to put the
 *      anchor point at the position
 *   3. Around the anchor: rotate, scale
 *
 * `anchorX` and `anchorY` are fractions in [0, 1].
 */
/**
 * The CKP/1.0 full-matrix hand-off for leaf quads (§4.4): compose the
 * element's pixel-space local quad matrix (position / size / rotations
 * / skew / z) with the model chain and return the 16 values backends
 * accept as `params.transform`. Renderers call this INSTEAD of
 * applyModelTransform whenever the element carries 3D fields or the
 * chain is no longer affine.
 */
export function quadWorldTransform(
  model: Mat4,
  cx: number,
  cy: number,
  width: number,
  height: number,
  rotationDeg: number,
  skewXDeg: number,
  skewYDeg: number,
  t3d: { xRot: number; yRot: number; z: number } | null,
): number[] {
  const local: Mat4 = {
    e: quadMatrix3D(
      cx, cy, width, height, rotationDeg, skewXDeg, skewYDeg,
      t3d?.xRot ?? 0, t3d?.yRot ?? 0, t3d?.z ?? 0,
    ),
    aff: false,
  };
  return mat4Multiply(model, local).e;
}

/**
 * Pivot-conjugated plane matrix: T(px, py, z) · Rz · Ry · Rx ·
 * T(−px, −py). Multi-quad renderers (text glyphs, caption blocks,
 * particles) compose this ONCE per element so the whole block tilts as
 * a single plane in D1 order (Rz outermost, matching leaf quads), then
 * run their per-quad 2D math unrotated inside it.
 */
export function mat4PlaneAt(
  px: number,
  py: number,
  z: number,
  zRotDeg: number,
  yRotDeg: number,
  xRotDeg: number,
): Mat4 {
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
  return {
    e: [
      c0[0], c0[1], c0[2], 0,
      c1[0], c1[1], c1[2], 0,
      c2[0], c2[1], c2[2], 0,
      px - px * c0[0] - py * c1[0],
      py - px * c0[1] - py * c1[1],
      z - px * c0[2] - py * c1[2],
      1,
    ],
    aff: false,
  };
}

/**
 * 3D variant of mat4TRS for groups carrying CKP/1.0 transform fields
 * (§4.4.1): T(x, y, z) · Rz · Ry · Rx · S(sx, sy, 1) · T(−anchor).
 * Same anchor-pivot semantics as mat4TRS; rotation conventions match
 * quadMatrix3D (Rz clockwise in Y-down pixel space; +y_rotation turns
 * the right edge away; +x_rotation tips the top edge away). Returns a
 * general (non-aff) matrix — chains through it take the full-matrix
 * hand-off, never the 2D decomposition.
 */
export function mat4TRS3D(
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  anchorX: number,
  anchorY: number,
  zRotDeg: number,
  yRotDeg: number,
  xRotDeg: number,
  scaleX: number,
  scaleY: number = scaleX,
): Mat4 {
  const wa = width * anchorX;
  const ha = height * anchorY;
  const rz = (zRotDeg * Math.PI) / 180;
  const ry = (yRotDeg * Math.PI) / 180;
  const rx = (xRotDeg * Math.PI) / 180;
  const cz = Math.cos(rz), sz = Math.sin(rz);
  const cyr = Math.cos(ry), syr = Math.sin(ry);
  const cxr = Math.cos(rx), sxr = Math.sin(rx);
  // Rz·Ry·Rx applied to a vector (vx, vy, vz):
  //   Rx: (vx, vy·cx − vz·sx, vy·sx + vz·cx)
  //   Ry: (x·cy + z·sy, y, −x·sy + z·cy)
  //   Rz (CW, Y-down): (x·cz − y·sz, x·sz + y·cz, z)
  const rot = (vx: number, vy: number, vz: number): [number, number, number] => {
    const y1 = vy * cxr - vz * sxr;
    const z1 = vy * sxr + vz * cxr;
    const x2 = vx * cyr + z1 * syr;
    const z2 = -vx * syr + z1 * cyr;
    return [x2 * cz - y1 * sz, x2 * sz + y1 * cz, z2];
  };
  const c0 = rot(scaleX, 0, 0);
  const c1 = rot(0, scaleY, 0);
  const c2 = rot(0, 0, 1);
  return {
    e: [
      c0[0], c0[1], c0[2], 0,
      c1[0], c1[1], c1[2], 0,
      c2[0], c2[1], c2[2], 0,
      x - wa * c0[0] - ha * c1[0],
      y - wa * c0[1] - ha * c1[1],
      z - wa * c0[2] - ha * c1[2],
      1,
    ],
    aff: false,
  };
}

export function mat4TRS(
  x: number,
  y: number,
  width: number,
  height: number,
  anchorX: number,
  anchorY: number,
  rotationDeg: number,
  scaleX: number,
  scaleY: number = scaleX,
): Mat4 {
  const ax = width * anchorX;
  const ay = height * anchorY;
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // Translate(x, y) * Rotate(θ) * Scale(sx, sy) * Translate(-ax, -ay)
  const a = cos * scaleX;
  const b = sin * scaleX;
  const c = -sin * scaleY;
  const d = cos * scaleY;
  return {
    e: [
      a, b, 0, 0,
      c, d, 0, 0,
      0, 0, 1, 0,
      x + a * -ax + c * -ay, y + b * -ax + d * -ay, 0, 1,
    ],
    aff: true,
  };
}
