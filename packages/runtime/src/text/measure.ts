// Text measurement utilities. Used for `font_size: "auto"` to compute the
// pixel size that makes a given string fit within a width constraint.
//
// Measurement uses a single shared Canvas 2D context. measureText is fast
// and doesn't depend on any GPU resources, so we can call it freely during
// preflight without affecting the render loop.

// Generic CSS families that already imply a fallback target.
const GENERIC_FAMILIES = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy',
  'system-ui', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'ui-rounded',
]);

/**
 * Ensure a font-family has a generic fallback so an unregistered or
 * unavailable family falls back to SANS-SERIF (matching the browser/CSS
 * convention) instead of the Canvas 2D default, which is serif. No-op if
 * the value already carries a fallback chain or is itself a generic
 * family. Applied at every text render so `font_family: "Inter"` doesn't
 * silently render as Times when Inter isn't registered.
 */
export function withFontFallback(family: string): string {
  const f = family.trim();
  if (f.includes(',')) return f;
  if (GENERIC_FAMILIES.has(f.toLowerCase())) return f;
  return `${f}, sans-serif`;
}

let sharedCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;

function getCtx(): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null {
  if (sharedCtx) return sharedCtx;
  // Workers have no document but DO have OffscreenCanvas — real
  // measurement beats the character-count estimate everywhere.
  if (typeof OffscreenCanvas !== 'undefined') {
    sharedCtx = new OffscreenCanvas(1, 1).getContext('2d');
    return sharedCtx;
  }
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  sharedCtx = canvas.getContext('2d');
  return sharedCtx;
}

/**
 * Measure the rendered width (in pixels) of a string at the given font.
 * Returns 0 if measurement isn't possible (non-browser environment).
 */
export function measureTextWidth(
  text: string,
  fontFamily: string,
  fontWeight: string | number,
  fontSize: number,
): number {
  const ctx = getCtx();
  if (!ctx) {
    // Rough estimate — every character ≈ 0.5 of font size in width. Better
    // than nothing for non-browser callers.
    return text.length * fontSize * 0.5;
  }
  ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
  return ctx.measureText(text).width;
}

const REFERENCE_FONT_SIZE = 100;
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 1000;

/**
 * Per-character width at the reference size — the SUM of these matches
 * the renderer's kerning-free atlas advances, unlike a whole-string
 * measureText (which applies kerning and reads a few px narrower).
 * Auto-fit MUST size against the same metric the renderer draws with,
 * or "exactly fits" overflows the box by the kerning delta.
 */
function measureCharWidth(
  ch: string,
  fontFamily: string,
  fontWeight: string | number,
): number {
  const ctx = getCtx();
  if (!ctx) return REFERENCE_FONT_SIZE * 0.5;
  ctx.font = `${fontWeight} ${REFERENCE_FONT_SIZE}px ${fontFamily}`;
  return ctx.measureText(ch).width;
}

/** Kerning-free reference width of a string (sum of per-char widths). */
function refWidthOf(
  text: string,
  fontFamily: string,
  fontWeight: string | number,
  cache: Map<string, number>,
): number {
  let w = 0;
  for (const ch of text) {
    let cw = cache.get(ch);
    if (cw === undefined) {
      cw = measureCharWidth(ch, fontFamily, fontWeight);
      cache.set(ch, cw);
    }
    w += cw;
  }
  return w;
}

/**
 * Compute the font size (in pixels) that makes `text` fit exactly within
 * `maxWidth` at the given family and weight. Clamps to a sane range.
 *
 * Strategy: measure at a fixed reference size, then scale linearly. Text
 * width is approximately linear in font size for a single line, so a
 * single measurement is enough.
 */
export function autoFitFontSize(
  text: string,
  fontFamily: string,
  fontWeight: string | number,
  maxWidth: number,
  fallback: number = 48,
  minSize: number = MIN_FONT_SIZE,
  maxSize: number = MAX_FONT_SIZE,
): number {
  if (!text || maxWidth <= 0) return fallback;
  const refWidth = refWidthOf(text, fontFamily, fontWeight, new Map());
  if (refWidth <= 0) return fallback;
  const scaled = REFERENCE_FONT_SIZE * (maxWidth / refWidth);
  return Math.max(minSize, Math.min(scaled, maxSize));
}

/**
 * Two-dimensional auto-fit: the largest font size at which `text`,
 * greedy-word-wrapped to `boxWidth`, fits within `boxHeight`
 * (`lineCount × size × lineHeightRatio`). Used by
 * `font_size: "auto"` when the element has BOTH width and height —
 * the text wraps and grows to fill the box.
 *
 * Binary search over [minSize, maxSize]; the wrap simulation uses the
 * same kerning-free per-char metric the renderer draws with, so the
 * renderer's own wrap at the returned size agrees with the search.
 * Returns minSize when even that overflows (text then overflows the
 * box, CSS-style).
 */
export function autoFitFontSizeBox(
  text: string,
  fontFamily: string,
  fontWeight: string | number,
  boxWidth: number,
  boxHeight: number,
  lineHeightRatio: number,
  minSize: number = MIN_FONT_SIZE,
  maxSize: number = MAX_FONT_SIZE,
): number {
  if (!text || boxWidth <= 0 || boxHeight <= 0) return minSize;
  const cache = new Map<string, number>();
  const spaceRef = refWidthOf(' ', fontFamily, fontWeight, cache);
  const lineWords = text.split('\n').map((line) =>
    line.split(' ').map((word) => refWidthOf(word, fontFamily, fontWeight, cache)),
  );

  const fits = (size: number): boolean => {
    const scale = size / REFERENCE_FONT_SIZE;
    let lineCount = 0;
    for (const words of lineWords) {
      let current = 0;
      let started = false;
      for (const refW of words) {
        const w = refW * scale;
        if (w > boxWidth) return false; // a single word can't fit
        const candidate = started ? current + spaceRef * scale + w : w;
        if (started && candidate > boxWidth) {
          lineCount += 1;
          current = w;
        } else {
          current = candidate;
          started = true;
        }
      }
      lineCount += 1;
    }
    return lineCount * size * lineHeightRatio <= boxHeight;
  };

  if (!fits(minSize)) return minSize;
  let lo = minSize;
  let hi = maxSize;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  // Round down a notch so float dust never pushes the wrap over.
  return Math.floor(lo * 10) / 10;
}
