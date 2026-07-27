import { z } from 'zod';
import {
  ANIMATION_TYPES,
  CAPTION_STYLES,
  EASING_FUNCTIONS,
  OUTPUT_FORMATS,
} from './types.js';

// ────────────────────────────────────────────────────────────────────────────
// Primitives
// ────────────────────────────────────────────────────────────────────────────

const numberOrString = z.union([z.number(), z.string()]);

// Named easing, or a parametric form: cubic-bezier(x1, y1, x2, y2) with
// four numbers, or steps(n) with a positive integer.
const PARAMETRIC_EASING =
  /^(?:cubic-bezier\(\s*-?\d*\.?\d+\s*(?:,\s*-?\d*\.?\d+\s*){3}\)|steps\(\s*[1-9]\d*\s*\))$/;
const easingSchema = z.union([
  z.enum(EASING_FUNCTIONS),
  z
    .string()
    .regex(PARAMETRIC_EASING, 'expected cubic-bezier(x1, y1, x2, y2) or steps(n)'),
]);

const vec2 = z.tuple([z.number(), z.number()]);
const vec3 = z.tuple([z.number(), z.number(), z.number()]);

export const keyframeSchema = z.object({
  time: numberOrString.describe('Keyframe time in seconds, relative to the element start.'),
  value: z.union([z.number(), z.string(), vec2, vec3]).describe('Keyframe value: a number, a string (color/length), or a position [x,y] or [x,y,z].'),
  easing: easingSchema.describe('Per-keyframe easing into the next keyframe (overrides the track easing).').optional(),
  in_tangent: z.union([vec2, vec3]).describe('Bezier in-handle [dx,dy] (or [dx,dy,dz]) for spatial paths.').optional(),
  out_tangent: z.union([vec2, vec3]).describe('Bezier out-handle [dx,dy] (or [dx,dy,dz]) for spatial paths.').optional(),
});

// Tier-A expression (CKP/1.0, §Expressions): a pure function of element-local
// time `t` and the element's own index/params (`i`, `n`, `dur`, `value`) — no
// element references, no runtime inputs. Deterministic and bakeable to keyframes.
//
// The grammar is CLOSED — an AI/tool consuming this schema must stay inside the
// vocabulary below. `EXPR_VOCABULARY` is the canonical machine-readable list and
// `EXPR_GRAMMAR_DOC` is the `.describe()` text surfaced to JSON-Schema /
// introspection consumers. The runtime evaluator (runtime/src/animation/expr.ts)
// derives its variable set from these lists and type-locks its function table to
// `functions`, so the schema, the docs, and the evaluator cannot drift apart.
export const EXPR_VOCABULARY = {
  /** Read-only variables in scope. */
  vars: ['t', 'dur', 'i', 'n', 'value'] as const,
  /** Named constants. */
  consts: ['PI', 'TAU', 'E'] as const,
  /** The ONLY callable functions. Anything else is a parse error. */
  functions: [
    'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'sinh', 'cosh', 'tanh',
    'abs', 'sign', 'sqrt', 'cbrt', 'pow', 'exp', 'log', 'log2',
    'floor', 'ceil', 'round', 'trunc', 'fract', 'hypot', 'min', 'max', 'mod',
    'clamp', 'lerp', 'mix', 'step', 'smoothstep', 'linear', 'ease',
    'noise', 'wiggle', 'random',
  ] as const,
  /** Operators (besides function calls). `^` is exponentiation, right-assoc. */
  operators: ['+', '-', '*', '/', '%', '^', '<', '>', '<=', '>=', '==', '!=', '&&', '||', '!', '?:'] as const,
} as const;

export const EXPR_GRAMMAR_DOC =
  'Tier-A expression: a numeric property given as { "expr": "<formula>" }. ' +
  'CLOSED grammar — a pure, deterministic function of the element\'s own clock; ' +
  'it CANNOT reference other elements or read any runtime input (no ref(), no ' +
  'mouse/audio/valueAtTime — those are Tier-B and are permanently unsupported). ' +
  `Variables: ${EXPR_VOCABULARY.vars.join(', ')} ` +
  '(t = element-local seconds, dur = element duration, i = index in a generated ' +
  'set, n = sibling count, value = the property\'s base value), plus the ' +
  'element\'s repeat_data row keys as bare identifiers (numeric values only, §3.7). ' +
  `Constants: ${EXPR_VOCABULARY.consts.join(', ')}. ` +
  `Functions (the only ones allowed): ${EXPR_VOCABULARY.functions.join(', ')}. ` +
  'linear(x,x0,x1,y0,y1) and ease(x,x0,x1,y0,y1) map x∈[x0,x1]→[y0,y1] clamped ' +
  '(ease = cubic in-out); noise(x[,seed]), wiggle(freq,amp[,seed]), random(seed) ' +
  'are deterministic. ' +
  `Operators: ${EXPR_VOCABULARY.operators.join(' ')} (^ = power, right-assoc; ?: ternary). ` +
  'Any unknown identifier, function, assignment, member access, or string is a ' +
  'parse error, and the property silently falls back to its base value.';

export const exprSchema = z
  .object({ expr: z.string().min(1).describe(EXPR_GRAMMAR_DOC) })
  .strict()
  .describe(EXPR_GRAMMAR_DOC);

const numericProperty = z.union([z.number(), z.string(), z.array(keyframeSchema), exprSchema]);

export const animationSchema = z.object({
  type: z.enum(ANIMATION_TYPES).describe('Named animation preset (e.g. fade-in, slide-left-in, bounce-in, spin, wiggle, text-appear).'),
  duration: z.number().nonnegative().describe('Tween length in seconds (default 0.5 for most presets).').optional(),
  easing: easingSchema.describe('Easing curve for the tween (default ease-out for most presets).').optional(),
  split: z.enum(['letter', 'word']).describe('For text presets: animate per "letter" or per "word".').optional(),
  stagger: z.number().nonnegative().describe('Delay between split units in seconds (default ~0.09 word, ~0.035 letter).').optional(),
  time: z.union([z.literal('start'), z.literal('end'), z.number()]).describe('When the tween runs: "start", "end", or a time in seconds (default "start").').optional(),
  frequency: z.number().positive().describe('Oscillation frequency in Hz, for oscillating presets like wiggle.').optional(),
  rotation: z.number().describe('Rotation magnitude in degrees (preset-specific, e.g. spin 360).').optional(),
  distance: z.number().describe('Travel distance in px (preset-specific, e.g. slide 40).').optional(),
  direction: z.enum(['left', 'right', 'up', 'down']).describe('Travel direction for slide/fly-style presets.').optional(),
  scale: z.number().min(0).max(1).describe('Squash/scale depth, 0-1 (default 0.3).').optional(),
  seed: z.number().int().min(0).describe('Noise seed, integer (default 0). Also seeds text-* order:"random".').optional(),
  axis: z.enum(['x', 'y', 'z']).describe('For text-flip: the 3D rotation axis (default x).').optional(),
  order: z.enum(['forward', 'reverse', 'random']).describe('Reveal order across split units for text-* presets: "forward" (default, reading order), "reverse", or "random" (deterministic shuffle by seed; AE Randomize Order).').optional(),
  fade: z.boolean().describe('Whether text-* entrance presets fade opacity 0→1 per unit (default true). Set false for a solid position/transform-only entrance.').optional(),
});

