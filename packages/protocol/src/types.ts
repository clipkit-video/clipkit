// Clipkit schema — TypeScript types.
//
// v1 is compatible with the prevailing JSON video-markup conventions used
// by hosted video-API platforms. Const arrays below are the single source of
// truth: Zod enums and runtime registries are derived from them, and adding
// a value here (a new element type, output format, caption style, easing)
// propagates everywhere automatically.

// ────────────────────────────────────────────────────────────────────────────
// Const-driven enums
// ────────────────────────────────────────────────────────────────────────────

// Video-only: 'mp4' (H.264/AVC + AAC) and 'gif' (animated). Still-image output
// ('jpg'/'png') was dropped — Clipkit produces video, not stills.
export const OUTPUT_FORMATS = ['mp4', 'gif'] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

export const ELEMENT_TYPES = [
  'video',
  'image',
  'text',
  'shape',
  'audio',
  'group',
  'caption',
  'particles',
] as const;
export type ElementType = (typeof ELEMENT_TYPES)[number];

export const UNITS = ['px', '%', 'vw', 'vh', 'vmin', 'vmax'] as const;
export type Unit = (typeof UNITS)[number];

export const EASING_FUNCTIONS = [
  'linear',
  'ease',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'ease-in-cubic',
  'ease-out-cubic',
  'ease-in-out-cubic',
  'ease-in-quad',
  'ease-out-quad',
  'ease-in-out-quad',
  'ease-in-quart',
  'ease-out-quart',
  'ease-in-out-quart',
  'ease-in-quint',
  'ease-out-quint',
  'ease-in-out-quint',
  'ease-in-sine',
  'ease-out-sine',
  'ease-in-out-sine',
  'ease-in-expo',
  'ease-out-expo',
  'ease-in-out-expo',
  'ease-in-circ',
  'ease-out-circ',
  'ease-in-out-circ',
  'ease-in-back',
  'ease-out-back',
  'ease-in-out-back',
  // Damped harmonic oscillator with sensible defaults (mass=1, damping=10,
  // stiffness=100). Overshoots ~5%, then settles — the classic springy look.
  'spring',
  // Elastic: overshoots with a decaying sinusoidal wobble (easings.net).
  'elastic-in',
  'elastic-out',
  'elastic-in-out',
  // Bounce: ball-drop bounces. Distinct from the bounce-in/out animation
  // PRESETS (which are scale tweens) — these are easing curves.
  'bounce-in',
  'bounce-out',
  'bounce-in-out',
] as const;
export type EasingFunction = (typeof EASING_FUNCTIONS)[number];

/**
 * An easing value: a named curve from EASING_FUNCTIONS, or a parametric
 * form —
 *   `cubic-bezier(x1, y1, x2, y2)` — CSS timing-function semantics
 *     (x1/x2 clamped to [0, 1]; y1/y2 unbounded for overshoot).
 *   `steps(n)` — n equidistant steps, jump-at-end (CSS `steps(n, end)`).
 */
export type Easing =
  | EasingFunction
  | `cubic-bezier(${string})`
  | `steps(${string})`;

// Named animation presets. These ARE the "animation presets" referred to in
// marketing copy — no separate registry needed.
export const ANIMATION_TYPES = [
  'fade-in',
  'fade-out',
  'slide-left-in',
  'slide-right-in',
  'slide-up-in',
  'slide-down-in',
  'slide-left-out',
  'slide-right-out',
  'slide-up-out',
  'slide-down-out',
  'scale-in',
  'scale-out',
  'rotate-in',
  'rotate-out',
  'bounce-in',
  'bounce-out',
  // Continuous / accent presets. spin rotates by `rotation` degrees;
  // shake oscillates x with decaying amplitude; wiggle oscillates
  // rotation at constant amplitude; squash is a squash-and-stretch
  // accent; pan drifts position across the window; shift translates by
  // `distance` once. spin/shake/wiggle/pan default to the element's
  // full duration when `time` and `duration` are both omitted.
  'spin',
  'shake',
  'wiggle',
  'squash',
  'pan',
  'shift',
  // Preset vocabulary v2 (the expressions replacement, §6.2):
  //   drift    seeded smooth random walk on x/y (organic float) —
  //            `distance` px amplitude, `frequency` Hz, `seed`
  //   breathe  gentle scale oscillation — `scale` amplitude, `frequency`
  //   orbit    circular position motion — `distance` radius px,
  //            `frequency` rev/s, `direction` right=cw / left=ccw
  'drift',
  'breathe',
  'orbit',
  // Per-unit text animations (text elements only; ignored elsewhere).
  // The text splits into letters or words (`split`, defaults below) and
  // each unit animates independently, offset by `stagger` seconds:
  //   text-appear      per-unit fade-in
  //   text-slide       per-unit slide + fade from `direction` (default up)
  //                    over `distance` px (default 40)
  //   text-fly         like text-slide but farther (default 140px) with
  //                    an overshoot ease — units "land"
  //   text-typewriter  units pop in instantly at their stagger time
  //   text-wave        ambient sine bob (amplitude `distance` px,
  //                    default 12; `frequency` Hz, default 1.5); runs
  //                    the element's full duration when untimed
  //   text-flip        per-unit 3D flip-in: each unit rotates from
  //                    `rotation` degrees (default 90) to rest about
  //                    its own center along `axis` (default 'x') while
  //                    fading in — CKP/1.0, §6.5
  // Defaults: split = 'word' (slide/appear/fly) or 'letter'
  // (typewriter/wave/flip); stagger = 0.09s for words, 0.035s for
  // letters. v1 limits: entrance-only (`time: 'end'` unsupported);
  // plain `text` and `spans` supported, captions have their own
  // kinetics.
  'text-appear',
  'text-slide',
  'text-fly',
  'text-typewriter',
  'text-wave',
  'text-flip',
] as const;
export type AnimationType = (typeof ANIMATION_TYPES)[number];

// Clipkit extension: word-timed caption styles. Snake_case to match the
// rest of the schema's property naming.
export const CAPTION_STYLES = [
  'tiktok_bounce',
  'fade_reveal',
  'kinetic_typewriter',
  'word_pop',
] as const;
export type CaptionStyle = (typeof CAPTION_STYLES)[number];

// ────────────────────────────────────────────────────────────────────────────
// Keyframes & animations
// ────────────────────────────────────────────────────────────────────────────

/**
 * Tier-A expression (CKP/1.0, §Expressions). A numeric property may be
 * `{ expr: "..." }` — a PURE function of the element's local time `t` and its
 * own index/params (`i`, `n`, `dur`, `value`). No element references, no runtime
 * inputs: deterministic across renderers, and bakeable to keyframes. The scope is
 * closed (a fixed set of math/motion functions); anything else is a parse error
 * and the property falls back to its base value. See PROTOCOL.md §Expressions.
 */
export interface Expr {
  expr: string;
}

export interface Keyframe {
  time: number | string;
  // Single scalar value, [x, y] for 2D position paths, or [x, y, z]
  // for 3D position paths (§6.7; z in px, +z toward viewer, §4.4).
  // All keyframes of one position path must agree in dimensionality.
  value: number | string | [number, number] | [number, number, number];
  easing?: Easing;
  /**
   * Spatial bezier handles for `property: "position"` paths (§6.7),
   * RELATIVE to this keyframe's value: `out_tangent` shapes the curve
   * leaving this keyframe, `in_tangent` the curve arriving at it.
   * Omitted handles default to the straight-line third-points, so a
   * path without handles is polyline motion. On a 3D path a
   * 2-component handle's z defaults to the straight-line third-point
   * in z; 3-component handles on a 2D path are invalid. Ignored on
   * scalar keyframes.
   */
  in_tangent?: [number, number] | [number, number, number];
  out_tangent?: [number, number] | [number, number, number];
}

// NOTE on transitions: Clipkit deliberately has NO transition primitive
// for effects that decompose into per-element animations. A crossfade
// is two overlapping elements with opposite fades; a push is two
// opposite slides. The protocol stays exactly literal — nothing renders
// that isn't written on the element. See AGENTS.md "Transitions" for
// the authoring pattern. A first-class two-layer transition object is
// reserved for irreducible effects (wipes, morphs) once render-target
// compositing lands.

