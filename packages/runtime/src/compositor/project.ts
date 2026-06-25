// Pure projection helpers for the EDITOR's camera-view gizmos (CAMERA-
// PLAN item 6). These reuse the exact render path — `cameraMatrix`, the
// `resolve*` family, and `quadMatrix3D` — so a selection box projected
// here hugs the element exactly as the runtime draws it (no drift). All
// coordinates are CANVAS pixels; the editor maps canvas → screen with
// its own pan/zoom. No DOM, no GPU.

import type { Element, Source } from '@clipkit/protocol';
import { cameraMatrix } from './camera.js';
import {
  applyAnimation,
  resolve3D,
  resolveScalePair,
  resolveSkewPair,
} from './resolve.js';
import { resolveAnchor, resolveLength, type CanvasDimensions } from './unit.js';
import { anchorToCenter, quadMatrix3D } from './transform.js';
import { mat4Multiply } from './mat4.js';
import { MAT4_IDENTITY, type RenderContext } from './render-context.js';

export interface Pt {
  x: number;
  y: number;
}

function canvasOf(source: Source): CanvasDimensions {
  return { width: source.width ?? 1920, height: source.height ?? 1080 };
}

/** Minimal context for the resolve.ts helpers (they only read time /
 *  canvas / sourceDuration / timeOffset). */
function miniCtx(source: Source, time: number): RenderContext {
  return {
    canvas: canvasOf(source),
    time,
    sourceDuration: typeof source.duration === 'number' ? source.duration : 0,
    timeOffset: 0,
    modelMatrix: MAT4_IDENTITY,
    depthSort: false,
  } as unknown as RenderContext;
}

/**
 * The element's projected screen quad — four CANVAS-pixel corners in
 * order [TL, TR, BR, BL], accounting for the element's own 3D transform
 * AND the scene camera at `time`. Returns null when the source has no
 * camera (the editor uses the flat box then) or the quad is degenerate /
 * fully behind the camera.
 */
export function projectElementQuad(
  source: Source,
  el: Element,
  time: number,
): [Pt, Pt, Pt, Pt] | null {
  if (!source.camera) return null;
  const ctx = miniCtx(source, time);
  const canvas = ctx.canvas;

  const x = applyAnimation(el, 'x', resolveLength(el.x as never, canvas.width, canvas) ?? canvas.width / 2, ctx);
  const y = applyAnimation(el, 'y', resolveLength(el.y as never, canvas.height, canvas) ?? canvas.height / 2, ctx);
  const w = applyAnimation(el, 'width', resolveLength(el.width as never, canvas.width, canvas, 100) ?? 100, ctx);
  const h = applyAnimation(el, 'height', resolveLength(el.height as never, canvas.height, canvas, 100) ?? 100, ctx);
  const { sx, sy } = resolveScalePair(el, ctx);
  const rotation = applyAnimation(el, 'rotation', numberOr((el.rotation ?? (el as { z_rotation?: unknown }).z_rotation) as never, 0), ctx);
  const { skewX, skewY } = resolveSkewPair(el, ctx);
  const t3d = resolve3D(el, ctx);
  const ax = resolveAnchor(el.x_anchor);
  const ay = resolveAnchor(el.y_anchor);
  const { cx, cy } = anchorToCenter(x, y, w, h, ax, ay);

  const local = quadMatrix3D(
    cx, cy, w * sx, h * sy, rotation, skewX, skewY,
    t3d?.xRot ?? 0, t3d?.yRot ?? 0, t3d?.z ?? 0,
  );
  const C = cameraMatrix(source.camera, time, canvas).e;
  const M = mat4Multiply({ e: C, aff: false }, { e: local, aff: false }).e;

  // The shared unit quad spans (-1..+1). Project each corner.
  const project = (ux: number, uy: number): Pt | null => {
    const X = M[0] * ux + M[4] * uy + M[12];
    const Y = M[1] * ux + M[5] * uy + M[13];
    const W = M[3] * ux + M[7] * uy + M[15];
    if (!Number.isFinite(W) || W <= 1e-6) return null;
    return { x: X / W, y: Y / W };
  };
  const tl = project(-1, -1);
  const tr = project(1, -1);
  const br = project(1, 1);
  const bl = project(-1, 1);
  if (!tl || !tr || !br || !bl) return null;
  return [tl, tr, br, bl];
}

/**
 * Inverse of the camera projection at a FIXED depth plane: given a
 * canvas-pixel screen point, return the world (x, y) in canvas pixels
 * whose projection at depth `planeZ` lands on it. Used by the move drag
 * to map pointer motion to source `x`/`y` deltas at the element's own
 * depth. Returns null if the plane is edge-on (degenerate).
 */
export function unprojectToPlane(
  source: Source,
  time: number,
  screen: Pt,
  planeZ: number,
): Pt | null {
  if (!source.camera) return { x: screen.x, y: screen.y };
  const canvas = canvasOf(source);
  const C = cameraMatrix(source.camera, time, canvas).e;
  // Solve the 2×2 system from X − Sx·W = 0 and Y − Sy·W = 0 with z fixed.
  const a1 = C[0] - screen.x * C[3];
  const b1 = C[4] - screen.x * C[7];
  const c1 = (C[8] * planeZ + C[12]) - screen.x * (C[11] * planeZ + C[15]);
  const a2 = C[1] - screen.y * C[3];
  const b2 = C[5] - screen.y * C[7];
  const c2 = (C[9] * planeZ + C[13]) - screen.y * (C[11] * planeZ + C[15]);
  const det = a1 * b2 - a2 * b1;
  if (Math.abs(det) < 1e-9) return null;
  return {
    x: (-c1 * b2 + c2 * b1) / det,
    y: (-a1 * c2 + a2 * c1) / det,
  };
}

/** The element's resolved depth (`z`) at `time` — the plane for move. */
export function elementDepthZ(source: Source, el: Element, time: number): number {
  return resolve3D(el, miniCtx(source, time))?.z ?? 0;
}


function numberOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