export const keyframeAnimationSchema = z
  .object({
    property: z.string().min(1).describe('Property to animate: "x", "y", "rotation", "scale", "opacity", etc., or "position" for an [x,y]/[x,y,z] path.'),
    keyframes: z.array(keyframeSchema).min(1).describe('Keyframes in ascending time order (at least one).'),
    easing: easingSchema.describe('Default easing for keyframes that do not set their own.').optional(),
    auto_orient: z.boolean().describe('On a "position" path, rotate the element to face its travel direction (default false).').optional(),
    loop: z.union([z.boolean(), z.literal('ping-pong')]).describe('Repeat the track: true (wrap), "ping-pong" (reflect), or omit to clamp.').optional(),
  })
  .superRefine((anim, ctx) => {
    // Position paths (§6.7): every spatial keyframe agrees in
    // dimensionality — all [x, y] or all [x, y, z]. No silent z=0
    // promotion. Tangents may not exceed the path's dimensionality.
    if (anim.property !== 'position') return;
    let dim: 2 | 3 | null = null;
    anim.keyframes.forEach((k, i) => {
      if (!Array.isArray(k.value)) return;
      const d = k.value.length as 2 | 3;
      if (dim === null) dim = d;
      else if (d !== dim) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['keyframes', i, 'value'],
          message:
            'position path keyframes must agree in dimensionality — all [x, y] or all [x, y, z] (§6.7)',
        });
      }
    });
    if (dim !== 3) {
      anim.keyframes.forEach((k, i) => {
        for (const key of ['in_tangent', 'out_tangent'] as const) {
          if (k[key]?.length === 3) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['keyframes', i, key],
              message: '3-component tangents require a 3D position path — [x, y, z] keyframe values (§6.7)',
            });
          }
        }
      });
    }
  });

// ────────────────────────────────────────────────────────────────────────────
// Stylize effects — element.effects, applied in array order (§4.7)
// ────────────────────────────────────────────────────────────────────────────

const effectParam = z.union([z.number(), z.array(keyframeSchema), exprSchema]);

export const effectSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('pixelate'),
    cell_size: effectParam.describe('Cell size in canvas px (default 8, min 1). Each pixel takes its cell-center color.').optional(),
  }),
  z.object({
    type: z.literal('dither'),
    levels: effectParam.describe('Quantization levels per color channel (default 4, min 2).').optional(),
    pixel_size: effectParam.describe('Bayer dither cell size in logical px, resolution-independent (default 2).').optional(),
  }),
  z.object({
    type: z.literal('halftone'),
    cell_size: effectParam.describe('Dot-grid cell size in canvas px (default 8, min 2).').optional(),
    angle: effectParam.describe('Grid rotation in degrees (default 45).').optional(),
  }),
  z.object({
    type: z.literal('ascii'),
    cell_size: effectParam.describe('Glyph cell size in canvas px (default 12, min 4).').optional(),
  }),
  z.object({
    type: z.literal('glass'),
    blur_radius: effectParam.describe('Backdrop blur sigma in px (default 0 = clear glass; >0 = frosted).').optional(),
    refraction: effectParam.describe('Lens bend strength, approx px of displacement (default 21).').optional(),
    edge_width: effectParam.describe('Bevel z-radius; how deep the lens curvature reaches (default 40).').optional(),
    edge_highlight: effectParam.describe('Light-rig strength; 0.35 reproduces the reference defaults (default 0.35).').optional(),
    shadow: effectParam.describe('Drop-shadow opacity painted outside the pane (default 0.3).').optional(),
    dispersion: effectParam.describe('Chromatic aberration along the surface normal (default 0.05).').optional(),
    backdrop_saturation: effectParam.describe('Saturation of the sampled backdrop, 1 = unchanged (default 1).').optional(),
    tint: z.string().describe('Color drawn over the glass; its alpha is the tint strength. Static in v1.').optional(),
    mode: z.enum(['pill', 'dome']).describe('Lens cross-section: "pill" biconvex (default) or "dome" flat-bottom magnifier.').optional(),
  }),
  z.object({
    type: z.literal('backdrop_blur'),
    radius: effectParam.describe('Backdrop Gaussian blur sigma in px, masked to the element silhouette (default 12).').optional(),
  }),
  z.object({
    type: z.literal('pixel_shader'),
    source: z.string().min(1).describe('Pixel-Expr program: ONE expression evaluating per pixel to a color, in the Expr language + vectors/swizzles. Inputs: uv (vec2 0..1), t (sec), resolution, aspect. Functions: sin cos tan asin acos atan sinh cosh tanh abs sign sqrt exp log log2 floor ceil round trunc fract radians degrees pow atan2 mod min max step clamp mix lerp smoothstep length distance dot normalize cross reflect noise hash; constructors vec2 vec3 vec4 rgb rgba; operators + - * / % ^ and cond?a:b. With reads_backdrop, also backdrop(uv2)→vec4 samples the scene behind, and the coverage input (softened element-edge alpha) ramps backdrop offsets to 0 at the rim. Also: let NAME = EXPR; locals; def NAME(args) = EXPR; functions; declared params read by name; fold(N, init, acc-body) bounded loop (acc/i bound, N 1..256) + normal(fn, p) central-diff normal — for raymarching with the SDF stdlib (sdSphere/sdBox/sdRoundBox/sdTorus/sdPlane/sdCapsule, opUnion/opIntersect/opSubtract/opSmoothUnion/opOnion/opExtrude, rotX/Y/Z, refract). Declared image inputs (textures) are sampled with texture(name, uv)→vec4; median(a,b,c) decodes MSDF atlases. Output float→grayscale, vec3→rgb, vec4→rgba. e.g. "mix(rgb(.02,.06,.16), rgb(.7,.87,.93), noise(uv*8.0 + vec2(t*.1, 0.0)))".'),
    reads_backdrop: z.boolean().describe('Enable backdrop(uv2)→vec4 to sample the composited scene beneath the element (refraction/ripple/chromatic). Snapshots the backdrop. Default false.').optional(),
    params: z.record(z.union([z.number(), z.array(keyframeSchema)])).describe('Named float knobs referenced by name in source (each animatable: a number or keyframes); up to 16. Drive shader inputs from the timeline, e.g. {"warp": [{"time":0,"value":0},{"time":1,"value":1}]} then use warp in source.').optional(),
    textures: z.record(z.string()).describe('Image inputs as {name: url}, sampled in source with texture(name, uv)→vec4 (linear/clamp sampler). Up to 4. For image distortion, MSDF wordmarks (decode median(s.r,s.g,s.b)), gradient ramps, data textures. e.g. {"logo":"https://.../logo.png"} then texture(logo, uv). URLs are preloaded as image assets.').optional(),
  }),
  z.object({
    type: z.literal('glow'),
    radius: effectParam.describe('Blur sigma of the glow, in px (default 20).').optional(),
    intensity: effectParam.describe('Glow brightness multiplier (default 1).').optional(),
    color: z.string().describe('Glow color (default "#FFFFFF").').optional(),
  }),
  z.object({
    type: z.literal('drop_shadow'),
    offset_x: effectParam.describe('Shadow horizontal offset in px (default 0).').optional(),
    offset_y: effectParam.describe('Shadow vertical offset in px (default 12).').optional(),
    blur: effectParam.describe('Shadow blur sigma in px (default 18).').optional(),
    color: z.string().describe('Shadow color (default "#000000").').optional(),
    opacity: effectParam.describe('Shadow opacity, 0..1 (default 0.6).').optional(),
  }),
  z.object({
    type: z.literal('stroke'),
    width: effectParam.describe('Outline width in px, drawn outside the silhouette (default 4).').optional(),
    color: z.string().describe('Stroke color (default "#FFFFFF").').optional(),
  }),
  z.object({
    type: z.literal('chroma_key'),
    color: z.string().describe('Key color removed from the layer (default "#00FF00").').optional(),
    tolerance: effectParam.describe('Chroma distance below which pixels are keyed out (default 0.18).').optional(),
    softness: effectParam.describe('Soft-edge width past tolerance (default 0.1).').optional(),
    spill: effectParam.describe('Spill suppression of the key color (default 0.5).').optional(),
  }),
  z.object({
    type: z.literal('luma_key'),
    threshold: effectParam.describe('Luma below which pixels are removed (default 0.5).').optional(),
    softness: effectParam.describe('Soft-edge width past threshold (default 0.1).').optional(),
    invert: z.boolean().describe('Remove brighter pixels instead of darker (default false).').optional(),
  }),
  z.object({
    type: z.literal('levels'),
    in_black: effectParam.describe('Input black point, 0..1 (default 0).').optional(),
    in_white: effectParam.describe('Input white point, 0..1 (default 1).').optional(),
    gamma: effectParam.describe('Midtone gamma, >0; values >1 brighten midtones (default 1).').optional(),
    out_black: effectParam.describe('Output black point, 0..1 (default 0).').optional(),
    out_white: effectParam.describe('Output white point, 0..1 (default 1).').optional(),
  }),
  z.object({
    type: z.literal('lut'),
    source: z.string().min(1).describe('URL of a .cube LUT file (http(s), relative, or data: URI).'),
    intensity: effectParam.describe('Blend toward the graded color, 0..1 (default 1).').optional(),
  }),
  z.object({
    type: z.literal('fractal_noise'),
    scale: effectParam.describe('Canvas px per noise lattice cell (default 100).').optional(),
    evolution: effectParam.describe('Third-axis position for animating noise churn (default 0).').optional(),
    offset_x: effectParam.describe('Noise scroll offset x in canvas px (default 0).').optional(),
    offset_y: effectParam.describe('Noise scroll offset y in canvas px (default 0).').optional(),
    octaves: z.number().int().min(1).max(8).describe('fBm octaves, integer 1-8, static (default 4).').optional(),
    seed: z.number().int().min(0).describe('Noise seed, integer, static; use values <2^24 (default 0).').optional(),
  }),
  z.object({
    type: z.literal('turbulent_displace'),
    amount: effectParam.describe('Max displacement in canvas px (default 16).').optional(),
    scale: effectParam.describe('Canvas px per noise lattice cell (default 120).').optional(),
    evolution: effectParam.describe('Third-axis position for animating noise churn (default 0).').optional(),
    octaves: z.number().int().min(1).max(8).describe('fBm octaves, integer 1-8, static (default 2).').optional(),
    seed: z.number().int().min(0).describe('Noise seed, integer, static (default 0).').optional(),
  }),
]);