export interface Animation {
  type: AnimationType;
  duration?: number;
  easing?: Easing;
  /**
   * Unit granularity for text-* animations: animate per letter or per
   * word. Defaults per type (see ANIMATION_TYPES). Ignored on
   * non-text animations.
   */
  split?: 'letter' | 'word';
  /**
   * Seconds between successive units' start times (text-* animations).
   * Defaults: 0.09 for word splits, 0.035 for letter splits.
   */
  stagger?: number;
  time?: 'start' | 'end' | number;
  /** Oscillation frequency in Hz (shake, wiggle). Defaults: shake 8, wiggle 2. */
  frequency?: number;
  /** Total rotation in degrees (spin), wobble amplitude in degrees (wiggle), or starting flip angle in degrees (text-flip, default 90). */
  rotation?: number;
  /** Rotation axis for text-flip: 'x' (flip up, default), 'y' (swing in), 'z' (in-plane spin). CKP/1.0. */
  axis?: 'x' | 'y' | 'z';
  /** Travel distance in pixels (pan, shift) or shake amplitude in pixels. Defaults: pan/shift 200, shake 24. */
  distance?: number;
  /** Motion direction (pan, shift). Default 'right'. */
  direction?: 'left' | 'right' | 'up' | 'down';
  /** Squash depth in [0, 1] (squash) or scale amplitude (breathe, default 0.05). */
  scale?: number;
  /** Lattice seed for `drift`'s normative noise (integer ≥ 0). Default 0. */
  seed?: number;
}

export interface KeyframeAnimation {
  property: string;
  keyframes: Keyframe[];
  easing?: Easing;
  /**
   * Repeat the keyframe pattern for the element's whole life (§6.3):
   * `true` wraps local time modulo the last keyframe's time;
   * `'ping-pong'` reflects it (forward, backward, forward, …).
   */
  loop?: boolean | 'ping-pong';
  /**
   * For `property: "position"` paths (§6.7): rotate the element to the
   * path's travel direction (tangent), added to its own rotation.
   * Strictly in-plane: on 3D paths the tangent's xy projection is
   * used and dz is ignored — auto_orient never derives x_rotation or
   * y_rotation. Default false.
   */
  auto_orient?: boolean;
}

// ────────────────────────────────────────────────────────────────────────────
// Stylize effects — `element.effects`, applied in array order (§4.7)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Mosaic: the element's pixels quantize to square cells; every pixel in
 * a cell takes the color sampled at the cell's center.
 */
export interface PixelateEffect {
  type: 'pixelate';
  /** Cell size in canvas pixels. Default 8, minimum 1. Animatable. */
  cell_size?: number | Keyframe[] | Expr;
}

/**
 * Ordered dithering: each color channel quantizes to `levels` values,
 * thresholded by the normative 4×4 Bayer matrix, producing the classic
 * retro crosshatch. levels: 2 = 1-bit per channel.
 */
export interface DitherEffect {
  type: 'dither';
  /** Quantization levels per channel. Default 4, minimum 2. Animatable. */
  levels?: number | Keyframe[] | Expr;
  /**
   * Size of each Bayer dither cell in LOGICAL pixels. Default 2. Larger
   * = chunkier, more visible retro dots; 1 = ultra-fine. Resolution-
   * independent (the dot size is stable across preview DPI / export, and
   * survives the editor's fit-to-stage downscale). Animatable.
   */
  pixel_size?: number | Keyframe[] | Expr;
}

/**
 * Print-style halftone: a rotated grid of dots, each dot's radius
 * proportional to the underlying luminance, colored with the cell's
 * sampled color. Coverage outside dots is transparent.
 */
export interface HalftoneEffect {
  type: 'halftone';
  /** Dot-grid cell size in canvas pixels. Default 8. Animatable. */
  cell_size?: number | Keyframe[] | Expr;
  /** Grid rotation in degrees. Default 45. Animatable. */
  angle?: number | Keyframe[] | Expr;
}

/**
 * ASCII-art: cells map to glyphs from a fixed 10-step density ramp,
 * tinted with the cell's sampled color. Glyph shapes come from the
 * protocol's embedded 8×8 bitmap font (normative — identical pixels on
 * every platform, no system-font dependence).
 */
export interface AsciiEffect {
  type: 'ascii';
  /** Cell size in canvas pixels. Default 12, minimum 4. Animatable. */
  cell_size?: number | Keyframe[] | Expr;
}

/**
 * Liquid glass: the element becomes a refractive, frosted pane over
 * its BACKDROP — the pixels already drawn beneath it in draw order.
 *
 * THE EXCEPTION (§4.7): every other effect reads only the element's
 * own rendered pixels; glass additionally reads the backdrop. It gets
 * this carve-out because the effect is widely known and in high
 * demand, and there is no proper decomposition — refraction needs the
 * pixels behind the pane. No other effect type reads the backdrop.
 *
 * The element's own rendered shape is the lens: its alpha masks the
 * pane (text and path shapes work too) and the refraction normal comes
 * from the alpha field's gradient. The element's fill COLOR is unused
 * under glass — tint with the `tint` param instead.
 */
export interface GlassEffect {
  type: 'glass';
  /** Backdrop Gaussian blur σ in px (frosting). Default 0 (clear glass). Animatable. */
  blur_radius?: number | Keyframe[] | Expr;
  /**
   * Refraction strength — approximate rim displacement in canvas px
   * (0 = flat frosted panel). The magnitude is used: displacement is
   * always toward the pane's interior, so glass magnifies what's
   * under it and never pulls in content from outside its footprint.
   * Default 21. Animatable.
   */
  refraction?: number | Keyframe[] | Expr;
  /** How far the lens curl reaches inward, in px. Default 40. Animatable. */
  edge_width?: number | Keyframe[] | Expr;
  /**
   * Intensity of the glass lighting rig — Blinn-Phong speculars,
   * Fresnel edge whitening, and the thin top-lit stroke — 0..1.
   * Default 0.35. Animatable.
   */
  edge_highlight?: number | Keyframe[] | Expr;
  /**
   * Drop-shadow strength 0..1, drawn ONLY outside the pane's footprint
   * (real glass never frosts its own shadow — prefer this over a
   * shadow sibling beneath the lens). Default 0.3. Animatable.
   */
  shadow?: number | Keyframe[] | Expr;
  /**
   * Chromatic dispersion: R/G/B refract at strengths
   * refraction × (1−d, 1, 1+d), producing the subtle rainbow fringe
   * of real glass at the lens edges. Default 0.05 (0 = off). Try 0.2.
   * Animatable.
   */
  dispersion?: number | Keyframe[] | Expr;
  /**
   * Saturation boost applied to the frosted backdrop (Rec. 709, same
   * math as the `saturation` filter) so content behind the glass stays
   * vibrant instead of going muddy. 1 = unchanged (default).
   * Animatable.
   */
  backdrop_saturation?: number | Keyframe[] | Expr;
  /** Tint drawn over the glass (use alpha for strength, e.g. "#FFFFFF22"). */
  tint?: string;
  /**
   * Lens cross-section: 'pill' (biconvex — light refracts at entry and
   * exit, the default card/button look) or 'dome' (flat bottom,
   * curved top — with edge_width = the shape's radius this is a
   * half-sphere magnifier).
   */
  mode?: 'pill' | 'dome';
}

/**
 * Outer glow: the element's silhouette, blurred and tinted, composited
 * BENEATH the element. The classic AE layer style.
 */
export interface GlowEffect {
  type: 'glow';
  /** Glow reach — Gaussian σ of the silhouette blur, px. Default 20. Animatable. */
  radius?: number | Keyframe[] | Expr;
  /** Glow strength multiplier. Default 1. Animatable. */
  intensity?: number | Keyframe[] | Expr;
  /** Glow color. Default "#FFFFFF". */
  color?: string;
}

/**
 * Drop shadow on ANY element (shapes have a native `shadow`; this one
 * works on text, images, shapes, groups — the blurred silhouette, offset
 * and tinted, composited beneath the element).
 */
