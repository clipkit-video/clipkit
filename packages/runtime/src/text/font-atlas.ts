// Canvas-2D-based font atlas generator (v2, clean rewrite).
//
// Renders the ASCII printable charset into a single texture once per
// {family, size, weight} key. Characters are laid out in a grid with
// padding to avoid bleeding between cells at linear filtering.
//
// Fixes over the v0 implementation:
//   - Uses `actualBoundingBox{Ascent,Descent}` correctly (clamping to a
//     positive minimum so the negative-ascent edge case can't break layout).
//   - Pre-loads the requested font via the FontFace API BEFORE measuring,
//     so we measure the actual font, not the browser fallback.
//   - Documents that the caller MUST await loadFont() before requesting
//     an atlas. The atlas itself is sync once fonts are ready.

import type { Backend, Texture } from '../backend/backend.js';
import { getLogger } from '../logger.js';

// The atlas charset. ASCII printable plus the Unicode punctuation +
// symbols that actually appear in modern Western text — smart quotes,
// dashes, bullets, currency, etc. Without these, paintviz-style content
// (curly quotes around dialogue, em-dashes in citations, · separators)
// drops glyphs at render time.
//
// Longer-term: scan the Source for actually-used characters and build a
// per-source atlas, so non-Latin content "just works" without growing
// this string further.
const ASCII_PRINTABLE =
  ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~' +
  // Latin-1 punctuation + symbols
  ' ¢£¥¦§©«®°±·»¿×÷' +
  // General Punctuation: en/em dash, smart quotes, ellipsis, bullets
  '–—‘’“”„†‡•…‰′″›‹' +
  // Common symbols: euro, trademark, registered, arrows
  '€™←↑→↓';

// ── Grapheme segmentation ──────────────────────────────────────────
// The atlas is keyed by GRAPHEME CLUSTER, not UTF-16 unit or codepoint, so
// surrogate pairs, skin-tone modifiers and ZWJ emoji families each occupy
// one glyph and animate as one unit. Intl.Segmenter ships in every Chrome
// the runtime targets; the fallback splits by codepoint.
let _segmenter: Intl.Segmenter | null | undefined;
export function segmentGraphemes(text: string): string[] {
  if (_segmenter === undefined) {
    _segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl
      ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
      : null;
  }
  if (!_segmenter) return [...text];
  const out: string[] = [];
  for (const s of _segmenter.segment(text)) out.push(s.segment);
  return out;
}

const DEFAULT_CHARSET: readonly string[] = [...new Set(segmentGraphemes(ASCII_PRINTABLE))];

/** Per-character metrics within the atlas. */
export interface AtlasGlyph {
  /**
   * Top-left of the glyph's TIGHT bounding box in the atlas (with a small
   * AA margin baked in). Renderers sample this region with full-extent UVs —
   * no inset needed because the AA-margin pixels themselves act as the
   * safe buffer between the glyph ink and neighboring cells.
   */
  x: number;
  y: number;
  /** Tight bounding-box dimensions (with AA margin). */
  width: number;
  height: number;
  /** Horizontal advance for the cursor after drawing this glyph. */
  advance: number;
  /** Offset from the cursor X to the quad's left edge (typically negative). */
  offsetX: number;
  /** Offset from the baseline Y to the quad's top edge (always negative — top is above baseline). */
  offsetY: number;
  /**
   * True for glyphs that rasterize with their OWN colors (emoji). Draw
   * untinted — `fill_color` must not multiply them; coverage glyphs keep
   * the normal tint path.
   */
  isColor: boolean;
}

