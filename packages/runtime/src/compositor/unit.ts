// Schema length values can be numbers (pixels) or strings with units.
// resolveLength converts them to pixels relative to a reference axis.
//
// Units (matching the Clipkit Protocol spec):
//   px    absolute pixels
//   %     percentage of the reference axis (e.g. element width)
//   vw    percentage of the composition width
//   vh    percentage of the composition height
//   vmin  percentage of the smaller composition dimension
//   vmax  percentage of the larger composition dimension
//
// A bare number is interpreted as pixels.

export type LengthValue = number | string;

export interface CanvasDimensions {
  /** Composition width in pixels. */
  width: number;
  /** Composition height in pixels. */
  height: number;
}

/**
 * Resolve a schema length (number or string with unit) to pixels.
 *
 * @param value    The schema value (e.g. `100`, `"50%"`, `"10vw"`).
 * @param ref      The reference value `%` is relative to (e.g. element width).
 * @param canvas   Composition dimensions (drive vw/vh/vmin/vmax).
 * @param fallback Returned when the value cannot be parsed.
 */
export function resolveLength(
  value: LengthValue | undefined | null,
  ref: number,
  canvas: CanvasDimensions,
  fallback: number = 0,
): number {
  if (value == null) return fallback;
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  // A Tier-A expression value ({ expr }) reaches here as an object — it isn't a
  // static length. Return the fallback; applyAnimation() reads the raw property
  // and overrides this with the evaluated expression.
  if (typeof value !== 'string') return fallback;

  const s = value.trim();
  if (s === '') return fallback;

  // Strip a trailing unit suffix.
  const match = s.match(/^(-?\d*\.?\d+)\s*(px|%|vw|vh|vmin|vmax)?$/i);
  if (!match) return fallback;

  const num = parseFloat(match[1]!);
  if (!Number.isFinite(num)) return fallback;

  const unit = (match[2] || 'px').toLowerCase();
  switch (unit) {
    case 'px':   return num;
    case '%':    return (num / 100) * ref;
    case 'vw':   return (num / 100) * canvas.width;
    case 'vh':   return (num / 100) * canvas.height;
    case 'vmin': return (num / 100) * Math.min(canvas.width, canvas.height);
    case 'vmax': return (num / 100) * Math.max(canvas.width, canvas.height);
    default:     return fallback;
  }
}

/**
 * Resolve an anchor value (0..1, unitless or percentage).
 *
 * Anchors default to 0 (TOP-LEFT) so that `x`/`y` mean the element's top-left
 * corner, matching CSS (`left`/`top`), SVG (`<rect x y>`), and Canvas — the
 * convention agents and humans reach for. See ANCHOR-CONVENTION-PLAN.md.
 * Callers that want a center default (transform pivots, group rotation/scale)
 * pass `fallback: 0.5` explicitly. A string like "50%" maps to 0.5.
 */
export function resolveAnchor(
  value: LengthValue | undefined | null,
  fallback: number = 0,
): number {
  if (value == null) return fallback;
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  const s = value.trim();
  if (s.endsWith('%')) {
    const n = parseFloat(s);
    return Number.isFinite(n) ? n / 100 : fallback;
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : fallback;
}
