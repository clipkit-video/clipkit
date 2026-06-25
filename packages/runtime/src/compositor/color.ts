// Color parsing and premultiplied-alpha utilities.
//
// All colors flow through the renderer as premultiplied [r, g, b, a] in 0..1.
// Schema fields like fill_color are CSS-style hex strings; parseColor turns
// them into premultiplied tuples ready for shaders.

export type RGBA = readonly [number, number, number, number];

const WHITE: RGBA = [1, 1, 1, 1];
const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

// CSS Color Module Level 4 extended color keywords (148 names) + the
// `transparent` keyword. Values are #rrggbb; `transparent` is handled
// separately. Agents lean hard on named colors from their CSS prior, so
// supporting the full set (not a subset) avoids silent white fallbacks.
const NAMED_COLORS: Record<string, string> = {
  aliceblue: '#f0f8ff', antiquewhite: '#faebd7', aqua: '#00ffff', aquamarine: '#7fffd4',
  azure: '#f0ffff', beige: '#f5f5dc', bisque: '#ffe4c4', black: '#000000',
  blanchedalmond: '#ffebcd', blue: '#0000ff', blueviolet: '#8a2be2', brown: '#a52a2a',
  burlywood: '#deb887', cadetblue: '#5f9ea0', chartreuse: '#7fff00', chocolate: '#d2691e',
  coral: '#ff7f50', cornflowerblue: '#6495ed', cornsilk: '#fff8dc', crimson: '#dc143c',
  cyan: '#00ffff', darkblue: '#00008b', darkcyan: '#008b8b', darkgoldenrod: '#b8860b',
  darkgray: '#a9a9a9', darkgreen: '#006400', darkgrey: '#a9a9a9', darkkhaki: '#bdb76b',
  darkmagenta: '#8b008b', darkolivegreen: '#556b2f', darkorange: '#ff8c00', darkorchid: '#9932cc',
  darkred: '#8b0000', darksalmon: '#e9967a', darkseagreen: '#8fbc8f', darkslateblue: '#483d8b',
  darkslategray: '#2f4f4f', darkslategrey: '#2f4f4f', darkturquoise: '#00ced1', darkviolet: '#9400d3',
  deeppink: '#ff1493', deepskyblue: '#00bfff', dimgray: '#696969', dimgrey: '#696969',
  dodgerblue: '#1e90ff', firebrick: '#b22222', floralwhite: '#fffaf0', forestgreen: '#228b22',
  fuchsia: '#ff00ff', gainsboro: '#dcdcdc', ghostwhite: '#f8f8ff', gold: '#ffd700',
  goldenrod: '#daa520', gray: '#808080', green: '#008000', greenyellow: '#adff2f',
  grey: '#808080', honeydew: '#f0fff0', hotpink: '#ff69b4', indianred: '#cd5c5c',
  indigo: '#4b0082', ivory: '#fffff0', khaki: '#f0e68c', lavender: '#e6e6fa',
  lavenderblush: '#fff0f5', lawngreen: '#7cfc00', lemonchiffon: '#fffacd', lightblue: '#add8e6',
  lightcoral: '#f08080', lightcyan: '#e0ffff', lightgoldenrodyellow: '#fafad2', lightgray: '#d3d3d3',
  lightgreen: '#90ee90', lightgrey: '#d3d3d3', lightpink: '#ffb6c1', lightsalmon: '#ffa07a',
  lightseagreen: '#20b2aa', lightskyblue: '#87cefa', lightslategray: '#778899', lightslategrey: '#778899',
  lightsteelblue: '#b0c4de', lightyellow: '#ffffe0', lime: '#00ff00', limegreen: '#32cd32',
  linen: '#faf0e6', magenta: '#ff00ff', maroon: '#800000', mediumaquamarine: '#66cdaa',
  mediumblue: '#0000cd', mediumorchid: '#ba55d3', mediumpurple: '#9370db', mediumseagreen: '#3cb371',
  mediumslateblue: '#7b68ee', mediumspringgreen: '#00fa9a', mediumturquoise: '#48d1cc', mediumvioletred: '#c71585',
  midnightblue: '#191970', mintcream: '#f5fffa', mistyrose: '#ffe4e1', moccasin: '#ffe4b5',
  navajowhite: '#ffdead', navy: '#000080', oldlace: '#fdf5e6', olive: '#808000',
  olivedrab: '#6b8e23', orange: '#ffa500', orangered: '#ff4500', orchid: '#da70d6',
  palegoldenrod: '#eee8aa', palegreen: '#98fb98', paleturquoise: '#afeeee', palevioletred: '#db7093',
  papayawhip: '#ffefd5', peachpuff: '#ffdab9', peru: '#cd853f', pink: '#ffc0cb',
  plum: '#dda0dd', powderblue: '#b0e0e6', purple: '#800080', rebeccapurple: '#663399',
  red: '#ff0000', rosybrown: '#bc8f8f', royalblue: '#4169e1', saddlebrown: '#8b4513',
  salmon: '#fa8072', sandybrown: '#f4a460', seagreen: '#2e8b57', seashell: '#fff5ee',
  sienna: '#a0522d', silver: '#c0c0c0', skyblue: '#87ceeb', slateblue: '#6a5acd',
  slategray: '#708090', slategrey: '#708090', snow: '#fffafa', springgreen: '#00ff7f',
  steelblue: '#4682b4', tan: '#d2b48c', teal: '#008080', thistle: '#d8bfd8',
  tomato: '#ff6347', turquoise: '#40e0d0', violet: '#ee82ee', wheat: '#f5deb3',
  white: '#ffffff', whitesmoke: '#f5f5f5', yellow: '#ffff00', yellowgreen: '#9acd32',
};