export interface DropShadowEffect {
  type: 'drop_shadow';
  /** Shadow offset in px. Defaults (0, 12). Animatable. */
  offset_x?: number | Keyframe[] | Expr;
  offset_y?: number | Keyframe[] | Expr;
  /** Shadow softness — Gaussian σ in px. Default 18. Animatable. */
  blur?: number | Keyframe[] | Expr;
  /** Shadow color. Default "#000000". */
  color?: string;
  /** Shadow opacity 0..1. Default 0.6. Animatable. */
  opacity?: number | Keyframe[] | Expr;
}

/**
 * Outline stroke around the element's alpha silhouette (outside the
 * edge), on any element type.
 */
export interface StrokeEffect {
  type: 'stroke';
  /** Stroke width in px. Default 4. Animatable. */
  width?: number | Keyframe[] | Expr;
  /** Stroke color. Default "#FFFFFF". */
  color?: string;
}

/**
 * Chroma key: pixels whose chroma (BT.709 CbCr) is close to `color`
 * become transparent — green-screen / blue-screen removal. The alpha
 * ramp is linear from `tolerance` to `tolerance + softness` in CbCr
 * distance. Spill suppression caps the key color's dominant channel at
 * the max of the other two, scaled by `spill`.
 */
export interface ChromaKeyEffect {
  type: 'chroma_key';
  /** The screen color to remove. Default "#00FF00". */
  color?: string;
  /** CbCr distance fully removed. Default 0.18. Animatable. */
  tolerance?: number | Keyframe[] | Expr;
  /** Ramp width above tolerance (0 = hard edge). Default 0.1. Animatable. */
  softness?: number | Keyframe[] | Expr;
  /** Spill suppression strength 0..1. Default 0.5. Animatable. */
  spill?: number | Keyframe[] | Expr;
}

/**
 * Luma key: pixels darker than `threshold` (BT.709 luma of the
 * straight-alpha color) become transparent; `invert` keys out bright
 * pixels instead. The classic way to lift white-on-black mattes,
 * flares, and smoke elements.
 */
export interface LumaKeyEffect {
  type: 'luma_key';
  /** Luma below this is fully removed (0..1). Default 0.5. Animatable. */
  threshold?: number | Keyframe[] | Expr;
  /** Ramp width above threshold (0 = hard edge). Default 0.1. Animatable. */
  softness?: number | Keyframe[] | Expr;
  /** Key out BRIGHT pixels instead of dark. Default false. */
  invert?: boolean;
}

/**
 * Levels: the classic five-param grade, per channel on the
 * straight-alpha color: `x = clamp((c − in_black) / (in_white −
 * in_black)); y = x^(1/gamma); out = out_black + y × (out_white −
 * out_black)`. gamma > 1 brightens mids (Photoshop semantics).
 */
export interface LevelsEffect {
  type: 'levels';
  /** Input black point 0..1. Default 0. Animatable. */
  in_black?: number | Keyframe[] | Expr;
  /** Input white point 0..1. Default 1. Animatable. */
  in_white?: number | Keyframe[] | Expr;
  /** Mid-tone gamma (> 0; > 1 brightens). Default 1. Animatable. */
  gamma?: number | Keyframe[] | Expr;
  /** Output black point 0..1. Default 0. Animatable. */
  out_black?: number | Keyframe[] | Expr;
  /** Output white point 0..1. Default 1. Animatable. */
  out_white?: number | Keyframe[] | Expr;
}

/**
 * Color lookup table: a .cube file (3D LUT) applied to the element's
 * straight-alpha color with trilinear interpolation over the lattice.
 * The asset loads like any other (http(s), relative, or data: URI).
 * Unloadable or malformed LUTs skip the pass with a warning.
 */
export interface LutEffect {
  type: 'lut';
  /** URL of the .cube file (LUT_3D_SIZE, 0..1 domain). */
  source: string;
  /** Blend between original (0) and graded (1) color. Default 1. Animatable. */
  intensity?: number | Keyframe[] | Expr;
}

/**
 * Fractal noise: fills the element's alpha footprint with seeded,
 * animatable value-noise fBM (grayscale; chain `levels` / `lut` /
 * `hue_rotate` to color it). The noise function is NORMATIVE (§4.7) —
 * an integer PCG hash over the lattice — so the same seed produces the
 * same pixels on every runtime. Animate `evolution` to make the noise
 * churn in place; animate `offset_x`/`offset_y` to scroll it.
 */
export interface FractalNoiseEffect {
  type: 'fractal_noise';
  /** Feature size in canvas px (one noise lattice cell). Default 100. Animatable. */
  scale?: number | Keyframe[] | Expr;
  /** Third noise axis — animate for in-place churn. Default 0. Animatable. */
  evolution?: number | Keyframe[] | Expr;
  /** Scroll offsets in canvas px. Default 0. Animatable. */
  offset_x?: number | Keyframe[] | Expr;
  offset_y?: number | Keyframe[] | Expr;
  /** fBM octaves, integer 1–8. Default 4. */
  octaves?: number;
  /** Lattice seed, integer ≥ 0. Default 0. */
  seed?: number;
}

/**
 * Turbulent displace: warps the element's own pixels by a seeded noise
 * vector field — wavy text, heat shimmer, organic wobble. Same
 * normative noise as `fractal_noise`. Animate `evolution` for motion.
 */
export interface TurbulentDisplaceEffect {
  type: 'turbulent_displace';
  /** Max displacement in canvas px. Default 16. Animatable. */
  amount?: number | Keyframe[] | Expr;
  /** Feature size of the displacement field in canvas px. Default 120. Animatable. */
  scale?: number | Keyframe[] | Expr;
  /** Third noise axis — animate for churn. Default 0. Animatable. */
  evolution?: number | Keyframe[] | Expr;
  /** fBM octaves, integer 1–8. Default 2. */
  octaves?: number;
  /** Lattice seed, integer ≥ 0. Default 0. */
  seed?: number;
}

/**
 * A stylize pass over the element's rendered pixels. Effects run in
 * array order, after the filter fields (§4.6 → §4.7). Params accept
 * keyframes evaluated against element-local time.
 */
export type Effect =
  | PixelateEffect
  | DitherEffect
  | HalftoneEffect
  | AsciiEffect
  | GlassEffect
  | GlowEffect
  | DropShadowEffect
  | StrokeEffect
  | ChromaKeyEffect
  | LumaKeyEffect
  | LevelsEffect
  | LutEffect
  | FractalNoiseEffect
  | TurbulentDisplaceEffect;

// ────────────────────────────────────────────────────────────────────────────
// Base element — shared by every element variant
// ────────────────────────────────────────────────────────────────────────────

export interface BaseElement {
  id?: string;
  name?: string;
  type: ElementType;
  /**
   * Paint order within the element's container, like an After Effects
   * layer: each element owns a UNIQUE `layer` integer in 1..1000 and
   * LOWER numbers draw in front (layer 1 is on top). Required. `z`
   * (depth) takes precedence; `layer` orders elements within equal
   * depth. Unique per container (top-level `elements`, each group's
   * `elements`, each group mask's `elements`).
   */
  layer: number;
  time?: number | string;
  duration?: number | string | 'auto' | 'end';
  /** When false, the element is not rendered at all. Default true. */
  visible?: boolean;

