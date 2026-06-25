// 4×4 transform matrix utilities for compositor → NDC.
//
// The matrix is column-major (matching WGSL `mat4x4<f32>` and GLSL ES 3.0
// `mat4`). All operations return new Float32Array(16) values — no mutation.
//
// The unit quad we draw spans NDC (-1, -1) to (+1, +1). composeQuadTransform
// takes a pixel-space rectangle (centerX, centerY, width, height) plus
// rotation and produces a matrix that maps the unit quad to that rectangle
// in NDC space. Y is flipped (canvas Y grows down, NDC Y grows up).

export type Mat4 = Float32Array;

/** Identity 4×4 matrix. */
export function identity(): Mat4 {
  // prettier-ignore
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
}

/**
 * Build the transform that places a unit quad (-1..+1) at a pixel-space
 * rectangle, expressed in NDC.
 *
 * @param cx        Rectangle center X in canvas pixels.
 * @param cy        Rectangle center Y in canvas pixels.
 * @param w         Rectangle width in canvas pixels.
 * @param h         Rectangle height in canvas pixels.
 * @param rotation  Rotation in degrees, around the rectangle center.
 * @param canvasW   Canvas (composition) width in pixels.
 * @param canvasH   Canvas (composition) height in pixels.
 */
export function composeQuadTransform(
  cx: number,
  cy: number,
  w: number,
  h: number,
  rotation: number,
  canvasW: number,
  canvasH: number,
  skewXDeg: number = 0,
  skewYDeg: number = 0,
  /**
   * Negate the output Y axis. Used when rendering into a WebGL
   * framebuffer texture: GL stores texel row 0 at the BOTTOM, so
   * without the flip the rendered layer samples upside-down relative
   * to uploaded images. WebGPU render targets don't need this.
   */
  flipY: boolean = false,
): Mat4 {
  // Pixel center → NDC. NDC X spans [-1, +1] over [0, canvasW] pixels.
  // Y is flipped: pixel y=0 → NDC y=+1, pixel y=canvasH → NDC y=-1.
  const ndcX = (cx / canvasW) * 2 - 1;
  const ndcY = -((cy / canvasH) * 2 - 1);

  // Composition (right-to-left, applied to the unit-quad input):
  //
  //   D(2/canvasW, -2/canvasH)  ·  R(θ)  ·  D(w/2, h/2)  ·  SkewX(φ)
  //   └─ pixel → NDC + Y flip ┘  └─ rotate┘  └─ pixel size ┘  └─ shear ─┘
  //
  // SkewX runs on the un-scaled unit quad: a vertex (px, py) becomes
  // (px + py·tan(φ), py). Composing with scale + rotate + NDC produces
  // a parallelogram in screen space whose top edge is sheared by w·tan(φ)
  // pixels relative to the bottom.
  //
  // R is [[cos, -sin], [sin, cos]] in Y-down screen space — same CW
  // convention CSS rotate() uses. The unit quad's Y-up convention is
  // absorbed by the Y flip in the NDC step (the -2/canvasH below).
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // CSS skewX uses Y-down (positive Y = bottom) while our unit quad is
  // Y-up (a_pos.y = +1 = top). Negate so the protocol's `skew_x`
  // follows CSS semantics: positive shears bottom right, negative
  // shears bottom left — matching `transform: skewX(...)`.
  const tanSkew = Math.tan((-skewXDeg * Math.PI) / 180);

  const col0x = (w * cos) / canvasW;
  const col0y = -(w * sin) / canvasH;
  const col1xNoSkew = (h * sin) / canvasW;
  const col1yNoSkew = (h * cos) / canvasH;
  // CSS skewX shifts X by `tan(angle) · height`, not `tan(angle) ·
  // width`. The skew offset vector points along the rotated X axis
  // with magnitude proportional to h — using col0 (which is w-scaled)
  // would make the slant grow with the band's WIDTH, so longer text
  // looked dramatically more tilted than short text at the same
  // nominal angle. Scale by h/w to get the height-scaled X direction.
  const hOverW = w !== 0 ? h / w : 0;
  const col1x = col1xNoSkew + tanSkew * col0x * hOverW;
  const col1y = col1yNoSkew + tanSkew * col0y * hOverW;

  // CSS skewY shifts Y by `tan(angle) · width` — the mirror of skewX.
  // The local +Y(down) direction in output space is -col1NoSkew (the
  // unit quad's uy=+1 maps to local -h/2 after the Y flip), so a
  // CSS-positive skewY (right edge moves down) subtracts the
  // width-scaled col1NoSkew direction from col0.
  const tanSkewY = Math.tan((skewYDeg * Math.PI) / 180);
  const wOverH = h !== 0 ? w / h : 0;
  const col0xSkewed = col0x - tanSkewY * col1xNoSkew * wOverH;
  const col0ySkewed = col0y - tanSkewY * col1yNoSkew * wOverH;

  const ySign = flipY ? -1 : 1;

  // prettier-ignore
  return new Float32Array([
    // column 0 — what unit-quad (1, 0) contributes (skewY-sheared)
    col0xSkewed, col0ySkewed * ySign, 0, 0,
    // column 1 — what unit-quad (0, 1) contributes (skewX-sheared)
    col1x, col1y * ySign, 0, 0,
    // column 2 — Z axis untouched
    0, 0, 1, 0,
    // column 3 — translation to NDC center
    ndcX, ndcY * ySign, 0, 1,
  ]);
}