/** Convert HSL (h in degrees, s/l in 0..1) to straight RGB in 0..1. */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hn = (((h % 360) + 360) % 360) / 360;
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t: number): number => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return [hue(hn + 1 / 3), hue(hn), hue(hn - 1 / 3)];
}

/**
 * Parse a CSS-style color string into straight-alpha RGBA in 0..1.
 * Supports: #rgb, #rgba, #rrggbb, #rrggbbaa, rgb()/rgba(), hsl()/hsla(),
 * the 148 CSS named colors, and `transparent`. Falls back to white for
 * invalid input.
 */
export function parseColor(input: string | undefined | null): RGBA {
  if (!input) return WHITE;
  let s = input.trim();

  // rgb() / rgba() — CSS-style numeric color. Importer emits these
  // for colors with alpha that don't round-trip cleanly to hex
  // (the box-shadow source format especially).
  if (s.startsWith('rgb')) {
    const m = s.match(/^rgba?\(\s*([-\d.]+)\s*[,\s]\s*([-\d.]+)\s*[,\s]\s*([-\d.]+)(?:\s*[,/]\s*([-\d.]+%?))?\s*\)$/i);
    if (!m) return WHITE;
    const r = (parseFloat(m[1]!) || 0) / 255;
    const g = (parseFloat(m[2]!) || 0) / 255;
    const b = (parseFloat(m[3]!) || 0) / 255;
    let a = 1;
    if (m[4]) {
      a = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
      if (!Number.isFinite(a)) a = 1;
    }
    return [clamp01(r), clamp01(g), clamp01(b), clamp01(a)];
  }

  // hsl() / hsla() — accepts comma or space separators and an optional
  // `deg` on the hue (CSS Color 4 syntaxes).
  if (s.startsWith('hsl')) {
    const m = s.match(/^hsla?\(\s*([-\d.]+)(?:deg)?\s*[,\s]\s*([-\d.]+)%\s*[,\s]\s*([-\d.]+)%(?:\s*[,/]\s*([-\d.]+%?))?\s*\)$/i);
    if (!m) return WHITE;
    const [r, g, b] = hslToRgb(parseFloat(m[1]!) || 0, clamp01((parseFloat(m[2]!) || 0) / 100), clamp01((parseFloat(m[3]!) || 0) / 100));
    let a = 1;
    if (m[4]) {
      a = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
      if (!Number.isFinite(a)) a = 1;
    }
    return [clamp01(r), clamp01(g), clamp01(b), clamp01(a)];
  }

  // Named colors (case-insensitive). `transparent` is the only keyword
  // that carries alpha; the rest resolve to a hex string parsed below.
  if (!s.startsWith('#')) {
    const lower = s.toLowerCase();
    if (lower === 'transparent') return [0, 0, 0, 0];
    const named = NAMED_COLORS[lower];
    if (!named) return WHITE;
    s = named;
  }

  const hex = s.slice(1);
  let r = 1, g = 1, b = 1, a = 1;

  if (hex.length === 3) {
    // #rgb → expand each nibble
    r = parseInt(hex[0]! + hex[0]!, 16) / 255;
    g = parseInt(hex[1]! + hex[1]!, 16) / 255;
    b = parseInt(hex[2]! + hex[2]!, 16) / 255;
  } else if (hex.length === 4) {
    r = parseInt(hex[0]! + hex[0]!, 16) / 255;
    g = parseInt(hex[1]! + hex[1]!, 16) / 255;
    b = parseInt(hex[2]! + hex[2]!, 16) / 255;
    a = parseInt(hex[3]! + hex[3]!, 16) / 255;
  } else if (hex.length === 6) {
    r = parseInt(hex.slice(0, 2), 16) / 255;
    g = parseInt(hex.slice(2, 4), 16) / 255;
    b = parseInt(hex.slice(4, 6), 16) / 255;
  } else if (hex.length === 8) {
    r = parseInt(hex.slice(0, 2), 16) / 255;
    g = parseInt(hex.slice(2, 4), 16) / 255;
    b = parseInt(hex.slice(4, 6), 16) / 255;
    a = parseInt(hex.slice(6, 8), 16) / 255;
  } else {
    return WHITE;
  }

  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b) || !Number.isFinite(a)) {
    return WHITE;
  }

  return [r, g, b, a];
}

/**
 * Convert straight-alpha RGBA to premultiplied. Premultiplied alpha is the
 * convention throughout the runtime; shaders, textures, and the canvas
 * swap-chain all use `alphaMode: "premultiplied"`.
 */
export function premultiply(c: RGBA): RGBA {
  const [r, g, b, a] = c;
  return [r * a, g * a, b * a, a];
}

/**
 * Shorthand: parse a hex color and premultiply in one step.
 */
export function parseColorPremultiplied(input: string | undefined | null): RGBA {
  return premultiply(parseColor(input));
}

/**
 * Format straight-alpha RGBA (0..1) back to a CSS rgba() string that
 * parseColor round-trips. Used by animated colors: the interpolator
 * works in RGBA space, then renderers consume the result through the
 * same string-color paths as static schema values.
 */
export function rgbaToCss(c: RGBA): string {
  const r = Math.round(Math.max(0, Math.min(1, c[0])) * 255);
  const g = Math.round(Math.max(0, Math.min(1, c[1])) * 255);
  const b = Math.round(Math.max(0, Math.min(1, c[2])) * 255);
  const a = Math.max(0, Math.min(1, c[3]));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