  // Transform
  x?: number | string | Keyframe[] | Expr;
  y?: number | string | Keyframe[] | Expr;
  x_anchor?: number | string;
  y_anchor?: number | string;
  width?: number | string | Keyframe[] | Expr;
  height?: number | string | Keyframe[] | Expr;
  /**
   * Width / height ratio. When exactly one of width/height is set, the
   * other derives from this ratio (e.g. width 800 + aspect_ratio 16/9 →
   * height 450). Ignored when both or neither dimension is set.
   */
  aspect_ratio?: number;
  /**
   * Rotation in the element's plane, degrees clockwise. Exact alias for
   * `z_rotation` (CKP/1.0): authoring BOTH on one element is a
   * validation error. Animatable.
   */
  rotation?: number | Keyframe[] | Expr;
  /**
   * 3D rotation (CKP/1.0, §4.4): degrees around the element's local z
   * axis. Same slot as `rotation` — use one or the other.
   */
  z_rotation?: number | Keyframe[] | Expr;
  /**
   * 3D rotation (CKP/1.0, §4.4): degrees around the element's local
   * x axis (positive tips the top edge away from the viewer). Without a
   * Source camera the projection has no perspective (affine
   * foreshortening only). Animatable.
   */
  x_rotation?: number | Keyframe[] | Expr;
  /**
   * 3D rotation (CKP/1.0, §4.4): degrees around the element's local
   * y axis (positive turns the right edge away from the viewer).
   * Animatable.
   */
  y_rotation?: number | Keyframe[] | Expr;
  /**
   * Position offset along the z axis in pixels (CKP/1.0, §4.4);
   * positive moves TOWARD the viewer. Visible only under a Source
   * camera (it feeds the perspective divide); does NOT affect paint
   * order. Animatable.
   */
  z?: number | Keyframe[] | Expr;
  scale?: number | Keyframe[] | Expr;
  /**
   * Per-axis scale factors, multiplied with the uniform `scale`. A number
   * is a factor (1 = unscaled); a string percentage ("50%") is parsed as
   * factor/100. Animatable via keyframe_animations.
   */
  x_scale?: number | string | Keyframe[] | Expr;
  y_scale?: number | string | Keyframe[] | Expr;
  /**
   * Shear in DEGREES, following CSS `skewX(...)` / `skewY(...)`
   * semantics: positive x_skew moves the bottom edge right; positive
   * y_skew moves the right edge down. Animatable.
   */
  x_skew?: number | Keyframe[] | Expr;
  y_skew?: number | Keyframe[] | Expr;

  // Visual
  /** Opacity 0..1 (CSS convention). Default 1 (opaque). Animatable. */
  opacity?: number | Keyframe[] | Expr;
  /**
   * How this element's pixels combine with what's already on the
   * canvas beneath it (element-local, like opacity). Follows the W3C
   * Compositing & Blending separable-blend definitions:
   *   'normal'     source-over (default)
   *   'multiply'   darkens — white is neutral
   *   'screen'     lightens — black is neutral
   *   'add'        additive glow — black is neutral
   *   'overlay'    multiply where backdrop is dark, screen where light
   *   'hard-light' overlay with source and backdrop swapped
   *   'soft-light' a gentler overlay (soft burn/dodge)
   * 'overlay'/'hard-light'/'soft-light' are piecewise on the backdrop/
   * source and can't be done with fixed-function GPU blending — the
   * runtime isolates the element to a layer and composites it against a
   * snapshot of the backdrop.
   */
  blend_mode?: 'normal' | 'multiply' | 'screen' | 'add' | 'overlay' | 'hard-light' | 'soft-light';
  /**
   * Gaussian blur of this element's rendered pixels; the value is the
   * standard deviation (σ) in canvas pixels, CSS `filter: blur()`
   * semantics. 0 = off. Element-local: the blur may bleed past the
   * element's box but never touches other elements. Animatable.
   */
  blur_radius?: number | Keyframe[] | Expr;
  /**
   * Brightness multiplier (CSS `filter: brightness()`): 1 = unchanged,
   * 0 = black, >1 brightens. Element-local, animatable.
   */
  brightness?: number | Keyframe[] | Expr;
  /**
   * Contrast multiplier around mid-gray (CSS `filter: contrast()`):
   * 1 = unchanged, 0 = solid gray, >1 increases. Element-local,
   * animatable.
   */
  contrast?: number | Keyframe[] | Expr;
  /**
   * Saturation multiplier (CSS `filter: saturate()`): 1 = unchanged,
   * 0 = grayscale, >1 oversaturates. Element-local, animatable.
   */
  saturation?: number | Keyframe[] | Expr;
  /**
   * Hue rotation in degrees (CSS `filter: hue-rotate()` — the SVG
   * feColorMatrix hueRotate matrix, normative in §4.6): 0 = unchanged.
   * Element-local, animatable.
   */
  hue_rotate?: number | Keyframe[] | Expr;
  /**
   * Stylize effects, applied IN ARRAY ORDER after the filter fields
   * (blur → brightness → contrast → saturation → hue_rotate →
   * effects[0..n]).
   * Element-local: each effect re-renders only this element's pixels;
   * other elements are never read or altered. Effect params accept
   * keyframes (element-local time) and are NOT addressable via
   * keyframe_animations.
   */
  effects?: Effect[];

  /**
   * PBR surface material (CKP/1.0, §4.8). Opt-in: with no `material` the
   * element renders unlit exactly as before. When present (and the Source
   * declares `lights`), the element's own pixels act as albedo and the
   * runtime shades them — diffuse + view-dependent specular + environment
   * reflection — so highlights/reflections sweep as the camera moves.
   */
  material?: Material;

  // Animation
  animations?: Animation[];
  keyframe_animations?: KeyframeAnimation[];

  // Forward-compat: Zod `.passthrough()` preserves unknown keys, and the
  // renderer does dynamic property access (e.g. `element[propName]`).
  // Index signature here keeps the dynamic access typed without `any`.
  [key: string]: unknown;
}

// ────────────────────────────────────────────────────────────────────────────
// Element variants (compatible with prevailing video-API conventions)
// ────────────────────────────────────────────────────────────────────────────

export interface VideoElement extends BaseElement {
  type: 'video';
  source: string;
  volume?: number | Keyframe[] | Expr;
  playback_rate?: number | Keyframe[] | Expr;
  trim_start?: number;
  trim_duration?: number;
  loop?: boolean;
  /**
   * Time remapping (§5.3.2): keyframes mapping element-local time
   * (seconds) → MEDIA time (seconds). Speed ramps are steep segments,
   * freeze frames are flat ones, reverse plays from decreasing values.
   * When present it REPLACES the trim_start / trim_duration /
   * playback_rate / loop mapping entirely. The embedded audio follows
   * the warp varispeed-style (§5.3.2): pitch shifts with speed,
   * freezes are silent, reverse plays the sound backwards.
   */
  time_remap?: Keyframe[];
  /** Embedded-audio gain ramps 0→volume over the first N timeline seconds. */
  audio_fade_in?: number;
  /** Embedded-audio gain ramps volume→0 over the last N timeline seconds. */
  audio_fade_out?: number;
  /**
   * How the media fills the element box (CSS object-fit semantics):
   * 'cover' scales to fill and crops overflow (default), 'contain'
   * letterboxes, 'fill' stretches, 'none' renders at natural size
   * cropped to the box.
   */
  fit?: 'cover' | 'contain' | 'fill' | 'none';
  /**
   * Source crop — a normalized sub-rectangle of the media (0..1, origin
   * top-left) selected BEFORE `fit` maps it into the element box. The
   * element box is unchanged; crop only chooses which part of the source
   * fills it. Default `0,0,1,1` (whole source) — omit for no crop. Each
   * component is keyframeable (animate them for a Ken Burns pan/zoom).
   */
  crop_x?: number;
  crop_y?: number;
  crop_width?: number;
  crop_height?: number;
}

export interface ImageElement extends BaseElement {
  type: 'image';
  source: string;
  fit?: 'cover' | 'contain' | 'fill' | 'none';
  /**
   * Rounded-corner radius in pixels. Pixels outside the rounded rect
   * are masked out by the renderer (with anti-aliased edges). Clamped
   * by the runtime to half the smaller dimension, so passing a huge
   * value produces a pill / circle. Matches CSS `border-radius`.
   */
  border_radius?: number;
  /**
   * Source crop — a normalized sub-rectangle of the media (0..1, origin
   * top-left) selected BEFORE `fit` maps it into the element box. The
   * element box is unchanged; crop only chooses which part of the source
   * fills it. Default `0,0,1,1` (whole source) — omit for no crop. Each
   * component is keyframeable (animate them for a Ken Burns pan/zoom).
   */
  crop_x?: number;
  crop_y?: number;
  crop_width?: number;
  crop_height?: number;
}

/**
 * A styled run within a text element. When `spans` is set on a TextElement
 * the runtime renders each run inline left-to-right, applying any per-span
 * style overrides on top of the element's defaults. A span with text
 * `'\n'` acts as a hard line break.
 *
 * Clipkit extension to the baseline TextElement; allows
 * mid-string emphasis (bold within a sentence, colored highlight on one
 * word, etc.) without authoring N positioned siblings.
 */