/**
 * Build the PIXEL-SPACE matrix that places the shared unit quad
 * (a_pos ∈ [-1, +1]², Y-up) at a pixel rectangle with the full CKP/1.0
 * 3D local transform (§4.4.1):
 *
 *   L = T(cx, cy, z) · Rz(θ) · Ry(β) · Rx(α) · K(skewX, skewY) · S(w/2, h/2) · F
 *
 * F converts the quad's Y-up convention to Y-down pixel space; K is the
 * CSS skew (x += tan(skewX)·y, y += tan(skewY)·x in Y-down pixels) —
 * for α = β = z = 0 this reproduces composeQuadTransform's geometry
 * exactly (verified by the 3D probes' z_rotation-alias hash check at
 * the resolution level — the 2D fast path never routes through here).
 *
 * Output is f64 number[16] column-major, Y-down pixel coords, z in
 * pixels (+z toward the viewer). Multiply with the model chain, then
 * feed projectPixelMatrix to reach the shader.
 */
export function quadMatrix3D(
  cx: number,
  cy: number,
  w: number,
  h: number,
  rotationDeg: number,
  skewXDeg: number,
  skewYDeg: number,
  xRotDeg: number,
  yRotDeg: number,
  z: number,
): number[] {
  const rz = (rotationDeg * Math.PI) / 180;
  const rx = (xRotDeg * Math.PI) / 180;
  const ry = (yRotDeg * Math.PI) / 180;
  const cz = Math.cos(rz), sz = Math.sin(rz);
  const cxr = Math.cos(rx), sxr = Math.sin(rx);
  const cyr = Math.cos(ry), syr = Math.sin(ry);
  const tanX = Math.tan((skewXDeg * Math.PI) / 180);
  const tanY = Math.tan((skewYDeg * Math.PI) / 180);

  // Basis vectors of K·S·F applied to a_pos (1,0) and (0,1), plus z.
  // a_pos (1,0) → S·F → (w/2, 0)   → K → (w/2, tanY·w/2)
  // a_pos (0,1) → S·F → (0, -h/2)  → K → (-tanX·h/2, -h/2)
  const b0x = w / 2, b0y = (tanY * w) / 2;
  const b1x = (-tanX * h) / 2, b1y = -h / 2;

  // Rotate each basis vector (z = 0 in the element plane) through
  // Rz·Ry·Rx. Rx: (x, y·c−z·s, y·s+z·c); Ry: (x·c+z·s, y, −x·s+z·c);
  // Rz (CW in Y-down): (x·c − y·s, x·s + y·c, z).
  const rot = (x: number, y: number): [number, number, number] => {
    // Rx
    const y1 = y * cxr;
    const z1 = y * sxr;
    // Ry
    const x2 = x * cyr + z1 * syr;
    const z2 = -x * syr + z1 * cyr;
    // Rz
    return [x2 * cz - y1 * sz, x2 * sz + y1 * cz, z2];
  };
  const [c0x, c0y, c0z] = rot(b0x, b0y);
  const [c1x, c1y, c1z] = rot(b1x, b1y);

  // prettier-ignore
  return [
    c0x, c0y, c0z, 0,
    c1x, c1y, c1z, 0,
    // The element plane's normal (Rz·Ry·Rx applied to ẑ). The flat quad
    // itself never reads it (a_pos has z = 0), but parent·child mat4
    // multiplication does — nested 3D chains route the child's z
    // components through this column, so it must be exact.
    syr * cxr * cz + sxr * sz, syr * cxr * sz - sxr * cz, cyr * cxr, 0,
    cx, cy, z, 1,
  ];
}