// ────────────────────────────────────────────────────────────────────────────
// Lighting (CKP/1.0 §4.8) — PBR material on elements
// ────────────────────────────────────────────────────────────────────────────

const numOrKf = z.union([z.number(), z.array(keyframeSchema), exprSchema]);

const materialSchema = z
  .object({
    roughness: numOrKf.describe('Surface roughness, 0 (glossy) to 1 (matte); clamped to 0.02-1 (default 0.5).').optional(),
    metalness: numOrKf.describe('Metalness, 0 (dielectric) to 1 (metal) (default 0).').optional(),
    reflectivity: numOrKf.describe('Environment-reflection strength; needs scene lights + environment (default 1).').optional(),
    emissive: numOrKf.describe('Self-illumination strength, multiplied into the color (default 0).').optional(),
    normal_map: z.string().describe('URL of a tangent-space normal map for surface detail (flat texel = #8080ff).').optional(),
    normal_scale: numOrKf.describe('Normal-map strength, 0 = flat, higher = more relief (default 1).').optional(),
  })
  .passthrough();

// ────────────────────────────────────────────────────────────────────────────
// Base element fields — shared by every variant
// ────────────────────────────────────────────────────────────────────────────

const baseElementFields = {
  id: z.string().optional(),
  name: z.string().optional(),
  layer: z.number().int().min(1).max(1000).describe("Stacking order like CSS z-index: HIGHER layer draws in front, backgrounds at layer 1. Unique int 1-1000 per container. Agrees with `z` (higher = closer to the viewer); within equal z-depth, layer is the draw order."),
  visible: z.boolean().optional(),
  time: numberOrString.describe('Element start time in seconds from composition start (default 0).').optional(),
  duration: z.union([z.number(), z.string(), z.literal('auto'), z.literal('end')]).describe('How long the element lasts: seconds, "auto" (its natural content/media length), or "end" (until the composition ends).').optional(),

  x: numericProperty.describe('Horizontal position of the anchor point, in px or a string like "50%"/"100vw" (default 0). With the default anchor (left), this is the box left edge.').optional(),
  y: numericProperty.describe('Vertical position of the anchor point, in px or a string like "50%" (default 0). With the default anchor (top), this is the box top edge.').optional(),
  x_anchor: numberOrString.describe('Point in the box that x positions: 0 = left, "50%" = center, "100%" = right (default 0). Default 0 makes x/y the top-left corner (CSS/SVG/Canvas model); rotation and scale still pivot the box center regardless of anchor.').optional(),
  y_anchor: numberOrString.describe('Point in the box that y positions: 0 = top, "50%" = center, "100%" = bottom (default 0).').optional(),
  width: numericProperty.describe('Box width in px or a string like "50%"/"100vw".').optional(),
  height: numericProperty.describe('Box height in px or a string like "50%"/"100vh".').optional(),
  aspect_ratio: z.number().positive().optional(),
  rotation: z.union([z.number(), z.array(keyframeSchema), exprSchema]).describe('In-plane rotation in degrees about the box center (default 0).').optional(),
  // CKP/1.0 3D transform fields (§4.4). `z_rotation` is the same slot
  // as `rotation` — both authored on one element is rejected by the
  // source-level cross-field check below.
  z_rotation: z.union([z.number(), z.array(keyframeSchema), exprSchema]).describe('Same slot as rotation (in-plane degrees); author one, not both (default 0).').optional(),
  x_rotation: z.union([z.number(), z.array(keyframeSchema), exprSchema]).describe('Rotation about the local x axis in degrees; tips the top edge away under a camera (default 0).').optional(),
  y_rotation: z.union([z.number(), z.array(keyframeSchema), exprSchema]).describe('Rotation about the local y axis in degrees; turns the right edge away under a camera (default 0).').optional(),
  z: z.union([z.number(), z.array(keyframeSchema), exprSchema]).describe('Depth in px toward (+) / away from (-) the viewer; orders elements and drives perspective under a camera (default 0).').optional(),
  scale: z.union([z.number(), z.array(keyframeSchema), exprSchema]).describe('Uniform scale factor, multiplied with x_scale/y_scale (default 1).').optional(),
  x_scale: z.union([z.number(), z.string(), z.array(keyframeSchema), exprSchema]).describe('Horizontal scale factor, number or "150%" (default 1).').optional(),
  y_scale: z.union([z.number(), z.string(), z.array(keyframeSchema), exprSchema]).describe('Vertical scale factor, number or "150%" (default 1).').optional(),
  x_skew: z.union([z.number(), z.array(keyframeSchema), exprSchema]).describe('Horizontal shear in degrees (CSS skewX); positive moves the bottom edge right (default 0).').optional(),
  y_skew: z.union([z.number(), z.array(keyframeSchema), exprSchema]).describe('Vertical shear in degrees (CSS skewY); positive moves the right edge down (default 0).').optional(),

  opacity: z.union([z.number(), z.array(keyframeSchema), exprSchema]).describe('Opacity from 0 (transparent) to 1 (opaque) (default 1).').optional(),
  blend_mode: z.enum(['normal', 'multiply', 'screen', 'add', 'overlay', 'hard-light', 'soft-light']).optional(),
  blur_radius: z.union([z.number().nonnegative(), z.array(keyframeSchema), exprSchema]).describe('Gaussian blur sigma in px applied to the element (default 0 = none).').optional(),
  brightness: z.union([z.number().nonnegative(), z.array(keyframeSchema), exprSchema]).describe('Brightness multiplier, 1 = unchanged, >1 brightens (default 1).').optional(),
  contrast: z.union([z.number().nonnegative(), z.array(keyframeSchema), exprSchema]).describe('Contrast multiplier around mid-gray, 1 = unchanged (default 1).').optional(),
  saturation: z.union([z.number().nonnegative(), z.array(keyframeSchema), exprSchema]).describe('Saturation multiplier, 1 = unchanged, 0 = grayscale (default 1).').optional(),
  hue_rotate: z.union([z.number(), z.array(keyframeSchema), exprSchema]).describe('Hue rotation in degrees (default 0).').optional(),
  effects: z.array(effectSchema).describe('Stylize/keying effects applied in array order (e.g. glass, drop_shadow, chroma_key, glow); they stack.').optional(),
  material: materialSchema.describe('PBR material (roughness/metalness/etc.); only visible with scene lights.').optional(),

  animations: z.array(animationSchema).describe('Named animation presets applied to this element (e.g. fade-in, slide-left-in); see the animation type list.').optional(),
  keyframe_animations: z.array(keyframeAnimationSchema).describe('Explicit per-property keyframe tracks (property + keyframes[]); use for custom motion and position paths.').optional(),
};

