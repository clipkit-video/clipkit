import type { VideoElement } from '@clipkit/protocol';
import { applyModelTransform, quadWorldTransform } from '../mat4.js';
import { resolveAnchor, resolveLength } from '../unit.js';
import { anchorToCenter } from '../transform.js';
import { applyAnimation, applyAspectRatio, resolve3D, resolveScalePair, resolveSkewPair } from '../resolve.js';
import { computeObjectFit, type CropRect } from '../fit.js';
import { resolveMaterial } from '../lighting.js';
import { buildLitParams } from './lit.js';
import type { RenderContext } from '../render-context.js';

// Textured surfaces light from their own pixels; albedo color unused.
const WHITE: readonly [number, number, number, number] = [1, 1, 1, 1];

/**
 * Render a video element by sampling its current frame.
 *
 * The runtime is responsible for advancing video.currentTime to the right
 * playhead before calling this. For preview, that's driven by the browser's
 * own video clock. For deterministic export, the runtime seeks each video
 * to the desired frame time before each render call.
 */
export function renderVideoElement(element: VideoElement, ctx: RenderContext): void {
  const { canvas, backend, videos } = ctx;
  const sourceUrl = String(element.source ?? '');
  if (!sourceUrl) return;

  const asset = videos.get(sourceUrl);
  if (!asset) return;

  // Element-backed assets: re-upload the current video frame to the GPU
  // texture. Cheap to call every frame; copyExternalImageToTexture from
  // HTMLVideoElement is fast. Skip if the playhead hasn't advanced.
  // Externally-pumped assets (video === null) are uploaded at push time
  // by pushExternalVideoFrame — nothing to do here.
  if (asset.video && asset.video.readyState >= 2 /* HAVE_CURRENT_DATA */) {
    if (asset.video.currentTime !== asset.lastUploadedTime) {
      backend.updateTexture(asset.texture, asset.video);
      asset.lastUploadedTime = asset.video.currentTime;
    }
  }

  const x = applyAnimation(element, 'x', resolveLength(element.x as never, canvas.width, canvas), ctx);
  const y = applyAnimation(element, 'y', resolveLength(element.y as never, canvas.height, canvas), ctx);
  const { sx, sy } = resolveScalePair(element, ctx);
  const box = applyAspectRatio(
    element,
    applyAnimation(element, 'width', resolveLength(element.width as never, canvas.width, canvas, asset.width), ctx),
    applyAnimation(element, 'height', resolveLength(element.height as never, canvas.height, canvas, asset.height), ctx),
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

  // CKP/1.0 3D (§4.4): full-matrix hand-off; fit math in LOCAL pixels.
  const t3d = resolve3D(element, ctx);
  const matrixPath = t3d !== null || !ctx.modelMatrix.aff;

  // object-fit against the video's natural dimensions. Default cover.
  // The optional source crop (§5.3) selects a normalized sub-rectangle
  // of the frame first.
  const fitted = computeObjectFit(
    element.fit,
    matrixPath ? width : w.width,
    matrixPath ? height : w.height,
    asset.width,
    asset.height,
    resolveCrop(element, ctx),
  );

  const { skewX, skewY } = resolveSkewPair(element, ctx);

  // §4.8 PBR: a material + scene lights/environment shade the video frame
  // as a textured surface (albedo = the sampled frame).
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
    blend: element.blend_mode,
    lit: lit ?? undefined,
  });
}

// Source crop (§5.3): resolve the normalized sub-rect, with each component
// keyframeable. Returns undefined for the common no-crop case so the fit
// math takes its identity fast path.
const CROP_PROPS = ['crop_x', 'crop_y', 'crop_width', 'crop_height'] as const;
function resolveCrop(element: VideoElement, ctx: RenderContext): CropRect | undefined {
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