/**
 * Stylized background for a TextSpan — a "highlight band" effect.
 *
 * The fields refine how the background rect is positioned and shaped:
 *   - `height_ratio` < 1 makes the band shorter than the line box
 *     (e.g. 0.5 for a marker-style underline highlight).
 *   - `inset_y_ratio` shifts the band vertically within the line box.
 *   - `padding_x` extends the band horizontally past the text glyphs.
 *   - `skew_x` shears the band horizontally (parallelogram edges).
 *   - `border_radius` rounds the band corners.
 *
 * All optional — minimal usage `{ color }` is equivalent to a flat
 * full-line-box rectangle (same as the older `background_color`).
 */
export interface TextSpanBackground {
  /** CSS color (hex / rgb / rgba). */
  color: string;
  /**
   * Band height as a fraction of the line-box height. 1.0 = full line
   * (default), 0.5 = half-line marker, etc.
   */
  height_ratio?: number;
  /**
   * Top edge of the band as a fraction of the line-box height, measured
   * from the line-box top. 0 = flush top, 1 - height_ratio = flush
   * bottom. Default 0.
   */
  inset_y_ratio?: number;
  /**
   * Horizontal padding in PIXELS extending past the text glyph bounds
   * on each side. Useful for the "Swipe" effect where the band sticks
   * out a few pixels past the letters.
   */
  padding_x?: number;
  /**
   * Horizontal skew in DEGREES (CSS `skewX(...)`). Positive shears the
   * top to the right; negative to the left.
   */
  skew_x?: number;
  /** Corner radius in pixels. */
  border_radius?: number;
  /** 0..1 opacity. Multiplies with the element's opacity. */
  opacity?: number;
}

export interface TextSpan {
  text: string;
  font_weight?: number | string;
  font_style?: 'normal' | 'italic';
  font_family?: string;
  font_size?: number | string;
  fill_color?: string;
  /**
   * Tracking in pixels, added after every character (Chrome's
   * letter-spacing model). Inherits the element's letter_spacing when
   * unset.
   */
  letter_spacing?: number;
  /**
   * Solid color background spanning the full line box. Shortcut for
   * `background: { color }`. Ignored when `background` is set.
   */
  background_color?: string;
  /** Stylized background — overrides `background_color` when present. */
  background?: TextSpanBackground;
  /**
   * When true, the runtime's word-wrap treats this span's text as an
   * atomic unit: it never breaks mid-span. Matches CSS
   * `white-space: nowrap` / `display: inline-block` semantics. Used
   * for highlighted phrases that must stay together (the Swipe band
   * "before you leave" reads wrong if it wraps after "before").
   */
  nowrap?: boolean;
}

/**
 * Per-glyph text shadow (CSS `text-shadow` semantics). Each glyph casts
 * its OWN shadow, so it tracks per-letter animation (flip/stagger/3D) and
 * overlapping glyphs — unlike the silhouette `drop_shadow` effect, which
 * shadows the flattened text as one shape. Use an ARRAY for stacked
 * shadows (painted back-to-front; the last entry sits nearest the glyphs).
 */
export interface TextShadow {
  /** Shadow color (§3.4: hex / rgb() / hsl() / named). */
  color: string;
  /** Offset in px, in the text's local frame (rotates with it). Default 0. */
  offset_x?: number;
  offset_y?: number;
  /** Gaussian softness in px (0 = crisp). Default 0. */
  blur?: number;
  /** Shadow opacity 0..1, multiplies the color's alpha. Default 1. */
  opacity?: number;
}

export interface TextElement extends BaseElement {
  type: 'text';
  /** Static text content. Optional when `spans` is provided. */
  text?: string;
  /**
   * Inline-styled runs. When present, takes precedence over `text`. Each
   * span inherits the element's font_family / font_size / fill_color /
   * etc. unless it overrides them.
   */
  spans?: TextSpan[];
  font_family?: string;
  font_size?: number | string;
  /**
   * Lower bound for `font_size: "auto"` fitting. Number = px; unit
   * strings (vmin etc.) resolve against the canvas. Default 8.
   */
  font_size_minimum?: number | string;
  /** Upper bound for `font_size: "auto"`. Default 400. */
  font_size_maximum?: number | string;
  font_weight?: number | string;
  font_style?: 'normal' | 'italic';
  fill_color?: string;
  stroke_color?: string;
  stroke_width?: number;
  /**
   * Case transform applied before layout: 'uppercase', 'lowercase',
   * 'capitalize' (word-initial caps). Default 'none'.
   */
  text_transform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  /**
   * When false, text never soft-wraps — only explicit "\n" breaks
   * lines. Default true (plain text wraps to element.width when set;
   * spans keep their author/importer breaks).
   */
  text_wrap?: boolean;
  text_align?: 'left' | 'center' | 'right';
  vertical_align?: 'top' | 'middle' | 'bottom';
  /**
   * Content insets in pixels: the text box shrinks by 2×padding on the
   * axis and content shifts inward. Numbers or unit strings.
   */
  x_padding?: number | string;
  y_padding?: number | string;
  /**
   * Percentage-based content alignment, overriding text_align /
   * vertical_align when present: "0%" = left/top, "50%" = center,
   * "100%" = right/bottom. Numbers are fractions (0.5 = center).
   */
  x_alignment?: number | string;
  y_alignment?: number | string;
  line_height?: number;
  letter_spacing?: number;
  /**
   * Solid background behind the text — drawn as ONE band PER LINE, each
   * shrink-wrapped to that line's glyphs (not the element box), so
   * centered / ragged multi-line text gets per-line pills. Tracks
   * wrapping and `font_size: "auto"`. For a per-run highlight band use a
   * span `background`; for a drop shadow use a `drop_shadow` effect.
   */
  background_color?: string;
  /** Corner radius (px) for `background_color`. Default 0. */
  background_border_radius?: number;
  /**
   * Padding (px) added around the shrink-wrapped `background_color` on all
   * sides, OR `[x, y]` for separate horizontal / vertical padding. Default
   * 0 (bg hugs the glyphs). A pill usually wants ~16–28 horizontal.
   */
  background_padding?: number | [number, number];
  /**
   * Per-glyph drop shadow (CSS `text-shadow`), or an array for stacked
   * shadows. Distinct from the silhouette `drop_shadow` effect — see
   * TextShadow. Animatable params are not supported (static per shadow).
   */
  text_shadow?: TextShadow | TextShadow[];
  /**
   * Reveal mask. When present, text is rendered to an offscreen canvas
   * and masked before display. linear-wipe sweeps a soft diagonal edge
   * across the text driven by `progress` (0 = hidden, 1 = revealed).
   */
  mask?: TextMask;
}

export interface TextMask {
  type: 'linear-wipe';
  /**
   * Wipe direction in degrees. 0 = left→right, -45 = bottom-left→top-right
   * (a common text-fade default). Default -45.
   */
  angle?: number;
  /**
   * Reveal progress, 0..1. Animatable via keyframes. 0 = fully hidden,
   * 1 = fully revealed.
   */
  progress?: number | Keyframe[] | Expr;
  /**
   * Soft-edge width as a fraction of the bounding box diagonal, 0..1.
   * Larger = softer wipe edge. Default 0.3.
   */
  softness?: number;
}

/**
 * Drop shadow drawn behind the shape. Follows CSS `box-shadow`
 * semantics for the outer (non-inset) case:
 *   - `color` is the base color of the shadow (CSS color string).
 *   - `offset_x` / `offset_y` translate the shadow relative to the
 *     shape in PIXELS.
 *   - `blur` is the falloff distance in pixels: at offset 0 the
 *     shadow has full alpha; alpha fades linearly to 0 over `blur`
 *     pixels past the shape's edge.
 *
 * Inset shadows and `spread` are not (yet) supported.
 */
export interface BoxShadow {
  color: string;
  offset_x?: number;
  offset_y?: number;
  blur?: number;
}

/**
 * A `shape` draws geometry to the frame in one of two representations,
 * chosen by whether `paths` is present:
 *
 *  • PRIMITIVE — `shape: 'rectangle' | 'ellipse'` (+ `border_radius`): a GPU
 *    SDF quad. Resolution-independent and cheap; corners come from a shader.
 *  • PATH — `paths`: arbitrary vector geometry rasterized via the path engine,
 *    with keyframeable `d` morphing, per-sub-path fill/stroke, and stroke
 *    trim/draw-on. Resolution is bound by `view_box`.
 *
 * One element, two pixel-generation strategies — the renderer dispatches on
 * `paths`. (Absorbs the former `svg` element; CKP/1.0.)
 */
