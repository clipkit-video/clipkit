// Font loading. The previous runtime silently rendered with a fallback
// font when the requested family wasn't loaded, which caused empty-looking
// or wrong-looking text. We make font loading explicit here: callers
// request a font, and the promise resolves when the font is available
// (or rejects loudly if not).

import type { FontFace as ProtocolFontFace } from '@clipkit/protocol';
import { getLogger } from '../logger.js';

/**
 * Get the current global FontFaceSet — `document.fonts` on the main
 * thread, `self.fonts` inside a (Dedicated/Shared) Worker. The playback
 * pipeline runs ClipkitRuntime inside a worker via OffscreenCanvas, so
 * skipping when only `document` is checked would silently disable
 * font handling for live playback.
 */
function getFontFaceSet(): FontFaceSet | null {
  if (typeof document !== 'undefined' && document.fonts) return document.fonts;
  if (typeof self !== 'undefined') {
    const s = self as unknown as { fonts?: FontFaceSet };
    if (s.fonts) return s.fonts;
  }
  return null;
}

const KNOWN_GENERIC_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
]);

/**
 * Ensure a font face is loaded so the canvas-text rasterizer can use it.
 * Generic CSS families (sans-serif, monospace, etc.) skip the load — the
 * browser always has them available.
 *
 * Quietly succeeds when the FontFace API is unavailable (non-browser
 * environments). Logs a warning and resolves when the font fails to load
 * — text will fall back to the browser's default font, visibly wrong
 * but at least not blank.
 */
export async function loadFont(
  family: string,
  weight: string | number = 'normal',
  style: 'normal' | 'italic' = 'normal',
): Promise<void> {
  const fontSet = getFontFaceSet();
  if (!fontSet) return;
  // font_family is often a full CSS stack ("Geist, ui-sans-serif, sans-serif").
  // Resolve the first CONCRETE family: quoting the whole stack as one name never
  // matches (it only warns), and a leading generic means the browser already has
  // it — nothing to load.
  const target = family
    .split(',')
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .find((f) => f && !KNOWN_GENERIC_FAMILIES.has(f.toLowerCase()));
  if (!target) return;

  const spec = `${style} ${weight} 16px "${target}"`;
  try {
    const faces = await fontSet.load(spec);
    if (faces.length === 0) {
      getLogger().warn(
        `Font "${target}" (${weight} ${style}) was requested but no matching FontFace was found. ` +
          `Declare it in the Source's fonts[] (family + src), or add the @font-face to the page. ` +
          `Text will render with the browser default.`,
      );
    }
  } catch (err) {
    getLogger().warn(
      `Loading font "${target}" failed:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * Wait for ALL currently-pending fonts in the document to finish loading.
 * Call this once after the page has declared its @font-face rules but
 * before generating font atlases.
 */
export async function fontsReady(): Promise<void> {
  const fontSet = getFontFaceSet();
  if (!fontSet) return;
  await fontSet.ready;
}

/**
 * Register Source-declared @font-face entries into the host document so
 * the canvas-text path renders with the exact font the snapshot saw.
 *
 * Idempotent per (family, weight, style, src) tuple: a face already added
 * by an earlier preload() (or by the host page) is skipped — the
 * FontFaceSet doesn't dedupe these for us.
 */
const registeredFontKeys = new Set<string>();
export async function registerSourceFonts(fonts: ProtocolFontFace[]): Promise<void> {
  const fontSet = getFontFaceSet();
  if (!fontSet) return;
  if (typeof FontFace === 'undefined') return;

  const loads: Promise<unknown>[] = [];
  for (const f of fonts) {
    const weight = f.weight === undefined ? 'normal' : String(f.weight);
    const style = f.style ?? 'normal';
    const key = `${f.family}|${weight}|${style}|${f.src}`;
    if (registeredFontKeys.has(key)) continue;
    registeredFontKeys.add(key);
    try {
      const face = new FontFace(f.family, `url(${f.src})`, {
        weight,
        style,
        // Subsetted webfonts ship one file per script with identical
        // family/weight/style; without the range every subset matches
        // every codepoint and the winner may lack the needed glyphs.
        ...(f.unicode_range ? { unicodeRange: f.unicode_range } : {}),
      });
      fontSet.add(face);
      loads.push(
        face.load().catch((err: unknown) => {
          getLogger().warn(
            `Failed to load Source font "${f.family}" (${weight} ${style}) from ${f.src}:`,
            err instanceof Error ? err.message : String(err),
          );
        }),
      );
    } catch (err) {
      getLogger().warn(
        `Failed to register Source font "${f.family}" (${weight} ${style}):`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  await Promise.all(loads);
}
