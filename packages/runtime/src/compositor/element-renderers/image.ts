import type { ImageElement } from '@clipkit/protocol';
import { applyModelTransform, quadWorldTransform } from '../mat4.js';
import { resolveAnchor, resolveLength } from '../unit.js';
import { anchorToCenter } from '../transform.js';
import { applyAnimation, applyAspectRatio, resolve3D, resolveScalePair, resolveSkewPair } from '../resolve.js';
import { computeObjectFit, type CropRect } from '../fit.js';
import { resolveMaterial } from '../lighting.js';
import { buildLitParams } from './lit.js';
import type { RenderContext } from '../render-context.js';

// Textured surfaces light from the texture's own pixels, so the albedo
// color is unused by the lit-textured shader — pass white.
const WHITE: readonly [number, number, number, number] = [1, 1, 1, 1];

export function renderImageElement(element: ImageElement, ctx: RenderContext): void {
  const { canvas, backend, images } = ctx;
  const sourceUrl = String(element.source ?? '');
  if (!sourceUrl) return;

  const asset = images.get(sourceUrl);
  if (!asset) {
    // Asset not preloaded — silently skip this frame. Caller should have
    // awaited preload() before rendering.
    return;
  }

  const x = applyAnimation(element, 'x', resolveLength(element.x as never, canvas.width, canvas), ctx);
  const y = applyAnimation(element, 'y', resolveLength(element.y as never, canvas.height, canvas), ctx);
  const { sx, sy } = resolveScalePair(element, ctx);
  const box = applyAspectRatio(
    element,
    applyAnimation(element, 'width', resolveLength(element.width as never, canvas.width, canvas, asset.bitmap.width), ctx),
    applyAnimation(element, 'height', resolveLength(element.height as never, canvas.height, canvas, asset.bitmap.height), ctx),
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

  const opacity = Math.max(0, Math.min(1, w.opacity01));
  const tint: readonly [number, number, number, number] = [opacity, opacity, opacity, opacity];

  // CKP/1.0 3D (§4.4): full-matrix hand-off. Fit math runs in LOCAL
  // pixels (the projection scales everything uniformly afterwards).
  const t3d = resolve3D(element, ctx);
  const matrixPath = t3d !== null || !ctx.modelMatrix.aff;

  // object-fit: crop (cover/none) or letterbox (contain) the media
  // within the element box. Default cover. The optional source crop
  // (§5.3) selects a normalized sub-rectangle of the media first.
  const fitted = computeObjectFit(
    element.fit,
    matrixPath ? width : w.width,
    matrixPath ? height : w.height,
    asset.bitmap.width,
    asset.bitmap.height,
    resolveCrop(element, ctx),
  );

  const { skewX, skewY } = resolveSkewPair(element, ctx);

  // §4.8 PBR: a material + scene lights/environment shade the image as a
  // textured surface (albedo = its own pixels). Built from the camera-
  // free world quad so the highlight/reflection is view-dependent.
  const material = resolveMaterial(element, ctx.time);
  const lit = material
    ? buildLitParams(
        ctx,
        quadWorldTransform(ctx.worldMatrix, cx, cy, fitted.drawWidth, fitted.drawHeight, rotation, skewX, skewY, t3d),
        material,
        WHITE,
      )
    : null;

  backend.drawTexturedQuad({
    cx: w.cx,
    cy: w.cy,
    width: fitted.drawWidth,
    height: fitted.drawHeight,
    rotation: w.rotation,
    skewX,
    skewY,
    transform: matrixPath
      ? quadWorldTransform(ctx.modelMatrix, cx, cy, fitted.drawWidth, fitted.drawHeight, rotation, skewX, skewY, t3d)
      : undefined,
    texture: asset.texture,
    uvRect: fitted.uvRect,
    tint,
    cornerRadius: numberOr(element.border_radius, 0),
    blend: element.blend_mode,
    lit: lit ?? undefined,
  });
}

// Source crop (§5.3): resolve the normalized sub-rect, with each component
// keyframeable. Returns undefined for the common no-crop case so the fit
// math takes its identity fast path.
const CROP_PROPS = ['crop_x', 'crop_y', 'crop_width', 'crop_height'] as const;
function resolveCrop(element: ImageElement, ctx: RenderContext): CropRect | undefined {
  const hasField = CROP_PROPS.some((p) => (element as Record<string, unknown>)[p] !== undefined);
  const hasAnim = (element.keyframe_animations ?? []).some((k) =>
    (CROP_PROPS as readonly string[]).includes(k.property),
  );
  if (!hasField && !hasAnim) return undefined;
  return {
    x: applyAnimation(element, 'crop_x', numberOr(element.crop_x, 0), ctx),
    y: applyAnimation(element, 'crop_y', numberOr(element.crop_y, 0), ctx),
    width: applyAnimation(element, 'crop_width', numberOr(element.crop_width, 1), ctx),
    height: applyAnimation(element, 'crop_height', numberOr(element.crop_height, 1), ctx),
  };
}

function numberOr(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = parseFloat(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}