export interface ShapeElement extends BaseElement {
  type: 'shape';
  // ── Primitive form (SDF). Ignored when `paths` is present. ──
  /** Primitive kind. Default 'rectangle'. */
  shape?: 'rectangle' | 'ellipse';
  fill_color?: string;
  /** Gradient fill. When present, overrides fill_color. Up to 4 stops. */
  gradient?: LinearGradient | RadialGradient;
  stroke_color?: string;
  stroke_width?: number;
  border_radius?: number;
  /** Drop shadow rendered before the shape itself. */
  shadow?: BoxShadow;
  // ── Path form (rasterized). Presence selects this representation. ──
  /** Vector geometry: one or more sub-paths, painted back-to-front. When
   *  present, the primitive fields above are ignored. */
  paths?: PathDef[];
  /** [x, y, width, height] viewBox for `paths`. Default [0, 0, 100, 100]. */
  view_box?: [number, number, number, number];
  /** Linear gradients addressable from `paths` via `fill: "url(#id)"`. */
  gradients?: PathGradient[];
}

// ── Gradients (Clipkit extension) ─────────────────────────────────────────

export interface GradientStop {
  /** Position along the gradient in [0, 1]. */
  offset: number;
  /** Hex color. */
  color: string;
}

export interface LinearGradient {
  type: 'linear';
  /**
   * Direction in degrees, following the CSS `linear-gradient()`
   * convention: 0° = to top, measured clockwise — 90° = to right,
   * 180° = to bottom, 270° = to left. Default 180 (to bottom).
   */
  angle?: number;
  /** Color stops. Up to 4 are honored by the v1 runtime. */
  stops: GradientStop[];
}

export interface RadialGradient {
  type: 'radial';
  /** Center X as a fraction of the shape's box. Default 0.5 (center). */
  cx?: number;
  /** Center Y as a fraction. Default 0.5. */
  cy?: number;
  /** Outer radius as a fraction of the shape's box. Default 0.5. */
  radius?: number;
  stops: GradientStop[];
}

export interface AudioElement extends BaseElement {
  type: 'audio';
  source: string;
  volume?: number | Keyframe[] | Expr;
  trim_start?: number;
  trim_duration?: number;
  loop?: boolean;
  /** Gain ramps 0→volume over the first N timeline seconds. */
  audio_fade_in?: number;
  /** Gain ramps volume→0 over the last N timeline seconds. */
  audio_fade_out?: number;
}

/**
 * Group element — a positioned container whose children inherit its
 * transform, opacity, and time window. The fundamental nesting primitive.
 *
 * Semantic rules:
 *  - Children's `x`/`y` are coordinates in the group's LOCAL space. The
 *    group's anchor sets the local origin.
 *  - The group's `rotation`, `scale`, and `opacity` stack with each
 *    descendant. (Transforms multiply, opacities multiply.)
 *  - A child's `time` is relative to the group's `time`. A child whose
 *    time + duration falls outside the group's window is clipped.
 *  - Layers on children are LOCAL paint order within the group; siblings
 *    of the group (or its ancestor) use their own layers for global
 *    paint order. Layer 1 is on top (drawn last).
 */
/**
 * A mask owned by the group it masks — the masked thing declares its
 * own mask (like CSS mask-image), rather than a sibling element
 * reaching across the timeline. Mask elements render into their own
 * layer in the group's local coordinate space (same as children) and
 * may animate like any elements.
 *
 * Modes: 'alpha' shows content where the mask is opaque;
 * 'alpha-inverted' where it is transparent; 'luma' scales content by
 * the mask's luminance (white = visible, black = hidden);
 * 'luma-inverted' the reverse.
 */
export interface GroupMask {
  mode: 'alpha' | 'alpha-inverted' | 'luma' | 'luma-inverted';
  elements: Element[];
}

export interface GroupElement extends BaseElement {
  type: 'group';
  elements: Element[];
  /**
   * Time remapping for the SUBTREE (§5.8.4): keyframes mapping the
   * group's local time (seconds) → warped local time the children run
   * on. Speed-ramp, freeze, or reverse a whole composed scene: every
   * child `time`, animation, and nested video reads the warped clock.
   * The group's OWN transform/opacity animations stay on real time.
   * Audio inside a remapped subtree plays varispeed (§5.3.2).
   */
  time_remap?: Keyframe[];
  /**
   * When true, children render into an offscreen layer the size of the
   * group's box and anything outside it is clipped (CSS
   * `overflow: hidden`). Requires explicit `width` and `height`.
   * The group's own opacity/rotation/scale apply to the clipped layer
   * as a whole.
   */
  clip?: boolean;
  /**
   * Corner radius in pixels for a clipped group: rounds the clip box so
   * children are masked to a rounded rectangle (a rounded card clipping
   * its content). Only meaningful with `clip: true` (or `mask`); ignored
   * on an unclipped group. Clamped to half the smaller box dimension.
   */
  border_radius?: number;
  /**
   * Mask the group's content through a second layer (see GroupMask).
   * Requires explicit `width` and `height`. Implies clipping to the
   * group's box (both layers are box-sized).
   */
  mask?: GroupMask;
}

// ────────────────────────────────────────────────────────────────────────────
// Caption element — Clipkit extension
// ────────────────────────────────────────────────────────────────────────────

export interface CaptionWord {
  text: string;
  /** Seconds, relative to the caption element's `time`. */
  start: number;
  /** Seconds, relative to the caption element's `time`. */
  end: number;
}

export interface CaptionElement extends BaseElement {
  type: 'caption';
  words: CaptionWord[];
  style?: CaptionStyle;
  /**
   * Windowing — how much of the transcript shows at once. A whole-video caption
   * would otherwise render as one unreadable block; instead the words are split
   * into CHUNKS and only the chunk active at the current time is shown.
   *
   *   number  — max LETTERS per chunk (a chunk grows word-by-word until adding
   *             the next word would exceed this many characters).
   *   "auto"  — chunk automatically by words (a few words per chunk, also
   *             breaking on pauses) — the sensible default for speech.
   *   absent  — no windowing; the whole transcript shows at once.
   */
  max_length?: number | 'auto';

  // Text-like styling (mirrors TextElement subset).
  font_family?: string;
  font_size?: number | string;
  font_weight?: number | string;
  font_style?: 'normal' | 'italic';
  fill_color?: string;
  stroke_color?: string;
  stroke_width?: number;
  text_align?: 'left' | 'center' | 'right';
  line_height?: number;
  letter_spacing?: number;
  /**
   * Solid background drawn behind the caption phrase, SHRINK-WRAPPED to
   * the laid-out glyph bounds (not the element box). For a per-word
   * background use `highlight_background_color`; for a drop shadow use a
   * `drop_shadow` effect.
   */
  background_color?: string;
  /** Corner radius (px) for `background_color`. Default 0. */
  background_border_radius?: number;
  /**
   * Padding (px) around the shrink-wrapped `background_color`, or `[x, y]`
   * for separate horizontal / vertical padding. Default 0. A caption pill
   * usually wants ~20–32 horizontal.
   */
  background_padding?: number | [number, number];
  /** Per-glyph drop shadow (CSS `text-shadow`), or an array. See TextShadow. */
  text_shadow?: TextShadow | TextShadow[];

