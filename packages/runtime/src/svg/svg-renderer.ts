// SVG rasterizer — renders our restricted SVG schema to an OffscreenCanvas
// using Canvas2D's Path2D, clip(), gradients, and stroke-dashoffset.
//
// This is NOT a general SVG engine. It's the subset needed for animated
// logos and icons in motion graphics: paths with fill/stroke (solid or
// linear-gradient), clip-to-path, and stroke evolution via
// stroke_progress + stroke-dashoffset.
//
// Rasterization runs every frame because at least one path's stroke
// progress is typically animating. Cost is ~1ms per simple icon — fine
// for our budget.

import type { ShapeElement, PathGradient, PathDef } from '@clipkit/protocol';

// Cache path lengths by `d` string. getTotalLength() is expensive
// (requires DOM round-trip) and the same paths are measured every frame.
const PATH_LENGTH_CACHE = new Map<string, number>();

/**
 * Total length of an SVG path along its trajectory. Uses an off-document
 * SVGPathElement.getTotalLength() — works in any DOM context. Falls back
 * to a heuristic if measurement is unavailable.
 */
export function getPathLength(d: string): number {
  // Morphing produces a fresh d-string per frame — cap the cache.
  if (PATH_LENGTH_CACHE.size > 256) PATH_LENGTH_CACHE.clear();
  const cached = PATH_LENGTH_CACHE.get(d);
  if (cached !== undefined) return cached;
  let len = 0;
  try {
    const svgPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    svgPath.setAttribute('d', d);
    len = svgPath.getTotalLength();
  } catch {
    len = 0;
  }
  if (!Number.isFinite(len) || len <= 0) len = 1000;
  PATH_LENGTH_CACHE.set(d, len);
  return len;
}

export interface SvgRasterTarget {
  canvas: OffscreenCanvas;
  ctx: OffscreenCanvasRenderingContext2D;
}

/**
 * Render the element's paths into `target.canvas`, replacing any previous
 * contents. `trims` holds resolved [start, end, offset] per path
 * — pass 1 for static / non-stroked paths.
 */
export function rasterizeSvgElement(
  element: ShapeElement,
  trims: number[],
  ds: string[],
  target: SvgRasterTarget,
): void {
  const { canvas, ctx } = target;
  const viewBox = element.view_box ?? [0, 0, 100, 100];
  const [vbX, vbY, vbW, vbH] = viewBox;

  // Clear to fully transparent.
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.restore();

  // ViewBox → canvas pixel transform.
  ctx.save();
  ctx.scale(canvas.width / vbW, canvas.height / vbH);
  ctx.translate(-vbX, -vbY);

  // Gradient lookup table by id.
  const gradientLookup = new Map<string, PathGradient>();
  for (const g of element.gradients ?? []) gradientLookup.set(g.id, g);

  const paths = element.paths ?? [];
  for (let i = 0; i < paths.length; i++) {
    const path = paths[i]!;
    const tS = trims[i * 3] ?? 0;
    const tE = trims[i * 3 + 1] ?? 1;
    const tO = trims[i * 3 + 2] ?? 0;
    const d = ds[i] ?? (typeof path.d === 'string' ? path.d : '');
    if (d) drawPath(ctx, path, d, tS, tE, tO, gradientLookup);
  }

  ctx.restore();
}

function drawPath(
  ctx: OffscreenCanvasRenderingContext2D,
  path: PathDef,
  d: string,
  trimStart: number,
  trimEnd: number,
  trimOffset: number,
  gradients: Map<string, PathGradient>,
): void {
  const hasFill = path.fill && path.fill !== 'none';
  const hasStroke = path.stroke && path.stroke !== 'none' && (path.stroke_width ?? 0) > 0;
  if (!hasFill && !hasStroke) return;

  const opacity = path.opacity ?? 1;
  if (opacity <= 0) return;

  const needsAlphaWrap = opacity < 1;
  if (needsAlphaWrap || path.clip_path) {
    ctx.save();
    if (needsAlphaWrap) ctx.globalAlpha = opacity;
    if (path.clip_path) ctx.clip(new Path2D(path.clip_path));
  }

  const path2d = new Path2D(d);

  if (hasFill) {
    ctx.fillStyle = resolvePaint(ctx, path.fill!, gradients);
    ctx.fill(path2d);
  }

  if (hasStroke) {
    // Trim window (§5.6.1): draw the stroke between trimStart and
    // trimEnd (fractions of total length), rotated by trimOffset with
    // wrap-around. The dash pattern's period equals the path length,
    // so a window crossing the path's start wraps exactly.
    const w = Math.max(0, Math.min(1, trimEnd) - Math.max(0, trimStart));
    if (w > 0) {
      ctx.strokeStyle = resolvePaint(ctx, path.stroke!, gradients);
      ctx.lineWidth = path.stroke_width!;
      ctx.lineCap = path.stroke_linecap ?? 'butt';
      ctx.lineJoin = path.stroke_linejoin ?? 'miter';
      if (w >= 1) {
        ctx.stroke(path2d);
      } else {
        const len = getPathLength(d);
        const a = (((Math.max(0, trimStart) + trimOffset) % 1) + 1) % 1;
        ctx.setLineDash([w * len, len - w * len]);
        ctx.lineDashOffset = -a * len;
        ctx.stroke(path2d);
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;
      }
    }
  }

  if (needsAlphaWrap || path.clip_path) ctx.restore();
}

function resolvePaint(
  ctx: OffscreenCanvasRenderingContext2D,
  paint: string,
  gradients: Map<string, PathGradient>,
): string | CanvasGradient {
  const m = paint.match(/^url\(#([^)]+)\)$/);
  if (m) {
    const id = m[1]!;
    const g = gradients.get(id);
    if (!g) return '#ffffff';
    const grad = ctx.createLinearGradient(g.x1, g.y1, g.x2, g.y2);
    for (const stop of g.stops) {
      grad.addColorStop(clamp01(stop.offset), stop.color);
    }
    return grad;
  }
  return paint;
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
