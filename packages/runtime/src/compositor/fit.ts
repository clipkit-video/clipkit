// Object-fit math shared by the image and video renderers.
//
// Given the element box and the media's natural dimensions, produce the
// quad to draw (centered in the box) and the texture sub-region to
// sample. CSS object-fit semantics:
//
//   cover    scale media to FILL the box, crop the overflow (uv crop)
//   contain  scale media to FIT inside the box, letterbox (smaller quad)
//   fill     stretch media to the box exactly (the pre-fit behavior)
//   none     natural media size, centered, cropped to the box
//
// Default is 'cover', matching the prevailing video-API convention.
//
// SOURCE CROP (§5.3): an optional normalized sub-rectangle of the media
// selected BEFORE fit. The fit math runs against the cropped region's
// pixel dimensions, then the resulting uvRect is remapped back into the
// crop sub-rect — so crop picks WHICH part of the source is shown and
// fit governs how that part maps into the box. Identity crop (0,0,1,1)
// is a no-op, preserving the pre-crop behavior exactly.

export type ObjectFit = 'cover' | 'contain' | 'fill' | 'none';

/** Normalized source sub-rectangle (0..1, origin top-left). */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FitResult {
  /** Quad width to draw, in pixels. */
  drawWidth: number;
  /** Quad height to draw, in pixels. */
  drawHeight: number;
  /** Normalized texture sub-region [u0, v0, u1, v1]. */
  uvRect: readonly [number, number, number, number];
}

const FULL_UV: readonly [number, number, number, number] = [0, 0, 1, 1];

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * Validate + clamp a crop rect to the unit square, returning null for an
 * absent, malformed, or identity (whole-source) crop so callers can skip
 * it entirely.
 */
function normalizeCrop(crop: CropRect | undefined): CropRect | null {
  if (!crop) return null;
  const { x, y, width, height } = crop;
  if (![x, y, width, height].every((n) => Number.isFinite(n))) return null;
  const cx = clamp01(x);
  const cy = clamp01(y);
  const cw = Math.min(clamp01(width), 1 - cx);
  const ch = Math.min(clamp01(height), 1 - cy);
  if (cw <= 0 || ch <= 0) return null;
  if (cx === 0 && cy === 0 && cw === 1 && ch === 1) return null; // identity
  return { x: cx, y: cy, width: cw, height: ch };
}

export function computeObjectFit(
  fit: ObjectFit | undefined,
  boxWidth: number,
  boxHeight: number,
  mediaWidth: number,
  mediaHeight: number,
  crop?: CropRect,
): FitResult {
  const c = normalizeCrop(crop);
  // Fit runs against the CROPPED region's pixel size; the cropped region
  // becomes the effective media. uvRect comes back in [0,1] of that
  // region and is remapped into the crop sub-rect below.
  const mw = c ? mediaWidth * c.width : mediaWidth;
  const mh = c ? mediaHeight * c.height : mediaHeight;
  const base = fitCore(fit, boxWidth, boxHeight, mw, mh);
  if (!c) return base;
  const [u0, v0, u1, v1] = base.uvRect;
  return {
    drawWidth: base.drawWidth,
    drawHeight: base.drawHeight,
    uvRect: [
      c.x + u0 * c.width,
      c.y + v0 * c.height,
      c.x + u1 * c.width,
      c.y + v1 * c.height,
    ],
  };
}

function fitCore(
  fit: ObjectFit | undefined,
  boxWidth: number,
  boxHeight: number,
  mediaWidth: number,
  mediaHeight: number,
): FitResult {
  if (
    boxWidth <= 0 || boxHeight <= 0 ||
    mediaWidth <= 0 || mediaHeight <= 0 ||
    fit === 'fill'
  ) {
    return { drawWidth: boxWidth, drawHeight: boxHeight, uvRect: FULL_UV };
  }

  switch (fit) {
    case 'contain': {
      const scale = Math.min(boxWidth / mediaWidth, boxHeight / mediaHeight);
      return {
        drawWidth: mediaWidth * scale,
        drawHeight: mediaHeight * scale,
        uvRect: FULL_UV,
      };
    }
    case 'none': {
      // Natural size, centered, cropped to the box.
      const drawWidth = Math.min(boxWidth, mediaWidth);
      const drawHeight = Math.min(boxHeight, mediaHeight);
      const insetU = (1 - drawWidth / mediaWidth) / 2;
      const insetV = (1 - drawHeight / mediaHeight) / 2;
      return {
        drawWidth,
        drawHeight,
        uvRect: [insetU, insetV, 1 - insetU, 1 - insetV],
      };
    }
    case 'cover':
    default: {
      const scale = Math.max(boxWidth / mediaWidth, boxHeight / mediaHeight);
      // Visible media region after the crop, as a fraction of the media.
      const insetU = (1 - boxWidth / (mediaWidth * scale)) / 2;
      const insetV = (1 - boxHeight / (mediaHeight * scale)) / 2;
      return {
        drawWidth: boxWidth,
        drawHeight: boxHeight,
        uvRect: [insetU, insetV, 1 - insetU, 1 - insetV],
      };
    }
  }
}