// Generated sets (§3.7) — image, text, shape and group elements. Binds the
// expression grammar's reserved `i` / `n` variables (and repeat_data row
// keys) per copy.
const repeatRowSchema = z.record(
  z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'row keys must be identifier-shaped'),
  z.union([z.string(), z.number()]),
);
const repeatFields = {
  repeat: z.number().int().min(2).max(500).describe('Render this element as a generated set of N identical copies (2-500). Per copy: expressions on the element\'s animatable properties see i = copy index (0-based) and n = the copy count; copy k starts repeat_stagger * k seconds after the element\'s start; the literal placeholders {i} (0-based) and {i1} (1-based) inside text/source strings are substituted. Copies share the layer and draw in i order; a group\'s children inherit the copy\'s scope. Image, text, shape and group elements only. For per-copy DATA, use repeat_data instead. (default: no repetition)').optional(),
  repeat_data: z.array(repeatRowSchema).min(2).max(500).describe('Generated set with one copy per row — a row is a partial element patch + a variable scope: row keys that name element fields (time, duration, text, fill_color, ...) override that field for the copy; ALL row keys are also in scope for the copy and its descendants, as {key} inside text/source strings and as bare identifiers in expressions (numeric values only). Mutually exclusive with repeat (the row count is the copy count). Structural keys (id, type, layer, elements, repeat, repeat_data, repeat_stagger, style) and expression-reserved names (t, dur, i, n, value, PI, TAU, E) are rejected as row keys. Image, text, shape and group elements only.').optional(),
  repeat_stagger: z.number().min(0).describe('Seconds between successive copies of a generated set: copy k starts at time + k * repeat_stagger. Requires repeat or repeat_data and a numeric time; ignored for a copy whose row sets time explicitly. (default 0 — all copies start together)').optional(),
};

// Source-level styles (§2.3) — named appearance bundles, the `fonts`
// pattern generalized. Merge is one rule, no cascade:
// runtime defaults < style < the element's own fields.
const styleField = {
  style: z.string().min(1).describe('Name of a Source-level `styles` bundle merged UNDER this element\'s own fields (defaults < style < element; no cascade). Appearance only. Referencing an undeclared name is a validation error. (default: none)').optional(),
};
export const styleSchema = z
  .object({
    font_family: z.string().optional(),
    font_weight: z.union([z.string(), z.number()]).optional(),
    font_size: z.number().positive().optional(),
    letter_spacing: z.number().optional(),
    fill_color: z.string().optional(),
    stroke_color: z.string().optional(),
    stroke_width: z.number().nonnegative().optional(),
    gradient: z.lazy(() => textGradientSchema).optional(),
    border_radius: z.number().nonnegative().optional(),
    opacity: z.union([z.number(), z.array(keyframeSchema), exprSchema]).optional(),
  })
  .strict()
  .describe('A named appearance bundle (§2.3), merged under an element\'s own fields when referenced via `style`. Appearance only — never identity, timing, layer or repetition.');

// ────────────────────────────────────────────────────────────────────────────
// Element variants
// ────────────────────────────────────────────────────────────────────────────

export const videoElementSchema = z
  .object({
    ...baseElementFields,
    type: z.literal('video'),
    source: z.string().min(1),
    volume: z.union([z.number(), z.array(keyframeSchema), exprSchema]).describe('Volume in percent, 0..100 (default 100).').optional(),
    playback_rate: z.union([z.number(), z.array(keyframeSchema), exprSchema]).describe('Timeline seconds per media second (default 1); <1 = slow-mo, >1 = speed-up.').optional(),
    trim_start: z.number().nonnegative().describe('Media in-point in seconds (default 0).').optional(),
    trim_duration: z.number().nonnegative().describe('Length of the played window in seconds (default = remainder after trim_start).').optional(),
    loop: z.boolean().describe('Restart at the trim in-point when the window ends (default false).').optional(),
    time_remap: z.array(keyframeSchema).describe('Keyframes whose values are media times in seconds; replaces trim/playback_rate for warped playback.').optional(),
    audio_fade_in: z.number().nonnegative().describe('Audio fade-in length in seconds (default 0).').optional(),
    audio_fade_out: z.number().nonnegative().describe('Audio fade-out length in seconds (default 0).').optional(),
    fit: z.enum(['cover', 'contain', 'fill', 'none']).describe('How the media fills the box (CSS object-fit): cover (default), contain, fill, or none.').optional(),
    // Source crop — normalized sub-rectangle of the media (0..1, origin
    // top-left), applied before `fit`. Default 0,0,1,1 (whole source).
    crop_x: z.number().min(0).max(1).describe('Source crop origin x, normalized 0..1, applied before fit (default 0).').optional(),
    crop_y: z.number().min(0).max(1).describe('Source crop origin y, normalized 0..1 (default 0).').optional(),
    crop_width: z.number().min(0).max(1).describe('Source crop width, normalized 0..1 (default 1 = whole source).').optional(),
    crop_height: z.number().min(0).max(1).describe('Source crop height, normalized 0..1 (default 1).').optional(),
  })
  .passthrough();

export const imageElementSchema = z
  .object({
    ...baseElementFields,
    ...repeatFields,
    ...styleField,
    type: z.literal('image'),
    source: z.string().min(1),
    fit: z.enum(['cover', 'contain', 'fill', 'none']).describe('How the image fills the box (CSS object-fit): cover (default), contain, fill, or none.').optional(),
    border_radius: z.number().nonnegative().describe('Corner radius in px (default 0).').optional(),
    // Source crop — normalized sub-rectangle of the media (0..1, origin
    // top-left), applied before `fit`. Default 0,0,1,1 (whole source).
    crop_x: z.number().min(0).max(1).describe('Source crop origin x, normalized 0..1, applied before fit (default 0).').optional(),
    crop_y: z.number().min(0).max(1).describe('Source crop origin y, normalized 0..1 (default 0).').optional(),
    crop_width: z.number().min(0).max(1).describe('Source crop width, normalized 0..1 (default 1 = whole source).').optional(),
    crop_height: z.number().min(0).max(1).describe('Source crop height, normalized 0..1 (default 1).').optional(),
  })
  .passthrough();

export const textMaskSchema = z.object({
  type: z.literal('linear-wipe'),
  angle: z.number().describe('Wipe direction in degrees (default -45); 0 = left-to-right, 90 = top-to-bottom.').optional(),
  progress: z.union([z.number(), z.array(keyframeSchema), exprSchema]).describe('Reveal amount, 0 (hidden) to 1 (fully shown); animatable (default 1 = fully shown).').optional(),
  softness: z.number().min(0).max(1).describe('Softness of the wipe edge, 0..1 (default 0.3).').optional(),
});

