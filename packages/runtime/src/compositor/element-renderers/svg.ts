// SVG element renderer.
//
// Each frame:
//   1. Resolve per-path stroke_progress values (animatable via keyframes).
//   2. Get or create a cached OffscreenCanvas + Texture sized to the viewBox
//      at a 2× supersampling factor.
//   3. Rasterize the paths into the OffscreenCanvas.
//   4. Upload the canvas contents into the texture.
//   5. Draw as a textured quad at the element's animated transform.

import type { Keyframe, ShapeElement, Expr } from '@clipkit/protocol';
import { interpolateKeyframes } from '../../animation/keyframes.js';
import { isExpr, evalExpr } from '../../animation/expr.js';
import { applyEasing } from '../../animation/easings.js';
import { morphD } from '../../svg/morph.js';
import { rasterizeSvgElement } from '../../svg/svg-renderer.js';
import { applyModelTransform, quadWorldTransform } from '../mat4.js';
import { resolveAnchor, resolveLength } from '../unit.js';
import { anchorToCenter } from '../transform.js';
import { applyAnimation, applyAspectRatio, resolve3D, resolveScalePair, resolveSkewPair } from '../resolve.js';
import type {
  RenderContext,
  SvgRasterAsset,
  SvgRasterSignature,
} from '../render-context.js';

const SUPERSAMPLE = 2;
// Cap the rasterization canvas. Going past this wastes memory + GPU
// without visible improvement at typical canvas sizes.
const MAX_RASTER = 2048;

// Renders the PATH form of a `shape` (an element carrying `paths`) — rasterized
// to a cached OffscreenCanvas and drawn as a textured quad. The primitive form
// (rectangle/ellipse, no `paths`) goes through renderShapeElement instead.
export function renderPathShape(element: ShapeElement, ctx: RenderContext): void {
  const { canvas, backend, svgRasters } = ctx;
  const paths = element.paths;
  if (!paths || paths.length === 0) return;

  const viewBox = element.view_box ?? [0, 0, 100, 100];
  const [, , vbW, vbH] = viewBox;

  const x = applyAnimation(element, 'x', resolveLength(element.x as never, canvas.width, canvas), ctx);
  const y = applyAnimation(element, 'y', resolveLength(element.y as never, canvas.height, canvas), ctx);
  const { sx, sy } = resolveScalePair(element, ctx);
  const box = applyAspectRatio(
    element,
    applyAnimation(element, 'width', resolveLength(element.width as never, canvas.width, canvas, vbW), ctx),
    applyAnimation(element, 'height', resolveLength(element.height as never, canvas.height, canvas, vbH), ctx),
  );
  const width = sx * box.width;
  const height = sy * box.height;
  const rotation = applyAnimation(element, 'rotation', numberOr(element.rotation ?? (element as { z_rotation?: unknown }).z_rotation, 0), ctx);
  const opacity01 = applyAnimation(element, 'opacity', numberOr(element.opacity, 1), ctx);
  const xAnchor = resolveAnchor(element.x_anchor);
  const yAnchor = resolveAnchor(element.y_anchor);
  const { cx, cy } = anchorToCenter(x, y, width, height, xAnchor, yAnchor);
  const w = applyModelTransform(
    ctx.modelMatrix, ctx.opacityFactor,
    cx, cy, rotation, opacity01, width, height,
  );

  const opacity = clamp01(w.opacity01);
  if (opacity <= 0 || w.width <= 0 || w.height <= 0) return;

  // Resolve per-path trim windows at this frame (§5.6.1) —
  // stroke_progress is sugar for [0, progress, 0].
  const elementStart = ctx.timeOffset + numberOr(element.time, 0);
  const localTime = ctx.time - elementStart;
  const trims = paths.flatMap((p) => resolveTrim(p, localTime));
  const ds = paths.map((p) => resolveD(p.d, localTime));

  // Get or create the per-element raster target.
  //
  // The canvas resolution drives clarity at display. If we used the viewBox
  // dimensions alone (e.g. 20×20 for an SVG icon), an element drawn at
  // 320×320 px would upscale the texture 16× and look blurry. So we size
  // the canvas to max(viewBox, display) × supersample, capped to avoid
  // blowing up GPU memory.
  const targetRasterW = Math.min(MAX_RASTER, Math.max(1, Math.ceil(Math.max(vbW, width) * SUPERSAMPLE)));
  const targetRasterH = Math.min(MAX_RASTER, Math.max(1, Math.ceil(Math.max(vbH, height) * SUPERSAMPLE)));
  const cacheKey = typeof element.id === 'string' ? element.id : `__svg_${JSON.stringify(viewBox)}`;
  let target = svgRasters.get(cacheKey);
  if (!target || target.canvas.width !== targetRasterW || target.canvas.height !== targetRasterH) {
    const off = new OffscreenCanvas(targetRasterW, targetRasterH);
    const offCtx = off.getContext('2d');
    if (!offCtx) return;
    // We have to initialize the texture with the canvas to pin its size.
    const texture = backend.createTexture(off);
    target = { canvas: off, ctx: offCtx as OffscreenCanvasRenderingContext2D, texture } satisfies SvgRasterAsset;
    svgRasters.set(cacheKey, target);
  }

  // Memoize the raster + upload — skip both when nothing about the
  // rendered pixels has changed since the last frame. For a complex
  // SVG (US map: 50+ paths, 2048×2048 raster, 16MB texture upload),
  // this is the difference between ~50ms per frame and ~0ms while the
  // element is sitting on screen post-animation. Stroke-progress
  // animations still re-raster every frame because their progresses
  // genuinely change frame-to-frame; the moment they settle at 1.0
  // the cache kicks in.
  const nextSignature: SvgRasterSignature = {
    trims,
    ds,
    pathsRef: paths,
    gradientsRef: element.gradients,
    rasterW: targetRasterW,
    rasterH: targetRasterH,
  };
  if (!signaturesEqual(target.lastSignature, nextSignature)) {
    rasterizeSvgElement(element, trims, ds, target);
    backend.updateTexture(target.texture, target.canvas);
    target.lastSignature = nextSignature;
  }

  // Draw the rasterized SVG as a textured quad. Tint by opacity (premul).
  // CKP/1.0 3D (§4.4): full-matrix hand-off when 3D is in play.
  const t3d = resolve3D(element, ctx);
  const matrixPath = t3d !== null || !ctx.modelMatrix.aff;
  const { skewX, skewY } = resolveSkewPair(element, ctx);
  backend.drawTexturedQuad({
    cx: w.cx,
    cy: w.cy,
    width: matrixPath ? width : w.width,
    height: matrixPath ? height : w.height,
    rotation: w.rotation,
    skewX,
    skewY,
    transform: matrixPath
      ? quadWorldTransform(ctx.modelMatrix, cx, cy, width, height, rotation, skewX, skewY, t3d)
      : undefined,
    texture: target.texture,
    tint: [opacity, opacity, opacity, opacity],
    blend: element.blend_mode,
  });
}