export interface FontAtlas {
  readonly family: string;
  readonly size: number;
  readonly weight: string | number;
  /** Backing GPU texture. */
  readonly texture: Texture;
  /** Atlas dimensions in pixels (= texture.width × texture.height). */
  readonly width: number;
  readonly height: number;
  /** Glyph map: grapheme → metrics. */
  readonly glyphs: ReadonlyMap<string, AtlasGlyph>;
  /** The grapheme list this atlas was built from (for on-demand regrowth). */
  readonly charset: readonly string[];
  /**
   * Font DESIGN ascent in pixels (fontBoundingBoxAscent) — what CSS
   * line layout centers in the line box. Not the ink bound.
   */
  readonly ascent: number;
  /** Font DESIGN descent in pixels (fontBoundingBoxDescent). */
  readonly descent: number;
  /** Recommended line height in pixels. */
  readonly lineHeight: number;
  /**
   * Pair-kerning adjustment in pixels: measureText(a+b) − advance(a)
   * − advance(b). Usually negative ("AV", "To"). Browsers kern by
   * default, so per-char advance sums read a few px wider than CSS —
   * enough to spuriously wrap text in a box it exactly fit. Lazily
   * computed and cached per pair; 0 when either char has no glyph.
   */
  readonly kern: (a: string, b: string) => number;
}

export interface FontAtlasKey {
  family: string;
  size: number;
  weight: string | number;
}

export function atlasKey(k: FontAtlasKey): string {
  return `${k.family}|${k.size}|${k.weight}`;
}

/**
 * Generate a font atlas synchronously. Caller must have already awaited
 * font loading (loadFont + document.fonts.ready) — this function does
 * NOT load fonts.
 */