const textShadowSchema = z
  .object({
    color: z.string(),
    offset_x: z.number().describe('Shadow horizontal offset in px (default 0).').optional(),
    offset_y: z.number().describe('Shadow vertical offset in px, positive = down (default 0).').optional(),
    blur: z.number().nonnegative().describe('Shadow blur sigma in px (default 0 = crisp).').optional(),
    opacity: z.number().min(0).max(1).describe('Shadow opacity, 0..1 (default 1).').optional(),
  })
  .passthrough();
const textShadowField = z.union([textShadowSchema, z.array(textShadowSchema)]).describe('Per-glyph drop shadow: one object, or an array rendered back-to-front.').optional();

const textSpanBackgroundSchema = z
  .object({
    color: z.string(),
    height_ratio: z.number().describe('Band height as a fraction of font size (default 1 = full line box).').optional(),
    inset_y_ratio: z.number().describe('Vertical offset of the band as a fraction of font size (default 0).').optional(),
    padding_x: z.number().describe('Horizontal padding around the span glyphs in px (default 0).').optional(),
    skew_x: z.number().describe('Horizontal skew of the band in degrees (default 0).').optional(),
    border_radius: z.number().nonnegative().describe('Band corner radius in px (default 0).').optional(),
    opacity: z.number().min(0).max(1).describe('Band opacity, 0..1 (default 1).').optional(),
  })
  .passthrough();

export const textSpanSchema = z
  .object({
    text: z.string(),
    font_weight: numberOrString.optional(),
    font_style: z.enum(['normal', 'italic']).optional(),
    font_family: z.string().optional(),
    font_size: numberOrString.optional(),
    fill_color: z.string().optional(),
    letter_spacing: z.number().optional(),
    background_color: z.string().describe('Flat band behind this span; overridden by background.').optional(),
    background: textSpanBackgroundSchema.describe('Styled background band behind this span (height/inset/padding/skew/radius).').optional(),
    nowrap: z.boolean().describe('Prevent line-breaking inside this span (default false).').optional(),
  })
  .passthrough();

export const textElementSchema = z
  .object({
    ...baseElementFields,
    ...repeatFields,
    ...styleField,
    type: z.literal('text'),
    text: z.string().describe('The text content; use this OR spans, not both.').optional(),
    spans: z.array(textSpanSchema).describe('Rich-text runs with per-span styling; alternative to a single text string.').optional(),
    font_family: z.string().optional(),
    font_size: numberOrString.describe('Font size in px, a string, or "auto" to fit the box.').optional(),
    font_size_minimum: numberOrString.describe('Lower bound in px when font_size is "auto" (default 8).').optional(),
    font_size_maximum: numberOrString.describe('Upper bound in px when font_size is "auto" (default 400).').optional(),
    font_weight: numberOrString.optional(),
    font_style: z.enum(['normal', 'italic']).optional(),
    fill_color: z.string().describe('Text color (default "#ffffff").').optional(),
    gradient: z.lazy(() => textGradientSchema).describe('Gradient fill (linear/radial/conic), overrides fill_color. Geometric params are keyframeable/expressionable.').optional(),
    stroke_color: z.string().describe('Glyph outline color; pair with stroke_width.').optional(),
    stroke_width: z.number().describe('Glyph outline width in px (default 0).').optional(),
    stroke_gradient: z.lazy(() => textGradientSchema).describe('Gradient stroke (linear/radial/conic), overrides stroke_color; pair with stroke_width > 0. A conic stroke with rotation:{expr:"t*60"} = a rotating rainbow outline.').optional(),
    stroke_align: z.enum(['center', 'outer', 'inner']).describe('Stroke position vs the glyph edge (default "outer").').optional(),
    text_transform: z.enum(['none', 'uppercase', 'lowercase', 'capitalize']).optional(),
    text_wrap: z.boolean().describe('Soft-wrap within the box width (default true); false forces a single line.').optional(),
    text_align: z.enum(['left', 'center', 'right']).describe('Horizontal text alignment (default "left").').optional(),
    vertical_align: z.enum(['top', 'middle', 'bottom']).describe('Vertical alignment within the box (default "top").').optional(),
    x_padding: numberOrString.describe('Horizontal inset in px around the text (default 0).').optional(),
    y_padding: numberOrString.describe('Vertical inset in px around the text (default 0).').optional(),
    x_alignment: numberOrString.describe('Fine horizontal alignment as a 0..1 fraction; overrides text_align.').optional(),
    y_alignment: numberOrString.describe('Fine vertical alignment as a 0..1 fraction; overrides vertical_align.').optional(),
    line_height: z.number().describe('Line spacing as a multiple of font size (default 1).').optional(),
    letter_spacing: z.number().describe('Tracking in px added after each glyph (default 0).').optional(),
    background_color: z.string().describe('Background band behind the text, shrink-wrapped per line (default none).').optional(),
    background_border_radius: z.number().describe('Corner radius in px of the background band (default 0).').optional(),
    background_padding: z.union([z.number(), z.tuple([z.number(), z.number()])]).describe('Background band padding in px: a number, or [x, y] (default [0, 0]).').optional(),
    text_shadow: textShadowField,
    mask: textMaskSchema.describe('Linear-wipe reveal of the text (angle/progress/softness).').optional(),
  })
  .passthrough();

// ── Gradients ──────────────────────────────────────────────────────────────

export const gradientStopSchema = z.object({
  offset: z.union([z.number(), z.array(keyframeSchema), exprSchema]).describe('Position along the gradient, 0..1. Keyframeable / expressionable — animate to slide a colour band (e.g. a white wipe).'),
  color: z.string(),
});

// ── Lighting: scene lights + environment (CKP/1.0 §4.8) ─────────────────────

const lightSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('ambient'),
    color: z.string().describe('Ambient light color (default "#FFFFFF").').optional(),
    intensity: numOrKf.describe('Ambient brightness multiplier (default 1).').optional(),
  }).passthrough(),
  z.object({
    type: z.literal('directional'),
    azimuth: numOrKf.describe('Compass direction of the light in degrees (default 0).').optional(),
    elevation: numOrKf.describe('Height of the light above the screen plane in degrees (default 45).').optional(),
    color: z.string().describe('Directional light color (default "#FFFFFF").').optional(),
    intensity: numOrKf.describe('Directional brightness multiplier (default 1).').optional(),
  }).passthrough(),
]);

const environmentSchema = z.union([
  z.object({
    type: z.literal('gradient'),
    stops: z.array(gradientStopSchema).min(2).max(6).describe('Sky gradient stops (2-6), sampled by the reflection ray vertical component.'),
  }).passthrough(),
  z.object({
    type: z.literal('image'),
    src: z.string().describe('Equirectangular environment image URL, used for material reflections.'),
  }).passthrough(),
]);

const bloomSchema = z
  .object({
    threshold: numOrKf.describe('Luma above which pixels bloom, 0-1 (default 0.75).').optional(),
    knee: numOrKf.describe('Soft-knee width around the threshold (default 0.1).').optional(),
    intensity: numOrKf.describe('Bloom strength multiplier (default 1).').optional(),
    radius: numOrKf.describe('Bloom blur sigma in px (default 24).').optional(),
  })
  .passthrough();

// A scalar that may be static, keyframed, or a Tier-A expression.
const animNumberSchema = z.union([z.number(), z.array(keyframeSchema), exprSchema]);

export const linearGradientSchema = z.object({
  type: z.literal('linear'),
  angle: animNumberSchema.describe('Gradient direction in degrees (CSS convention; default 180 = top-to-bottom). Keyframeable / expressionable.').optional(),
  stops: z.array(gradientStopSchema).min(2).max(4).describe('Color stops, 2-4.'),
});