function resolveTrim(
  p: { stroke_progress?: number | Keyframe[] | Expr; trim_start?: number | Keyframe[] | Expr; trim_end?: number | Keyframe[] | Expr; trim_offset?: number | Keyframe[] | Expr },
  localTime: number,
): [number, number, number] {
  const rp = (v: number | Keyframe[] | Expr | undefined): number | undefined => {
    if (v === undefined) return undefined;
    if (typeof v === 'number') return v;
    if (isExpr(v)) return evalExpr(v, { t: localTime, dur: 0, i: 0, n: 1, value: 0 });
    if (Array.isArray(v)) return interpolateKeyframes(v, localTime);
    return undefined;
  };
  const hasTrim =
    p.trim_start !== undefined || p.trim_end !== undefined || p.trim_offset !== undefined;
  if (hasTrim) {
    return [
      clamp01p(rp(p.trim_start) ?? 0),
      clamp01p(rp(p.trim_end) ?? 1),
      rp(p.trim_offset) ?? 0,
    ];
  }
  return [0, clamp01p(rp(p.stroke_progress) ?? 1), 0];
}

function clamp01p(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * Resolve a path's d at element-local time: a plain string passes
 * through; keyframed d-strings MORPH between compatible command lists
 * (§5.6.2) and SNAP at the destination keyframe otherwise.
 */
function resolveD(d: string | Keyframe[], localTime: number): string {
  if (typeof d === 'string') return d;
  if (!Array.isArray(d) || d.length === 0) return '';
  const tv = (k: Keyframe): number =>
    typeof k.time === 'number' ? k.time : parseFloat(String(k.time)) || 0;
  const first = d[0]!;
  const last = d[d.length - 1]!;
  if (localTime <= tv(first)) return String(first.value);
  if (localTime >= tv(last)) return String(last.value);
  for (let i = 0; i < d.length - 1; i++) {
    const a = d[i]!;
    const b = d[i + 1]!;
    const at = tv(a);
    const bt = tv(b);
    if (localTime >= at && localTime <= bt) {
      const span = bt - at;
      const u = applyEasing(b.easing, span > 0 ? (localTime - at) / span : 1);
      const morphed = morphD(String(a.value), String(b.value), u);
      return morphed ?? String(a.value);
    }
  }
  return String(last.value);
}

function numberOr(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = parseFloat(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function signaturesEqual(
  prev: SvgRasterSignature | undefined,
  next: SvgRasterSignature,
): boolean {
  if (!prev) return false;
  if (prev.pathsRef !== next.pathsRef) return false;
  if (prev.gradientsRef !== next.gradientsRef) return false;
  if (prev.rasterW !== next.rasterW || prev.rasterH !== next.rasterH) {
    return false;
  }
  if (prev.trims.length !== next.trims.length) return false;
  for (let i = 0; i < prev.trims.length; i++) {
    if (prev.trims[i] !== next.trims[i]) return false;
  }
  if (prev.ds.length !== next.ds.length) return false;
  for (let i = 0; i < prev.ds.length; i++) {
    if (prev.ds[i] !== next.ds[i]) return false;
  }
  return true;
}