export function generateFontAtlas(
  key: FontAtlasKey,
  backend: Backend,
  charset: readonly string[] = DEFAULT_CHARSET,
): FontAtlas {
  const { family, size, weight } = key;
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(1, 1)
    : document.createElement('canvas');
  const ctx = (canvas as HTMLCanvasElement).getContext('2d', { willReadFrequently: false });
  if (!ctx) throw new Error('Failed to acquire 2D context for font atlas');

  const fontSpec = `${weight} ${size}px ${family}`;
  ctx.font = fontSpec;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  // Measure baseline metrics from a reference string with ascenders + descenders.
  // Clamp to positive minimums: browsers occasionally return negative ascents
  // for fallback fonts, which used to break v0 layout.
  //
  // Two metric sets with different jobs:
  //   - INK bounds (actualBoundingBox*, maxed over the charset below)
  //     size the atlas cells — a cell must contain every drawn pixel.
  //   - DESIGN metrics (fontBoundingBox*) drive line LAYOUT. CSS
  //     half-leading centers the font's design block in the line box;
  //     centering the ink block instead shifts baselines by a few px
  //     in a per-font direction (Inter reads high, DejaVu low).
  const refMetrics = ctx.measureText('Mg');
  let ascent = Math.max(size * 0.6, refMetrics.actualBoundingBoxAscent || size * 0.8);
  let descent = Math.max(size * 0.15, refMetrics.actualBoundingBoxDescent || size * 0.2);
  let fontAscent = Math.max(
    size * 0.6,
    refMetrics.fontBoundingBoxAscent || refMetrics.actualBoundingBoxAscent || size * 0.8,
  );
  let fontDescent = Math.max(
    size * 0.1,
    refMetrics.fontBoundingBoxDescent || refMetrics.actualBoundingBoxDescent || size * 0.2,
  );
  // fontBoundingBox APPROXIMATES the metrics Chrome's line layout
  // uses, but disagrees per font (sohne-var lays out 3px high, Inter
  // 2px low through it). When a document is available, measure the
  // REAL baseline with a zero-size inline-block strut — its baseline
  // sits on the text baseline, so offsetTop+offsetHeight inside a
  // line-height:1 block IS Chrome's within-line-box baseline. Only
  // the half-leading combo (ascent − descent)/2 affects our layout,
  // so anchoring ascent = baseline, descent = size − baseline
  // reproduces DOM positions exactly at any line_height.
  if (typeof document !== 'undefined' && document.body) {
    const probe = document.createElement('div');
    probe.style.cssText =
      `position:absolute;visibility:hidden;left:-9999px;top:0;` +
      `white-space:nowrap;font:${fontSpec};line-height:${size}px;`;
    probe.textContent = 'Hg';
    const strut = document.createElement('span');
    strut.style.cssText = 'display:inline-block;width:0;height:0;';
    probe.appendChild(strut);
    document.body.appendChild(probe);
    const baseline = strut.offsetTop + strut.offsetHeight;
    probe.remove();
    if (baseline > 0 && baseline < size * 2) {
      fontAscent = baseline;
      fontDescent = size - baseline;
    }
  }

  // Measure every glyph individually. Some characters in ASCII (notably '@',
  // '%', '$', '|', '~') can exceed the 'Mg' reference. Use the per-glyph max
  // so the cell is always big enough for the tallest character.
  interface GlyphMetrics {
    width: number;
    advance: number;
    aLeft: number;
    aRight: number;
    aAscent: number;
    aDescent: number;
  }
  const metrics = new Map<string, GlyphMetrics>();
  let maxCellWidth = 0;
  for (const ch of charset) {
    const m = ctx.measureText(ch);
    const advance = m.width;
    const aLeft = m.actualBoundingBoxLeft || 0;
    const aRight = m.actualBoundingBoxRight || advance;
    const aAscent = m.actualBoundingBoxAscent || ascent;
    const aDescent = m.actualBoundingBoxDescent || descent;
    const width = Math.ceil(Math.max(advance, aLeft + aRight));
    metrics.set(ch, { width, advance, aLeft, aRight, aAscent, aDescent });
    if (width > maxCellWidth) maxCellWidth = width;
    if (aAscent > ascent) ascent = aAscent;
    if (aDescent > descent) descent = aDescent;
  }

  // Generous padding inside each cell. With ≥ 4 pixels of empty space around
  // every glyph, bilinear filtering at the cell edge samples only padding
  // pixels (transparent) — never neighboring glyphs. Combined with the
  // half-texel UV inset on the read side, this eliminates glyph bleed.
  const PADDING = 4;
  const cellWidth = Math.ceil(maxCellWidth + 2 * PADDING);
  const cellHeight = Math.ceil(ascent + descent + 2 * PADDING);

  // Layout in a square-ish grid.
  const cols = Math.ceil(Math.sqrt(charset.length));
  const rows = Math.ceil(charset.length / cols);
  const atlasWidth = cols * cellWidth;
  const atlasHeight = rows * cellHeight;

  // Cap at backend's max texture size — bail loudly if we exceed.
  const maxDim = backend.capabilities.maxTextureSize;
  if (atlasWidth > maxDim || atlasHeight > maxDim) {
    throw new Error(
      `Font atlas for ${family} ${size}px ${weight} (${atlasWidth}×${atlasHeight}) ` +
        `exceeds backend max texture dimension ${maxDim}.`,
    );
  }

  canvas.width = atlasWidth;
  canvas.height = atlasHeight;

  // Re-set font on the resized canvas (browsers clear context state on resize).
  ctx.font = fontSpec;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  ctx.clearRect(0, 0, atlasWidth, atlasHeight);

  // Render each glyph and record its metrics.
  // Antialiasing margin (in pixels) baked into each glyph's atlas bounds.
  // This is what the renderer samples at the quad edge — guaranteed to be
  // either transparent or a low-alpha AA fringe, never another glyph's ink.
  const AA_MARGIN = 2;

  const glyphs = new Map<string, AtlasGlyph>();
  for (let i = 0; i < charset.length; i++) {
    const ch = charset[i]!;
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cellX = col * cellWidth;
    const cellY = row * cellHeight;
    const baselineY = cellY + PADDING + ascent;
    const penX = cellX + PADDING;

    // Render glyph at the baseline. textBaseline: 'alphabetic' means y is baseline.
    ctx.fillText(ch, penX, baselineY);

    const m = metrics.get(ch)!;

    // Compute the glyph's tight bounding box from its actual measured bounds,
    // plus AA margin, then clamp to the cell so a runaway measurement can't
    // pick up neighboring cells.
    let glyphLeft = Math.floor(penX - m.aLeft) - AA_MARGIN;
    let glyphRight = Math.ceil(penX + m.aRight) + AA_MARGIN;
    let glyphTop = Math.floor(baselineY - m.aAscent) - AA_MARGIN;
    let glyphBottom = Math.ceil(baselineY + m.aDescent) + AA_MARGIN;

    glyphLeft = Math.max(cellX, glyphLeft);
    glyphRight = Math.min(cellX + cellWidth, glyphRight);
    glyphTop = Math.max(cellY, glyphTop);
    glyphBottom = Math.min(cellY + cellHeight, glyphBottom);

    const glyphW = Math.max(0, glyphRight - glyphLeft);
    const glyphH = Math.max(0, glyphBottom - glyphTop);

    glyphs.set(ch, {
      x: glyphLeft,
      y: glyphTop,
      width: glyphW,
      height: glyphH,
      advance: m.advance,
      offsetX: glyphLeft - penX,
      offsetY: glyphTop - baselineY,
      isColor: false,
    });
  }

  // Color-glyph detection: emoji rasterize in their own colors regardless of
  // fillStyle, so any glyph whose ink has chroma is a color glyph and must be
  // drawn UNTINTED. One readback per atlas build (builds are rare + logged).
  try {
    const img = ctx.getImageData(0, 0, atlasWidth, atlasHeight);
    const px = img.data;
    for (const g of glyphs.values()) {
      let color = false;
      for (let yy = g.y; yy < g.y + g.height && !color; yy++) {
        let idx = (yy * atlasWidth + g.x) * 4;
        for (let xx = 0; xx < g.width; xx++, idx += 4) {
          const a = px[idx + 3]!;
          if (a > 16) {
            const r = px[idx]!, gg = px[idx + 1]!, b = px[idx + 2]!;
            if (Math.abs(r - gg) > 24 || Math.abs(gg - b) > 24 || Math.abs(r - b) > 24) {
              color = true;
              break;
            }
          }
        }
      }
      if (color) g.isColor = true;
    }
  } catch {
    // Readback can fail on exotic canvas backends; glyphs stay coverage-tinted.
  }

  getLogger().debug(
    `Generated font atlas: ${family} ${size}px ${weight} (${atlasWidth}×${atlasHeight}, ${charset.length} glyphs)`,
  );

  const texture = backend.createTexture(canvas as HTMLCanvasElement);

  // Dedicated 1×1 measuring context for lazy pair-kerning — the atlas
  // canvas itself would otherwise be retained at full size by the
  // closure after its texture upload.
  const kernCanvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(1, 1)
    : document.createElement('canvas');
  const kernCtx = (kernCanvas as HTMLCanvasElement).getContext('2d')!;
  kernCtx.font = fontSpec;
  const kernCache = new Map<string, number>();
  const kern = (a: string, b: string): number => {
    if (a === '' || b === '') return 0;
    const key = a + b;
    let v = kernCache.get(key);
    if (v === undefined) {
      const ma = metrics.get(a);
      const mb = metrics.get(b);
      if (!ma || !mb) {
        v = 0;
      } else {
        if (kernCtx.font !== fontSpec) kernCtx.font = fontSpec;
        v = kernCtx.measureText(key).width - ma.advance - mb.advance;
      }
      kernCache.set(key, v);
    }
    return v;
  };

  return {
    family,
    size,
    weight,
    texture,
    width: atlasWidth,
    height: atlasHeight,
    glyphs,
    charset,
    // Exported ascent/descent are the DESIGN metrics used for line
    // layout. Cell geometry above keeps using the ink-bound values;
    // glyph offsets are baseline-relative, so the two never mix.
    ascent: fontAscent,
    descent: fontDescent,
    lineHeight: cellHeight,
    kern,
  };
}

/**
 * Ensure `atlas` has a glyph for every grapheme in `text`. Returns the same
 * atlas when nothing is missing; otherwise regenerates the atlas with the
 * union charset (existing order + new graphemes sorted — deterministic for a
 * given Source), destroys the old texture, and returns the replacement.
 * Callers must re-store the result in their cache.
 */
export function ensureAtlasGlyphs(
  atlas: FontAtlas,
  backend: Backend,
  text: string,
): FontAtlas {
  let missing: Set<string> | null = null;
  for (const ch of segmentGraphemes(text)) {
    if (ch === '\n' || ch === '\r') continue;
    if (!atlas.glyphs.has(ch)) (missing ??= new Set()).add(ch);
  }
  if (!missing) return atlas;
  const next = generateFontAtlas(
    { family: atlas.family, size: atlas.size, weight: atlas.weight },
    backend,
    [...atlas.charset, ...[...missing].sort()],
  );
  backend.destroyTexture(atlas.texture);
  return next;
}