export const radialGradientSchema = z.object({
  type: z.literal('radial'),
  cx: animNumberSchema.describe('Center x as a fraction of the box, 0..1 (default 0.5). Keyframeable / expressionable.').optional(),
  cy: animNumberSchema.describe('Center y as a fraction of the box, 0..1 (default 0.5). Keyframeable / expressionable.').optional(),
  radius: animNumberSchema.describe('Radius as a fraction of the box, 0..1 (default 0.5). Keyframeable / expressionable.').optional(),
  stops: z.array(gradientStopSchema).min(2).max(4).describe('Color stops, 2-4.'),
});

// Angular / sweep gradient — TEXT ONLY (Canvas2D; shapes use linear/radial). The
// rotation start-angle is keyframeable/expressionable: { expr: "t*60" } spins it.
export const conicGradientSchema = z.object({
  type: z.literal('conic'),
  cx: animNumberSchema.describe('Sweep center x as a fraction of the box (default 0.5). Keyframeable / expressionable.').optional(),
  cy: animNumberSchema.describe('Sweep center y as a fraction of the box (default 0.5). Keyframeable / expressionable.').optional(),
  rotation: animNumberSchema.describe('Start angle in degrees, clockwise (default 0). Keyframeable / expressionable — e.g. { expr: "t * 60" } for a rotating rainbow.').optional(),
  stops: z.array(gradientStopSchema).min(2).max(8).describe('Color stops, 2-8 (a rainbow uses ~7).'),
});

// Shapes: linear/radial only (shader-rendered).
export const gradientSchema = z.discriminatedUnion('type', [
  linearGradientSchema,
  radialGradientSchema,
]);

// Text: linear/radial/conic (Canvas2D-rendered).
export const textGradientSchema = z.discriminatedUnion('type', [
  linearGradientSchema,
  radialGradientSchema,
  conicGradientSchema,
]);

const boxShadowSchema = z
  .object({
    color: z.string(),
    offset_x: z.number().describe('Shadow horizontal offset in px (default 0).').optional(),
    offset_y: z.number().describe('Shadow vertical offset in px (default 12).').optional(),
    blur: z.number().nonnegative().describe('Shadow blur sigma in px (default 18).').optional(),
  })
  .passthrough();

// ── Path geometry (used by `shape` when it carries `paths`) ──────────────────
export const pathGradientSchema = z.object({
  id: z.string().min(1).describe('Identifier referenced from a path fill/stroke as url(#id).'),
  type: z.literal('linear'),
  x1: z.number().describe('Gradient line start x in viewBox coords; the line runs (x1,y1) to (x2,y2).'),
  y1: z.number(),
  x2: z.number(),
  y2: z.number(),
  stops: z.array(gradientStopSchema).min(2).max(4).describe('Color stops, 2-4.'),
});

export const pathDefSchema = z.object({
  d: z.union([z.string().min(1), z.array(keyframeSchema)]).describe('SVG path data; an array of keyframes morphs between path shapes.'),
  fill: z.string().describe('Fill color, or url(#id) referencing a gradient (default none).').optional(),
  stroke: z.string().describe('Stroke color, or url(#id); needs stroke_width > 0.').optional(),
  stroke_width: z.number().positive().describe('Stroke width in px.').optional(),
  stroke_progress: z.union([z.number(), z.array(keyframeSchema), exprSchema]).describe('Reveal fraction of the stroke length, 0..1 (default 1); shorthand for a draw-on trim.').optional(),
  trim_start: effectParam.describe('Stroke start as a fraction of path length, 0..1 (default 0).').optional(),
  trim_end: effectParam.describe('Stroke end as a fraction of path length, 0..1 (default 1).').optional(),
  trim_offset: effectParam.describe('Rotate the visible trim window around the path, 0..1 wrapping (default 0).').optional(),
  clip_path: z.string().describe('SVG path d-string that clips this path (intersection).').optional(),
  stroke_linecap: z.enum(['butt', 'round', 'square']).describe('Line-end style (default "butt").').optional(),
  stroke_linejoin: z.enum(['miter', 'round', 'bevel']).describe('Line-join style (default "miter").').optional(),
  opacity: z.number().min(0).max(1).describe('Path opacity, 0..1 (default 1).').optional(),
});

// A `shape` is EITHER a primitive (SDF rectangle/ellipse) OR a vector path
// (`paths`). The renderer dispatches on `paths`; when present the primitive
// fields are ignored. (Absorbs the former `svg` element.)
export const shapeElementSchema = z
  .object({
    ...baseElementFields,
    ...repeatFields,
    ...styleField,
    type: z.literal('shape'),
    // primitive form (SDF)
    shape: z.enum(['rectangle', 'ellipse']).describe('Primitive kind: "rectangle" (default) or "ellipse". Ignored when paths is present.').optional(),
    fill_color: z.string().describe('Solid fill color, hex or CSS name (default "#ffffff"); overridden by gradient.').optional(),
    gradient: gradientSchema.describe('Linear or radial gradient fill (overrides fill_color).').optional(),
    stroke_color: z.string().describe('Outline color, hex or CSS name; pair with stroke_width > 0.').optional(),
    stroke_width: z.number().describe('Outline width in px, drawn outside the shape (default 0 = no stroke).').optional(),
    border_radius: z.number().describe('Corner radius in px for a rectangle (default 0).').optional(),
    shadow: boxShadowSchema.describe('Drop shadow cast by the shape (color, offset, blur).').optional(),
    // path form (rasterized) — presence selects this representation
    paths: z.array(pathDefSchema).min(1).describe('Vector path form: an array of SVG paths. Its presence switches the shape from primitive to vector and ignores shape/fill_color/etc.').optional(),
    view_box: z.tuple([z.number(), z.number(), z.number(), z.number()]).describe('SVG viewBox [x, y, width, height] for the paths coordinate space (default [0, 0, 100, 100]).').optional(),
    gradients: z.array(pathGradientSchema).describe('Named gradients referenced from path fill/stroke as url(#id).').optional(),
  })
  .passthrough();

export const audioElementSchema = z
  .object({
    ...baseElementFields,
    type: z.literal('audio'),
    source: z.string().min(1),
    volume: z.union([z.number(), z.array(keyframeSchema), exprSchema]).describe('Volume in percent, 0..100 (default 100).').optional(),
    trim_start: z.number().nonnegative().describe('Media in-point in seconds (default 0).').optional(),
    trim_duration: z.number().nonnegative().describe('Length of the played window in seconds (default = remainder after trim_start).').optional(),
    loop: z.boolean().describe('Restart at the trim in-point when the window ends (default false).').optional(),
    audio_fade_in: z.number().nonnegative().describe('Fade-in length in seconds (default 0).').optional(),
    audio_fade_out: z.number().nonnegative().describe('Fade-out length in seconds (default 0).').optional(),
  })
  .passthrough();

// Group nests elements. We don't recurse through Zod here — the resulting
// inferred type is too large for tsc declaration emit, and the renderer
// traverses + validates nested elements at render time anyway. Promote to
// recursive validation in v1.x if a real consumer needs it.
export const groupElementSchema = z
  .object({
    ...baseElementFields,
    ...repeatFields,
    type: z.literal('group'),
    elements: z.array(z.unknown()).min(1).describe('Child elements; the group transform composes onto all of them (couple elements without duplicating motion onto each).'),
    time_remap: z.array(keyframeSchema).describe('Keyframes that warp the group subtree clock (values are warped seconds).').optional(),
    clip: z.boolean().describe('Clip children to the group box (default false).').optional(),
    // Rounds a clipped group's box (rounded card clipping its content).
    border_radius: z.number().nonnegative().describe('Corner radius in px of the clipped group box (default 0).').optional(),
    mask: z
      .object({
        mode: z.enum(['alpha', 'alpha-inverted', 'luma', 'luma-inverted']).describe('How the mask layer drives content opacity: alpha or luma, optionally inverted.'),
        elements: z.array(z.unknown()).min(1).describe('Elements that compose the mask layer.'),
      })
      .describe('Mask the group with another set of elements (alpha or luma).')
      .optional(),
  })
  .passthrough();