  // Caption-specific styling.
  /** Color applied to the currently-active word. Defaults to fill_color. */
  highlight_color?: string;
  /** Background color applied to the currently-active word. */
  highlight_background_color?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Particles element — Clipkit extension
// ────────────────────────────────────────────────────────────────────────────
//
// Deterministic, stateless particle system. Every particle's position,
// rotation, size, and color is a pure function of (element id, particle
// index, age). That keeps render-at-any-time semantics intact — seeking
// backward or jumping to a frame works without resimulation.
//
// Two modes:
//   - burst=false (default): continuous emission at `rate` particles/sec
//   - burst=true:            all `burst_count` particles emit at element start
//
// Particles spawn at the element's (x, y) anchor, get a random initial
// velocity (within `spread` around `direction` at speed ~`velocity`), and
// fall under `gravity`. They fade out over the last (1 - fade_at) of life.

export interface ParticlesElement extends BaseElement {
  type: 'particles';
  /** Particles per second (continuous mode). Default 60. */
  rate?: number;
  /** Lifetime per particle, in seconds. Default 1.5. */
  lifetime?: number;
  /** Initial speed in px/s (mean — actual = velocity × (1 ± 0.3·random)). Default 300. */
  velocity?: number;
  /** Spread cone in degrees. 0 = directional, 360 = omnidirectional. Default 360. */
  spread?: number;
  /** Emission direction in degrees. 0° = right, 90° = down, -90° = up. Default -90. */
  direction?: number;
  /** Gravity in px/s². Positive y = downward. Default 600. */
  gravity?: number;
  /** Particle color. Pass an array of hex strings for per-particle randomization. Default '#ffffff'. */
  color?: string | string[];
  /** Particle size in pixels. Default 12. */
  size?: number;
  /** Random size variation in [0, 1]. 0 = uniform, 1 = anywhere in [0, size]. Default 0.4. */
  size_variation?: number;
  /** Particle shape. Default 'square'. */
  particle_shape?: 'square' | 'circle';
  /** Initial rotation speed in deg/s (sign randomized per particle). Default 360. */
  rotation_speed?: number;
  /** If true, emit `burst_count` particles instantly at element start. Default false. */
  burst?: boolean;
  /** Number of particles in burst (only used when burst=true). Default 80. */
  burst_count?: number;
  /** Fraction of lifetime [0..1] at which particles start fading out. Default 0.7. */
  fade_at?: number;
  /**
   * Depth velocity in px/s along the emitter plane's normal (+z toward
   * the viewer, §4.4), CKP/1.0. Per particle: vz = z_velocity +
   * (random − 0.5) × z_spread; depth = vz × age. Like the `z` field,
   * invisible without perspective in the chain; paint order is
   * unchanged (z never sorts, §4.4.3). Default 0.
   */
  z_velocity?: number;
  /** Width of the uniform random vz range in px/s (see z_velocity). Default 0. */
  z_spread?: number;