/**
 * Project a pixel-space matrix (from quadMatrix3D · model chain ·
 * optional camera) to the surface's clip space: x/y map to NDC, w is
 * preserved for the rasterizer's perspective divide, and clip z is
 * zeroed (paint-order compositing — depth never clips, §4.4.3).
 */
export function projectPixelMatrix(
  m: ArrayLike<number>,
  surfaceW: number,
  surfaceH: number,
  flipY: boolean = false,
): Mat4 {
  const sy = flipY ? -1 : 1;
  const kx = 2 / surfaceW;
  const ky = (-2 / surfaceH) * sy;
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    const mx = m[c * 4] as number;
    const my = m[c * 4 + 1] as number;
    const mw = m[c * 4 + 3] as number;
    out[c * 4] = kx * mx - mw;
    out[c * 4 + 1] = ky * my + sy * mw;
    out[c * 4 + 2] = 0;
    out[c * 4 + 3] = mw;
  }
  return out;
}

/**
 * Convert an anchor-based pixel position to the rectangle center.
 *
 * The schema places elements by their anchor (0..1) within the element.
 * x_anchor: 0 means `x` is the left edge; 0.5 means `x` is the center;
 * 1 means `x` is the right edge.
 */
export function anchorToCenter(
  x: number,
  y: number,
  w: number,
  h: number,
  xAnchor: number,
  yAnchor: number,
): { cx: number; cy: number } {
  return {
    cx: x + w * (0.5 - xAnchor),
    cy: y + h * (0.5 - yAnchor),
  };
}

/**
 * Rescale a pane→surface homography (column-major 3×3, LOGICAL px on
 * both sides) to physical px on both sides:
 * H' = diag(pr, pr, 1) · H · diag(1/pr, 1/pr, 1).
 * The glass shader works in physical px throughout (paneHalf, radii
 * and shadow params are pre-scaled by the pixel ratio).
 */
export function homographyToPhysical(h: ArrayLike<number>, pr: number): Float32Array {
  return new Float32Array([
    h[0]!, h[1]!, h[2]! / pr,
    h[3]!, h[4]!, h[5]! / pr,
    h[6]! * pr, h[7]! * pr, h[8]!,
  ]);
}

/**
 * Invert a column-major 3×3. Returns null when singular (edge-on
 * pane — the §4.7 degenerate case: draw nothing).
 */
export function invertHomography(m: ArrayLike<number>): Float32Array | null {
  // Row-major view of the column-major array.
  const m00 = m[0]!, m10 = m[1]!, m20 = m[2]!;
  const m01 = m[3]!, m11 = m[4]!, m21 = m[5]!;
  const m02 = m[6]!, m12 = m[7]!, m22 = m[8]!;
  const c00 = m11 * m22 - m12 * m21;
  const c01 = m12 * m20 - m10 * m22;
  const c02 = m10 * m21 - m11 * m20;
  const det = m00 * c00 + m01 * c01 + m02 * c02;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  const id = 1 / det;
  return new Float32Array([
    c00 * id, c01 * id, c02 * id,
    (m02 * m21 - m01 * m22) * id, (m00 * m22 - m02 * m20) * id, (m01 * m20 - m00 * m21) * id,
    (m01 * m12 - m02 * m11) * id, (m02 * m10 - m00 * m12) * id, (m00 * m11 - m01 * m10) * id,
  ]);
}