export const captionWordSchema = z.object({
  text: z.string(),
  start: z.number().nonnegative(),
  end: z.number().nonnegative(),
});

export const captionElementSchema = z
  .object({
    ...baseElementFields,
    type: z.literal('caption'),
    words: z.array(captionWordSchema).min(1).describe('Word timings: array of { text, start, end } in seconds; drives the karaoke-style highlight.'),
    style: z.enum(CAPTION_STYLES).describe('Kinetic caption preset (e.g. tiktok_bounce, fade_reveal, word_pop).').optional(),
    // Windowing: max letters per chunk (number) or auto word-chunking ('auto').
    max_length: z.union([z.number().int().positive(), z.literal('auto')]).describe('On-screen chunking: max letters per chunk (number) or "auto" (a few words); omit to show all words at once.').optional(),
    font_family: z.string().optional(),
    font_size: numberOrString.describe('Font size in px, a string, or "auto" to fit (default "auto").').optional(),
    font_weight: numberOrString.optional(),
    font_style: z.enum(['normal', 'italic']).optional(),
    fill_color: z.string().describe('Color of inactive (not-yet-spoken) words (default "#ffffff").').optional(),
    stroke_color: z.string().describe('Glyph outline color; pair with stroke_width.').optional(),
    stroke_width: z.number().describe('Glyph outline width in px (default 0).').optional(),
    text_align: z.enum(['left', 'center', 'right']).describe('Horizontal alignment (default "left").').optional(),
    line_height: z.number().describe('Line spacing as a multiple of font size (default 1.2).').optional(),
    letter_spacing: z.number().describe('Tracking in px added after each glyph (default 0).').optional(),
    background_color: z.string().describe('Background band behind the caption (default none).').optional(),
    background_border_radius: z.number().describe('Corner radius in px of the background band (default 0).').optional(),
    background_padding: z.union([z.number(), z.tuple([z.number(), z.number()])]).describe('Background band padding in px: a number, or [x, y] (default [0, 0]).').optional(),
    text_shadow: textShadowField,
    highlight_color: z.string().describe('Color of the active (currently-spoken) word (default "#ffd60a").').optional(),
    highlight_background_color: z.string().describe('Background color behind the active word (default none).').optional(),
  })
  .passthrough();

// ── Particles ──────────────────────────────────────────────────────────────

export const particlesElementSchema = z
  .object({
    ...baseElementFields,
    type: z.literal('particles'),
    rate: z.number().positive().describe('Particles emitted per second (default 60).').optional(),
    lifetime: z.number().positive().describe('Seconds each particle lives (default 1.5).').optional(),
    velocity: z.number().nonnegative().describe('Initial particle speed in px/s (default 300).').optional(),
    spread: z.number().min(0).max(360).describe('Emission cone width in degrees, 0-360 (default 360 = all directions).').optional(),
    direction: z.number().describe('Emission direction in degrees: 0 = right, 90 = down, -90 = up (default -90).').optional(),
    gravity: z.number().describe('Downward acceleration in px/s^2 (default 600).').optional(),
    color: z.union([z.string(), z.array(z.string()).min(1)]).describe('Particle color, or an array of colors picked per particle.').optional(),
    size: z.number().positive().describe('Particle size in px (default 12).').optional(),
    size_variation: z.number().min(0).max(1).describe('Random size variation, 0-1 (default 0.4).').optional(),
    particle_shape: z.enum(['square', 'circle']).describe('Particle shape (default "square").').optional(),
    rotation_speed: z.number().describe('Spin rate in degrees/s (default 360).').optional(),
    burst: z.boolean().describe('Emit all particles at once instead of continuously (default false).').optional(),
    burst_count: z.number().int().min(1).max(2000).describe('Particles emitted in burst mode (default 80).').optional(),
    fade_at: z.number().min(0).max(1).describe('Lifetime fraction where fade-out begins, 0-1 (default 0.7).').optional(),
    z_velocity: z.number().describe('Depth speed in px/s along the plane normal (default 0).').optional(),
    z_spread: z.number().nonnegative().describe('Random depth-speed range in px/s (default 0).').optional(),
    target_points: z.array(z.tuple([z.number(), z.number()])).describe('Canvas-space [x, y] targets the particles converge toward.').optional(),
    convergence_easing: easingSchema.describe('Easing for convergence toward target_points.').optional(),
    scatter_radius: z.number().nonnegative().describe('Spawn-disk radius in px (default = the larger canvas dimension).').optional(),
  })
  .passthrough();

// ────────────────────────────────────────────────────────────────────────────
// Discriminated union & Source root
// ────────────────────────────────────────────────────────────────────────────

// Explicitly typed for the same reason as sourceSchema below — with the
// effects union aboard, the inferred type exceeds what tsc will
// serialize into declarations. The boundary type remains `Element`.
export const elementSchema: z.ZodTypeAny = z.discriminatedUnion('type', [
  videoElementSchema,
  imageElementSchema,
  textElementSchema,
  shapeElementSchema,
  audioElementSchema,
  groupElementSchema,
  captionElementSchema,
  particlesElementSchema,
]);

// Explicitly typed as ZodTypeAny: the inferred type of the discriminated-
// union-of-7-passthrough-objects-inside-an-array is too large for tsc to
// serialize when emitting declarations. The runtime boundary type is `Source`,
// enforced at the `validate()` callsite via cast.
const fontFaceSchema = z
  .object({
    family: z.string().min(1).describe('Family name that text/caption elements reference via font_family.'),
    weight: z.union([z.number(), z.string()]).describe('CSS font-weight this face covers, e.g. 400, "bold", or a range "100 900" (default "normal").').optional(),
    style: z.enum(['normal', 'italic']).optional(),
    src: z.string().min(1).describe('Font file URL (http(s), relative, or data: URI).'),
    unicode_range: z.string().describe('CSS unicode-range this face covers, for subsetting.').optional(),
  })
  .passthrough();

const cameraSchema = z
  .object({
    perspective: z.union([z.number().positive(), z.array(keyframeSchema), exprSchema]).describe('Focal distance in px (>0); smaller = stronger perspective foreshortening.'),
    origin_x: z.union([z.number(), z.string()]).describe('Vanishing-point x, px or string (default canvas center).').optional(),
    origin_y: z.union([z.number(), z.string()]).describe('Vanishing-point y, px or string (default canvas center).').optional(),
    // CKP/1.0 movable pose (§4.4.2) — all default 0; identity pose ⇒ V=I.
    x: z.union([z.number(), z.array(keyframeSchema), exprSchema]).describe('Camera dolly x in px (default 0).').optional(),
    y: z.union([z.number(), z.array(keyframeSchema), exprSchema]).describe('Camera dolly y in px (default 0).').optional(),
    z: z.union([z.number(), z.array(keyframeSchema), exprSchema]).describe('Camera dolly toward the scene in px; +z = closer (default 0).').optional(),
    x_rotation: z.union([z.number(), z.array(keyframeSchema), exprSchema]).describe('Camera pitch in degrees (default 0).').optional(),
    y_rotation: z.union([z.number(), z.array(keyframeSchema), exprSchema]).describe('Camera yaw in degrees (default 0).').optional(),
    z_rotation: z.union([z.number(), z.array(keyframeSchema), exprSchema]).describe('Camera roll in degrees (default 0).').optional(),
    // Compositing order under the camera (§4.4.3). Default 'depth'.
    sort: z.enum(['depth', 'paint']).describe('Compositing order: "depth" (2.5D by z, default) or "paint" (fixed layer order, highest layer on top).').optional(),
  })
  .passthrough();

