// The ascii effect's embedded 8×8 bitmap font (PROTOCOL.md §4.7).
//
// Glyph shapes are NORMATIVE protocol data, not a styling choice: if
// the ascii effect rasterized a system monospace font, the same source
// would produce different pixels on different machines. These bitmaps
// make the effect deterministic everywhere — don't swap them for
// canvas-drawn text.
//
// Ten glyphs ordered by ink coverage (luminance bucket i renders
// glyph i): space . - : = + % * @ #
// Each glyph is 8 row bytes, MSB = leftmost pixel.

const GLYPH_ROWS: ReadonlyArray<readonly number[]> = [
  /* ' ' */ [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
  /* '.' */ [0x00, 0x00, 0x00, 0x00, 0x00, 0x18, 0x18, 0x00],
  /* '-' */ [0x00, 0x00, 0x00, 0x7e, 0x00, 0x00, 0x00, 0x00],
  /* ':' */ [0x00, 0x18, 0x18, 0x00, 0x00, 0x18, 0x18, 0x00],
  /* '=' */ [0x00, 0x00, 0x7e, 0x00, 0x7e, 0x00, 0x00, 0x00],
  /* '+' */ [0x00, 0x18, 0x18, 0x7e, 0x18, 0x18, 0x00, 0x00],
  /* '%' */ [0x00, 0xc6, 0xcc, 0x18, 0x30, 0x66, 0xc6, 0x00],
  /* '*' */ [0x00, 0x66, 0x3c, 0xff, 0x3c, 0x66, 0x00, 0x00],
  /* '@' */ [0x7c, 0xc6, 0xde, 0xde, 0xde, 0xc0, 0x78, 0x00],
  /* '#' */ [0x6c, 0x6c, 0xfe, 0x6c, 0xfe, 0x6c, 0x6c, 0x00],
];

export const ASCII_ATLAS_WIDTH = 80; // 10 glyphs × 8 px
export const ASCII_ATLAS_HEIGHT = 8;

/**
 * Rasterize the ramp into an 80×8 canvas — white ink on transparent —
 * ready for Backend.createTexture (which premultiplies on upload).
 */
export function buildAsciiAtlasCanvas(): OffscreenCanvas {
  const canvas = new OffscreenCanvas(ASCII_ATLAS_WIDTH, ASCII_ATLAS_HEIGHT);
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(ASCII_ATLAS_WIDTH, ASCII_ATLAS_HEIGHT);
  for (let glyph = 0; glyph < GLYPH_ROWS.length; glyph++) {
    const rows = GLYPH_ROWS[glyph]!;
    for (let y = 0; y < 8; y++) {
      const bits = rows[y]!;
      for (let x = 0; x < 8; x++) {
        if ((bits & (0x80 >> x)) === 0) continue;
        const i = (y * ASCII_ATLAS_WIDTH + glyph * 8 + x) * 4;
        img.data[i] = 255;
        img.data[i + 1] = 255;
        img.data[i + 2] = 255;
        img.data[i + 3] = 255;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