  /**
   * Convergence mode. When set (non-empty), the particle simulation switches
   * off ballistic emission — instead each particle interpolates from a
   * random scattered start position toward one of these target points
   * (assigned round-robin by index) over its lifetime, producing the
   * "particles assemble into a logo" effect.
   *
   * Points are in canvas pixel coordinates. Typical use: pre-sample
   * positions along an SVG path with `SVGPathElement.getPointAtLength()`
   * and pair with `burst: true, burst_count: target_points.length`.
   */
  target_points?: [number, number][];
  /** Easing applied to the convergence position. Default 'ease-out-quart'. */
  convergence_easing?: EasingFunction;
  /**
   * Radius of the random scatter region around the emitter point where
   * particles start. Default = max(canvas_width, canvas_height).
   */
  scatter_radius?: number;
}

// ────────────────────────────────────────────────────────────────────────────
// SVG element — Clipkit extension
// ────────────────────────────────────────────────────────────────────────────
//
// A restricted SVG subset rendered via Canvas2D's Path2D + clip + linear
// gradients. Designed to cover the cases people actually need for video
// motion graphics (logos, icons, animated stroke evolution) without
// shipping a full SVG engine.
//
// Each frame, the renderer rasterizes the element's paths to an OffscreenCanvas
// at its current animation state, then uploads to a single texture and
// draws as a textured quad. The per-path `stroke_progress` (0..1) drives
// SVG's stroke-dashoffset trick to animate path drawing.

export interface PathGradient {
  /** Gradient id; reference with fill: "url(#id)" or stroke: "url(#id)". */
  id: string;
  type: 'linear';
  /** Endpoints in viewBox coordinates. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stops: GradientStop[];
}

export interface PathDef {
  /**
   * SVG path data ("M x y L x y ..."), or keyframes of d-strings for
   * PATH MORPHING (§5.6.2): when two keyframe values share an
   * identical command sequence (same letters, same argument counts,
   * no arc commands), their numeric arguments interpolate with the
   * destination keyframe's easing; incompatible pairs SNAP at the
   * destination keyframe's time.
   */
  d: string | Keyframe[];
  /** Hex color, or "url(#gradient-id)" to reference a linear gradient. */
  fill?: string;
  /** Hex color, or "url(#gradient-id)" to reference a linear gradient. */
  stroke?: string;
  /** Stroke width in viewBox units. */
  stroke_width?: number;
  /**
   * Fraction of the stroke to draw, 0..1. Sugar for a trim window of
   * [0, progress] — equivalent to `trim_end` with `trim_start: 0`.
   * Ignored when any trim_* field is present. Animatable.
   */
  stroke_progress?: number | Keyframe[] | Expr;
  /**
   * Trim window (§5.6.1): only the stroke between `trim_start` and
   * `trim_end` (fractions of the path's total length, 0..1) is drawn.
   * `trim_offset` rotates the window around the path (wrapping — 1 is
   * a full lap), which animated makes the classic traveling-dash
   * "snake". All three animatable. Defaults 0 / 1 / 0.
   */
  trim_start?: number | Keyframe[] | Expr;
  trim_end?: number | Keyframe[] | Expr;
  trim_offset?: number | Keyframe[] | Expr;
  /**
   * Path data ("M x y L x y ...") that clips this path's drawing. Only
   * pixels inside the clip path are visible. Equivalent to SVG mask with
   * a solid black fill.
   */
  clip_path?: string;
  /** Linecap style. Default "butt". */
  stroke_linecap?: 'butt' | 'round' | 'square';
  /** Linejoin style. Default "miter". */
  stroke_linejoin?: 'miter' | 'round' | 'bevel';
  /** Per-path opacity, applied to both fill and stroke. 0..1, default 1. */
  opacity?: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Element union & Source root
// ────────────────────────────────────────────────────────────────────────────

export type Element =
  | VideoElement
  | ImageElement
  | TextElement
  | ShapeElement
  | AudioElement
  | GroupElement
  | CaptionElement
  | ParticlesElement;

/**
 * The current Clipkit Protocol version. Bumped on backward-incompatible
 * changes to the Source schema. See PROTOCOL.md for the version policy.
 */
// The RELEASED protocol version. Stays put until Ian decides a release
// happens — do not bump alongside spec/feature work. (PROTOCOL.md's
// "CKP/1.0" annotations mark features slated for the NEXT release;
// the constant tracks the current one.) `clipkit init` stamps new
// Sources with this value.
export const CLIPKIT_PROTOCOL_VERSION = '1.0';

export interface FontFace {
  /** CSS font-family the runtime should register the face as. */
  family: string;
  /** CSS font-weight (e.g. 400, 700, "bold"). Defaults to "normal". */
  weight?: number | string;
  /** CSS font-style. Defaults to "normal". */
  style?: 'normal' | 'italic';
  /**
   * URL the runtime fetches to load the font. Can be absolute (http(s):),
   * relative (resolved against the document hosting the Source), or a
   * data: URI carrying the font bytes inline.
   */
  src: string;
  /**
   * CSS unicode-range of the face (e.g. "U+0000-00FF, U+0131"). Needed
   * for subsetted webfonts, which ship one file per script under an
   * identical family/weight/style — without the range, every subset
   * competes for every codepoint and the winning file may not contain
   * the glyphs being rendered.
   */
  unicode_range?: string;
}

/**
 * Source-level motion blur — exact sub-frame supersampling. The renderer
 * renders `samples` evenly spaced sub-frame times across a shutter window
 * centered on each output frame time and averages them (arithmetic mean
 * per 8-bit channel, single rounding). Deterministic: same Source → same
 * pixels.
 *
 * Sample times for the output frame at time t with frame rate f:
 *   t_k = clamp(t + ((k + 0.5) / samples − 0.5) × shutter / f, 0, duration)
 *
 * Applies at export/render time. Interactive previews MAY render the
 * unblurred scene (single sample) for speed.
 */
export interface MotionBlur {
  /** Sub-frame samples per output frame. Integer 1–32; default 8. 1 disables blur. */
  samples?: number;
  /** Fraction of the frame interval the shutter is open, (0..1]. Default 0.5 (a 180° shutter). */
  shutter?: number;
}

/**
 * Source-level scene camera (CKP/1.0, §4.4). One camera for the whole
 * composition: a perspective lens (`perspective` + origin, CSS-perspective
 * semantics — smaller distance = stronger foreshortening) plus an optional
 * rigid pose (`x`/`y`/`z` position and `x_rotation`/`y_rotation`/
 * `z_rotation` Euler orientation) that moves the viewpoint through the
 * scene. The runtime applies `camera = P · V` at the root (§4.4.2). With
 * the pose at its defaults `V = I` and the camera reduces to the lens
 * bit-for-bit. Absent camera = identity = exact 2D rendering. All fields
 * animatable via Keyframe[].
 *
 * Elements' `x_rotation` / `y_rotation` render without a camera too
 * (affine foreshortening, no perspective); `z` offsets are only visible
 * under a camera.
 */
export interface Camera {
  /** Focal distance in px (CSS `perspective()`). Must be > 0. Animatable. */
  perspective: number | Keyframe[] | Expr;
  /** Projection origin; number (px) or length string. Default "50%" of width. */
  origin_x?: number | string;
  /** Projection origin; number (px) or length string. Default "50%" of height. */
  origin_y?: number | string;
  /** Eye position offset from the default eye, px, about the origin. +x right. Default 0. Animatable. */
  x?: number | Keyframe[] | Expr;
  /** Eye position offset, px. +y down. Default 0. Animatable. */
  y?: number | Keyframe[] | Expr;
  /** Eye position along the view axis, px. +z = eye toward the scene (dolly in). Default 0. Animatable. */
  z?: number | Keyframe[] | Expr;
  /** Eye pitch in degrees (Euler, applied Rz·Ry·Rx). Default 0. Animatable. */
  x_rotation?: number | Keyframe[] | Expr;
  /** Eye yaw in degrees. Default 0. Animatable. */
  y_rotation?: number | Keyframe[] | Expr;
  /** Eye roll in degrees. Default 0. Animatable. */
  z_rotation?: number | Keyframe[] | Expr;
  /**
   * Compositing order under this camera (§4.4.3). `'depth'` (default)
   * paints flat cards back-to-front by camera distance (2.5D occlusion).
   * `'paint'` forces fixed `layer` order even under the camera.
   */
  sort?: 'depth' | 'paint';
}

/**
 * PBR material on an element (CKP/1.0, §4.8). The element's own rendered
 * pixels are the albedo; these fields control how it responds to the
 * scene `lights` and `environment`. All animatable. Absent ⇒ unlit.
 */
export interface Material {
  /** Surface roughness 0 (mirror/tight highlight) .. 1 (matte/broad). Default 0.5. */
  roughness?: number | Keyframe[] | Expr;
  /** Metalness 0 (dielectric, F0≈0.04) .. 1 (metal — albedo tints reflections). Default 0. */
  metalness?: number | Keyframe[] | Expr;
  /** Environment-reflection strength (art dial over the physical term). Default 1. */
  reflectivity?: number | Keyframe[] | Expr;
  /** Self-illumination 0..(>1): mixes the element toward its own unlit pixels. Default 0. */
  emissive?: number | Keyframe[] | Expr;
  /**
   * Tangent-space normal map URL (CKP/1.0 Phase 2, §4.8). RGB encodes a
   * per-texel surface normal (the usual 0.5-centered convention; flat =
   * #8080ff). Perturbs the face normal across the surface for bumps /
   * brushed detail, sampled in the element's UV space. Absent ⇒ flat
   * face normal.
   */
  normal_map?: string;
  /**
   * Strength of `normal_map` perturbation. 0 = flat (ignore the map),
   * 1 = as authored, >1 exaggerates. Default 1. Animatable.
   */
  normal_scale?: number | Keyframe[] | Expr;
}

/**
 * A scene light (CKP/1.0, §4.8). One of:
 *  - ambient: uniform fill.
 *  - directional: a parallel light whose direction is given by `azimuth`
 *    (around the view axis, degrees) and `elevation` (above the screen
 *    plane toward the viewer, degrees).
 */
export type Light =
  | {
      type: 'ambient';
      color?: string;
      intensity?: number | Keyframe[] | Expr;
    }
  | {
      type: 'directional';
      /** Direction azimuth in degrees (0 = +x, CCW). Default 0. Animatable. */
      azimuth?: number | Keyframe[] | Expr;
      /** Direction elevation in degrees above the screen plane. Default 45. Animatable. */
      elevation?: number | Keyframe[] | Expr;
      color?: string;
      intensity?: number | Keyframe[] | Expr;
    };

/**
 * The scene environment surfaces reflect (CKP/1.0, §4.8). Either a
 * gradient "sky" or an equirectangular image, sampled along the
 * reflection vector. Roughness blurs the reflection toward the
 * environment's average color (so both types share one IBL path).
 */
export type Environment =
  | {
      type: 'gradient';
      /** Gradient stops; offset 0 = looking down, 1 = looking up. */
      stops: GradientStop[];
    }
  | {
      /**
       * Equirectangular (2:1 lat-long) environment image URL. Reflective
       * surfaces mirror it along the reflection vector — real photographic
       * reflections (Phase 3 IBL). Sharp at roughness 0, blurring toward
       * the image's average color as roughness rises.
       */
      type: 'image';
      src: string;
    };

export interface Source {
  /**
   * The Clipkit Protocol version this Source conforms to. SHOULD be
   * present on documents produced by tooling. Absence is interpreted as
   * "1.0" for backward compatibility. Runtimes MUST attempt to render
   * documents declaring a higher patch / minor version and SHOULD warn
   * about a higher major version. See PROTOCOL.md §11. The 3D transform
   * fields and `camera` require "1.1".
   */
  clipkit_version?: string;
  output_format?: OutputFormat;
  width?: number;
  height?: number;
  duration?: number | 'auto';
  frame_rate?: number;
  background_color?: string;
  /**
   * Font faces the runtime must register before rendering. Each entry is
   * loaded via the FontFace API; the resulting face becomes available
   * under `family` at the given `weight`/`style`. Without this block,
   * the runtime depends on the host document to have registered the
   * fonts itself.
   */
  fonts?: FontFace[];
  /**
   * Exact sub-frame supersampled motion blur, applied to the whole frame
   * at export/render time. See the MotionBlur type for the normative
   * sampling math. Previews may show the unblurred scene.
   */
  motion_blur?: MotionBlur;
  /**
   * Scene perspective camera (CKP/1.0, §4.4). Absent = exact 2D
   * (identity projection, zero cost).
   */
  camera?: Camera;
  /**
   * Scene lights (CKP/1.0, §4.8). Absent ⇒ unlit (today's render). Only
   * elements that carry a `material` are shaded by these.
   */
  lights?: Light[];
  /**
   * The environment reflective materials sample (CKP/1.0, §4.8). A
   * gradient "sky" in Phase 1.
   */
  environment?: Environment;
  /**
   * Scene bloom (CKP/1.0 Phase 2, §4.8) — a whole-frame post-process:
   * pixels brighter than `threshold` bleed light into their surroundings
   * (bright specular highlights, emissive surfaces, bright media). Opt-in;
   * absent ⇒ no bloom (byte-identical). The amount each region blooms is
   * driven by its own brightness — these are the global "lens" knobs.
   */
  bloom?: Bloom;
  elements: Element[];
}

/** Scene bloom parameters (§4.8). All animatable. */
export interface Bloom {
  /** Luma above which a pixel blooms, 0..1. Default 0.75. */
  threshold?: number | Keyframe[] | Expr;
  /** Soft knee width above the threshold, 0..1. Default 0.1. */
  knee?: number | Keyframe[] | Expr;
  /** Bloom add strength. Default 1. */
  intensity?: number | Keyframe[] | Expr;
  /** Blur spread (Gaussian σ) in canvas px. Default 24. */
  radius?: number | Keyframe[] | Expr;
}

// ────────────────────────────────────────────────────────────────────────────
// Parsed value (helper)
// ────────────────────────────────────────────────────────────────────────────

export interface ParsedValue {
  value: number;
  unit: Unit;
}