// ── CKP/1.0 cross-field rules (§4.4) ──
// `rotation` and `z_rotation` are one slot — both authored is an error.
// (An earlier 1.1 draft also forbade glass under un-flattened 3D; the
// runtime now projects glass through the pane's plane homography, so
// glass×3D is legal — §4.7.)
// Row keys that may never appear in repeat_data (§3.7): structural element
// fields, plus every name the expression grammar already owns.
const ROW_KEY_RESERVED = new Set([
  'id', 'type', 'layer', 'elements', 'repeat', 'repeat_data', 'repeat_stagger', 'style',
  't', 'dur', 'i', 'n', 'value', 'PI', 'TAU', 'E',
]);

function checkElements(
  elements: unknown[],
  path: (string | number)[],
  ctx: z.RefinementCtx,
  styleNames: Set<string> | null,
): void {
  // Uniqueness (the AE one-element-per-layer invariant): every element
  // in a container owns a distinct `layer`. Duplicates are a HARD error
  // — sources are corrected at author time, never repaired on load.
  // Reported on each colliding element's `layer`.
  const layerIndices = new Map<number, number[]>();
  elements.forEach((raw, i) => {
    if (typeof raw !== 'object' || raw === null) return;
    const layer = (raw as Record<string, unknown>).layer;
    if (typeof layer === 'number') {
      const seen = layerIndices.get(layer);
      if (seen) seen.push(i);
      else layerIndices.set(layer, [i]);
    }
  });
  for (const [layer, indices] of layerIndices) {
    if (indices.length < 2) continue;
    for (const i of indices) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, i, 'layer'],
        message: `duplicate layer ${layer} — each element in a container needs a unique layer (highest layer = top); renumber the colliding elements`,
      });
    }
  }

  elements.forEach((raw, i) => {
    if (typeof raw !== 'object' || raw === null) return;
    const el = raw as Record<string, unknown>;
    const elPath = [...path, i];

    // Generated sets (§3.7): image/text/shape/group only. Other element
    // types silently ignoring `repeat` would render 1 copy where N were
    // authored — reject instead.
    const hasRepeat = el.repeat !== undefined || el.repeat_data !== undefined;
    if (hasRepeat && typeof el.type === 'string' && !['image', 'text', 'shape', 'group'].includes(el.type)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...elPath, el.repeat !== undefined ? 'repeat' : 'repeat_data'],
        message: 'generated sets (§3.7) are only valid on image, text, shape and group elements',
      });
    }
    if (el.repeat !== undefined && el.repeat_data !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...elPath, 'repeat'],
        message: '`repeat` and `repeat_data` are mutually exclusive — the row count IS the copy count (§3.7)',
      });
    }
    if (el.repeat_stagger !== undefined && !hasRepeat) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...elPath, 'repeat_stagger'],
        message: '`repeat_stagger` requires `repeat` or `repeat_data` (§3.7)',
      });
    }
    if (Array.isArray(el.repeat_data)) {
      el.repeat_data.forEach((row, r) => {
        if (typeof row !== 'object' || row === null) return;
        for (const key of Object.keys(row)) {
          if (ROW_KEY_RESERVED.has(key)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [...elPath, 'repeat_data', r, key],
              message: `row key "${key}" is reserved (structural element fields and expression names cannot be row keys, §3.7)`,
            });
          }
        }
      });
    }
    if (el.style !== undefined && styleNames !== null && typeof el.style === 'string' && !styleNames.has(el.style)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...elPath, 'style'],
        message: `unknown style "${el.style}" — declare it in the Source-level styles map (§2.3)`,
      });
    }

    if (el.rotation !== undefined && el.z_rotation !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...elPath, 'z_rotation'],
        message: '`rotation` and `z_rotation` are the same slot — author one, not both (§4.4)',
      });
    }

    if (el.type === 'group' && Array.isArray(el.elements)) {
      checkElements(el.elements, [...elPath, 'elements'], ctx, styleNames);
    }
    const mask = el.mask as { elements?: unknown[] } | undefined;
    if (el.type === 'group' && mask && Array.isArray(mask.elements)) {
      checkElements(mask.elements, [...elPath, 'mask', 'elements'], ctx, styleNames);
    }
  });
}

export const sourceSchema: z.ZodTypeAny = z
  .object({
    // Clipkit Protocol version. Absence defaults to '1.0'. Unknown values
    // validate but downstream runtimes are expected to warn — see
    // PROTOCOL.md §11.
    clipkit_version: z.string().describe('Protocol version (default "1.0").').optional(),
    output_format: z.enum(OUTPUT_FORMATS).describe('Output format: "mp4" (default) or "gif".').optional(),
    width: z.number().int().positive().describe('Canvas width in px (default 1920).').optional(),
    height: z.number().int().positive().describe('Canvas height in px (default 1080).').optional(),
    duration: z.union([z.number().nonnegative(), z.literal('auto')]).describe('Total duration in seconds, or "auto" to fit the longest element (default "auto").').optional(),
    frame_rate: z.number().positive().describe('Frames per second (default 30).').optional(),
    background_color: z.string().describe('Canvas background color (default opaque black "#000000").').optional(),
    fonts: z.array(fontFaceSchema).describe('Custom font faces to register before rendering.').optional(),
    styles: z.record(z.string().min(1), styleSchema).describe('Named appearance bundles (§2.3) that image/text/shape elements reference via `style`. One merge rule, no cascade: defaults < style < the element\'s own fields.').optional(),
    motion_blur: z
      .object({
        samples: z.number().int().min(1).max(32).describe('Sub-frame samples, 1-32 (default 8).').optional(),
        shutter: z.number().gt(0).max(1).describe('Shutter as a fraction of the frame interval, 0..1 (default 0.5).').optional(),
      })
      .passthrough()
      .optional(),
    camera: cameraSchema.describe('Scene camera (perspective + pose); omit for flat 2D.').optional(),
    lights: z.array(lightSchema).describe('Scene lights for PBR materials; omit for unlit.').optional(),
    environment: environmentSchema.describe('Environment map for material reflections.').optional(),
    bloom: bloomSchema.describe('Post-process bloom (glow on bright areas).').optional(),
    output_dither: z
      .union([
        z.boolean(),
        z
          .object({
            enabled: z.boolean().describe('Master switch; omit ⇒ on, false disables.').optional(),
            amplitude: z.number().min(0).max(8).describe('Dither amplitude in 8-bit LSB (default 1 ≈ ±0.5 LSB). 0 disables.').optional(),
            pattern: z.enum(['bayer', 'noise']).describe('Ordered Bayer (default) or static triangular-PDF noise.').optional(),
          })
          .passthrough(),
      ])
      .describe('Anti-banding output dither, DEFAULT ON. `true`/`false` or `{ enabled, amplitude, pattern }`. A global sub-LSB stipple so gradients/shadows/blur quantize to 8-bit without banding; deterministic. Distinct from the retro `dither` effect.')
      .optional(),
    elements: z.array(elementSchema).min(1).describe('The scene content (at least one element); drawn by z-depth then layer order (highest layer on top).'),
  })
  .passthrough()
  .superRefine((src: Record<string, unknown>, ctx: z.RefinementCtx) => {
    if (Array.isArray(src.elements)) {
      const styleNames = typeof src.styles === 'object' && src.styles !== null
        ? new Set(Object.keys(src.styles))
        : new Set<string>();
      checkElements(src.elements, ['elements'], ctx, styleNames);
    }
  });
