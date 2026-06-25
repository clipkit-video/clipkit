// Backend interface — the GPU abstraction the compositor draws into.
//
// Designed deliberately small. Element renderers shouldn't know whether
// they're talking to WebGPU or WebGL2; they just call drawShape / drawTexturedQuad
// with pixel-space coordinates and premultiplied colors. The backend is
// responsible for NDC math, buffer allocation, and dispatch.

import type { RGBA } from '../compositor/color.js';

/** Acceptable sources for createTexture / updateTexture. */
export type TextureSource =
  | ImageBitmap
  | HTMLCanvasElement
  | OffscreenCanvas
  | HTMLVideoElement
  | VideoFrame
  | HTMLImageElement;

/** Opaque texture handle. Backends define their own concrete type. */
export interface Texture {
  readonly width: number;
  readonly height: number;
  readonly id: number;
}

export interface BackendGradientStop {
  /** Position 0..1 along the gradient. */
  offset: number;
  /** Premultiplied RGBA. */
  color: RGBA;
}

export type BackendGradient =
  | {
      type: 'linear';
      /** Angle in radians. Caller converts from schema degrees. */
      angle: number;
      stops: BackendGradientStop[];
    }
  | {
      type: 'radial';
      /** Center as fraction of shape's box, 0..1. */
      cx: number;
      cy: number;
      /** Outer radius as fraction of shape's box. */
      radius: number;
      stops: BackendGradientStop[];
    };

/**
 * PBR lighting payload for a quad draw (CKP/1.0 §4.8). Present only when
 * the element carries a `material` AND the scene has lights — the backend
 * then takes the "lit" shader path; absent ⇒ the unlit fast path.
 * Everything is in world (canvas-pixel, pre-camera) space.
 */
export interface LitParams {
  /** Straight (non-premultiplied) base color / albedo for shapes. */
  albedo: RGBA;
  /** Straight stroke albedo (when the shape has a stroke). */
  strokeAlbedo?: RGBA;
  roughness: number;
  metalness: number;
  reflectivity: number;
  emissive: number;
  /** Column-major mat4 mapping the unit quad to WORLD (pre-camera) pixels. */
  worldMatrix: ArrayLike<number>;
  /** World-space face normal (unit). */
  normal: readonly [number, number, number];
  /**
   * Tangent-space normal map (§4.8 Phase 2). When present the backend
   * perturbs the face normal by the sampled map using the (tangent,
   * bitangent, normal) basis. Absent ⇒ flat face normal.
   */
  normalMap?: {
    texture: Texture;
    /** Perturbation strength (0 flat .. 1 as-authored .. >1 exaggerated). */
    scale: number;
    /** World-space tangent (unit) — the quad's +U direction. */
    tangent: readonly [number, number, number];
    /** World-space bitangent (unit) — the quad's +V direction. */
    bitangent: readonly [number, number, number];
  };
  /** Camera eye in world space (view-vector origin). */
  eye: readonly [number, number, number];
  /** Summed ambient light color. */
  ambient: readonly [number, number, number];
  /** Directional lights (≤4): unit directions toward the light. */
  lightDirs: ReadonlyArray<readonly [number, number, number]>;
  /** Directional light colors (×intensity), parallel to lightDirs. */
  lightColors: ReadonlyArray<readonly [number, number, number]>;
  /**
   * Scene environment (§4.8) reflective materials sample along the
   * reflection vector. Absent ⇒ no environment reflection. Gradient
   * stops are straight RGB, sorted by offset (≤4); `envAvg` is the mean
   * color (irradiance / fully-rough fallback).
   */
  env?: {
    stopColors: ReadonlyArray<readonly [number, number, number]>;
    stopOffsets: ReadonlyArray<number>;
    avg: readonly [number, number, number];
    /**
     * Equirectangular environment texture (§4.8 Phase 3). When present the
     * shader samples it along the reflection vector instead of the
     * gradient stops; roughness still blurs toward `avg`.
     */
    image?: Texture;
  };
}

export interface ShapeDrawParams {
  /** Center X in canvas pixels. */
  cx: number;
  /** Center Y in canvas pixels. */
  cy: number;
  /** Width in canvas pixels. */
  width: number;
  /** Height in canvas pixels. */
  height: number;
  /** Rotation in degrees, around the center. */
  rotation: number;
  /** Premultiplied RGBA in 0..1. Used only when `gradient` is undefined. */
  color: RGBA;
  /**
   * Optional gradient fill. When present, the backend renders with the
   * gradient pipeline and ignores `color`. Up to 4 stops are supported.
   */
  gradient?: BackendGradient;
  /**
   * Corner radius in PIXELS. The backend clamps to half the smaller side so
   * an overflowing value produces a pill / circle instead of a glitch.
   *
   * Corner SDFs run in pixel space inside the shaders, so non-square
   * rectangles still produce circular corner arcs (not stretched ellipses).
   */
  cornerRadius?: number;
  shape?: 'rectangle' | 'ellipse';
  /**
   * Stroke (border) color in premultiplied RGBA, applied to the band of
   * pixels within `strokeWidth` of the shape's boundary. Only used when
   * `strokeWidth > 0`. The fill (`color` or `gradient`) renders inside
   * the stroke band; the stroke renders cleanly over its own pixels
   * (no compositing through translucent fills).
   */
  strokeColor?: RGBA;
  /** Stroke width in PIXELS. 0 or undefined disables the stroke. */
  strokeWidth?: number;
  /**
   * Horizontal skew in DEGREES (CSS `skewX(...)`). Sheares the shape
   * horizontally — top edge moves right for positive values, left for
   * negative. Applied BEFORE rotation in the transform composition, so
   * a `rotation + skew_x` combo matches CSS's `rotate(R) skewX(S)`.
   */
  skewX?: number;
  /**
   * Vertical skew in DEGREES (CSS `skewY(...)`). Positive moves the
   * right edge down. Composes with skewX as a single shear matrix,
   * matching CSS `skew(x, y)`.
   */
  skewY?: number;
  /**
   * CKP/1.0 full-matrix hand-off (§4.4): a pixel-space column-major
   * mat4 (16 values, f64) mapping the shared unit quad (a_pos ∈
   * [-1, 1]², Y-up) to Y-down pixel coordinates, with w carrying any
   * perspective. When present the backend projects it to the current
   * surface (projectPixelMatrix) and IGNORES cx/cy/rotation/skewX/
   * skewY — those are baked in. `width`/`height` are still read for
   * pixel-space SDF uniforms (corner radius, stroke) and must be the
   * element's LOCAL dimensions.
   */
  transform?: ArrayLike<number>;
  /** Blend against the destination. Default 'normal'. */
  blend?: BlendMode;
  /** PBR lighting (§4.8). Present ⇒ lit shader path; absent ⇒ unlit. */
  lit?: LitParams;
}

/**
 * Drop-shadow draw call. The shape geometry is the SAME as a
 * companion `drawShape` (centered at `cx, cy` with width/height/etc.);
 * the shadow renders a quad expanded by `blur` on each side and offset
 * by `(offsetX, offsetY)`. Inside the shape's SDF the alpha is full;
 * outside, alpha fades to 0 over `blur` pixels via a smoothstep — so
 * pixels past `blur` discard, and pixels at the shape's edge get full
 * shadow color. Designed to sit BEHIND its companion shape; the shape
 * itself paints over the inside-of-shape shadow region.
 */
export interface ShapeShadowDrawParams {
  /** Center X of the SHAPE (shadow is offset relative to this). */
  cx: number;
  /** Center Y of the SHAPE. */
  cy: number;
  /** Width of the SHAPE in pixels. */
  width: number;
  /** Height of the SHAPE in pixels. */
  height: number;
  /** Rotation in DEGREES (matches the shape's rotation). */
  rotation: number;
  /** Horizontal skew in DEGREES (matches the shape's skew). */
  skewX?: number;
  /** Vertical skew in DEGREES (matches the shape's skew). */
  skewY?: number;
  /** Corner radius in PIXELS. */
  cornerRadius?: number;
  shape?: 'rectangle' | 'ellipse';
  /** Shadow X offset in pixels. */
  offsetX: number;
  /** Shadow Y offset in pixels. */
  offsetY: number;
  /** Blur radius in pixels (falloff distance). */
  blur: number;
  /** Shadow color in premultiplied RGBA. */
  color: RGBA;
  /**
   * Full-matrix hand-off — see ShapeDrawParams.transform. For shadows
   * the matrix must already place the EXPANDED quad (width + 2·blur ×
   * height + 2·blur, centered at cx + offsetX / cy + offsetY in the
   * element's local plane): when present, the backend skips its own
   * offset/expand composition.
   */
  transform?: ArrayLike<number>;
}

export interface TexturedQuadDrawParams {
  cx: number;
  cy: number;
  width: number;
  height: number;
  rotation: number;
  texture: Texture;
  /**
   * Texture sub-region in normalized UV space (0..1). Defaults to the
   * whole texture `[0, 0, 1, 1]`. UV origin is top-left.
   */
  uvRect?: readonly [number, number, number, number];
  /**
   * Premultiplied RGBA color tint, multiplied with the texture sample.
   * Defaults to `[1, 1, 1, 1]` (no tint).
   */
  tint?: RGBA;
  /**
   * Corner radius in PIXELS for rounded-rect masking. When > 0, pixels
   * outside the rounded-rect SDF are discarded (with anti-aliased
   * edges). Clamped to half the smaller dim; pass a huge value for
   * a pill / circle. Matches CSS `border-radius` on `<img>` elements.
   */
  cornerRadius?: number;
  /** Horizontal skew in DEGREES (CSS `skewX`). */
  skewX?: number;
  /** Vertical skew in DEGREES (CSS `skewY`). */
  skewY?: number;
  /** Full-matrix hand-off — see ShapeDrawParams.transform. */
  transform?: ArrayLike<number>;
  /** Blend against the destination. Default 'normal'. */
  blend?: BlendMode;
  /**
   * Exponent applied to the sample's coverage (alpha) before tinting:
   * a' = a^alphaGamma, with the premultiplied color rescaled to match.
   * Default 1 (no-op). The text renderer passes a tint-luminance-
   * derived value to approximate Chrome's gamma-corrected text AA —
   * linear alpha blending over-darkens the fringe of dark-on-light
   * glyphs, which reads as artificial boldness at small sizes.
   */
  alphaGamma?: number;
  /**
   * PBR lighting (§4.8). Present ⇒ lit textured path (the texture's own
   * pixels are the albedo); absent ⇒ unlit. Used for lit images/video
   * and flattened group-card layers. `alphaGamma` is ignored when lit.
   */
  lit?: LitParams;
}

/**
 * Capabilities reported by the backend after init.
 */
export interface BackendCapabilities {
  /** 'webgpu' or 'webgl2'. */
  readonly api: 'webgpu' | 'webgl2';
  /** Maximum texture dimension supported. */
  readonly maxTextureSize: number;
}

/**
 * An offscreen layer: draws go INTO it between pushTarget/popTarget,
 * and its `texture` can then be sampled like any uploaded image (via
 * drawTexturedQuad or custom composite passes). The keystone for blend
 * modes, masks, wipes, filters, and group clipping.
 *
 * Dimensions are LOGICAL (source coordinates); the backing store is
 * allocated at the backend's current pixel ratio.
 */
export interface RenderTarget {
  readonly texture: Texture;
  readonly width: number;
  readonly height: number;
}

/** How a mask layer's pixels gate the content layer. */
export type MaskMode = 'alpha' | 'alpha-inverted' | 'luma' | 'luma-inverted';

/**
 * How a draw combines with the destination. 'normal'/'multiply'/
 * 'screen'/'add' are fixed-function on premultiplied sources. The
 * piecewise modes — 'overlay'/'hard-light'/'soft-light' — can't be
 * expressed by fixed-function blending; the compositor isolates such
 * elements to a layer and composites them against a backdrop snapshot
 * via drawBackdropBlend() rather than the per-draw `blend` path.
 */
export type BlendMode = 'normal' | 'multiply' | 'screen' | 'add' | 'overlay' | 'hard-light' | 'soft-light';

/** The subset of blend modes that require backdrop-sampling compositing. */
export type ProgrammableBlendMode = 'overlay' | 'hard-light' | 'soft-light';

export function isProgrammableBlend(mode: BlendMode | undefined): mode is ProgrammableBlendMode {
  return mode === 'overlay' || mode === 'hard-light' || mode === 'soft-light';
}

/**
 * Composite a content texture through a mask texture in one quad —
 * the two-layer primitive behind group masks (and the wipe-family
 * transitions, which are just masks animated over time).
 */
export interface MaskedQuadDrawParams {
  cx: number;
  cy: number;
  width: number;
  height: number;
  rotation: number;
  /** Content layer (premultiplied). */
  content: Texture;
  /** Mask layer (premultiplied). */
  mask: Texture;
  mode: MaskMode;
  /** Premultiplied tint, defaults [1,1,1,1]. Carries group opacity. */
  tint?: RGBA;
  /** Full-matrix hand-off — see ShapeDrawParams.transform. */
  transform?: ArrayLike<number>;
  /** Blend against the destination. Default 'normal'. */
  blend?: BlendMode;
}

/**
 * Composite a layer texture 1:1 onto the current surface through the
 * filter shader — the primitive behind element filters (blur /
 * brightness / contrast / saturation). Always axis-aligned: the
 * element's own transform was already applied when it rendered INTO
 * the layer.
 *
 * Blur is separable: the compositor runs a horizontal pass into a
 * scratch target, then a vertical pass onto the destination. Each
 * pass samples a 25-tap Gaussian spread over ±3σ along
 * `blurDir`. Color ops run on straight (unpremultiplied) alpha in the
 * order brightness → contrast → saturation, and only need to be set
 * on the FINAL pass.
 */
export interface FilteredQuadDrawParams {
  cx: number;
  cy: number;
  width: number;
  height: number;
  texture: Texture;
  /** Gaussian σ in LOGICAL canvas pixels. 0 disables blur taps. */
  blurRadius: number;
  /** Blur tap direction: [1,0] horizontal pass, [0,1] vertical. */
  blurDir: readonly [number, number];
  /** Brightness multiplier, 1 = unchanged. */
  brightness: number;
  /** Contrast multiplier around mid-gray, 1 = unchanged. */
  contrast: number;
  /** Saturation multiplier (Rec. 709 luma), 1 = unchanged. */
  saturation: number;
  /** Hue rotation in DEGREES (SVG hueRotate matrix), 0 = unchanged. */
  hueRotate?: number;
  /** Premultiplied tint, defaults [1,1,1,1]. */
  tint?: RGBA;
  /** Blend against the destination. Default 'normal'. */
  blend?: BlendMode;
}

/**
 * Composite an isolated element layer onto the current target using a
 * piecewise (backdrop-sampling) blend mode — overlay/hard-light/
 * soft-light. The shader reads both `src` (the element, rendered alone
 * into a transparent layer) and `backdrop` (a snapshot of the target
 * taken BEFORE the element drew), runs the W3C separable composite, and
 * REPLACES the target region. Both textures are full surface size and
 * premultiplied.
 */
export interface BackdropBlendDrawParams {
  /** Isolated element layer, premultiplied, surface-sized. */
  src: Texture;
  /** Backdrop snapshot, premultiplied, surface-sized. */
  backdrop: Texture;
  /** Which piecewise blend to apply. */
  mode: ProgrammableBlendMode;
  /** Full-surface quad size in logical pixels. */
  width: number;
  height: number;
  /** copySurfaceTo may report the snapshot vertically flipped. */
  backdropFlipY?: boolean;
}

/** Stylize-effect modes — `element.effects` types (§4.7). */
export type StylizeMode =
  | 'pixelate'
  | 'dither'
  | 'halftone'
  | 'ascii'
  | 'drop_shadow'
  | 'glow'
  | 'stroke'
  | 'chroma_key'
  | 'luma_key'
  | 'levels'
  | 'lut'
  | 'fractal_noise'
  | 'turbulent_displace'
  | 'bloom_bright';

/** Mode → shader index, shared by both stylize shaders. */
export const STYLIZE_MODE_INDEX: Record<StylizeMode, number> = {
  pixelate: 0, dither: 1, halftone: 2, ascii: 3,
  drop_shadow: 4, glow: 5, stroke: 6,
  chroma_key: 7, luma_key: 8, levels: 9, lut: 10,
  fractal_noise: 11, turbulent_displace: 12, bloom_bright: 13,
};

/**
 * One stylize pass: a layer texture drawn 1:1 through the effect
 * shader. Like drawFilteredQuad, always axis-aligned — the element's
 * transform was applied when it rendered into the layer. Chained
 * effects ping-pong between two scratch targets; the last pass draws
 * to the surface with the element's blend mode.
 *
 * Param meaning by mode (px values are LOGICAL; the backend scales
 * px-dimensioned params by its pixel ratio):
 *   pixelate:    p0 = cell size px
 *   dither:      p0 = levels per channel (NOT px-scaled)
 *   halftone:    p0 = cell size px, p1 = grid angle degrees
 *   ascii:       p0 = cell size px (aux = 80×8 glyph-ramp atlas, required)
 *   drop_shadow: p0/p1 = offset px (aux = ladder-blurred layer; tint =
 *                shadow color × opacity, premultiplied)
 *   glow:        p0 = intensity (aux = ladder-blurred layer; tint = color)
 *   stroke:      p0 = width px (tint = color; ring-samples the layer)
 *   chroma_key:  p0 = CbCr tolerance, p1 = softness (NOT px-scaled;
 *                tint = STRAIGHT key color rgb, tint.a = spill strength)
 *   luma_key:    p0 = luma threshold, p1 = softness (NOT px-scaled;
 *                tint.r = invert flag 0/1)
 *   levels:      p0 = gamma (NOT px-scaled; tint = (in_black, in_white,
 *                out_black, out_white))
 *   lut:         p0 = lattice size N, p1 = intensity (NOT px-scaled;
 *                aux = the N²×N LUT atlas, slices along x = blue axis)
 *   fractal_noise: p0 = scale px, p1 = evolution (NOT scaled);
 *                tint = (offset_x/scale, offset_y/scale, octaves, seed)
 *   turbulent_displace: p0 = amount px, p1 = scale px;
 *                tint = (evolution, octaves, seed, 0)
 */
export interface StylizedQuadDrawParams {
  cx: number;
  cy: number;
  width: number;
  height: number;
  texture: Texture;
  mode: StylizeMode;
  p0: number;
  p1?: number;
  /** Secondary texture ('ascii' glyph atlas). Defaults to `texture`. */
  aux?: Texture;
  /** Premultiplied tint, defaults [1,1,1,1]. */
  tint?: RGBA;
  /** Blend against the destination. Default 'normal'. */
  blend?: BlendMode;
}

/**
 * The glass composite (§4.7 `glass`) — a faithful port of the
 * ybouane/liquidglass optical model, evaluated ANALYTICALLY from the
 * pane's rounded-rect SDF (glass applies to shape elements, where the
 * geometry is known exactly — deriving it from a blurred alpha field
 * produces flat "lip" artifacts at the rim). Drawn as a full-surface
 * quad; the SDF does the masking and the outside-only drop shadow.
 *
 * Pixel-dimensioned params are LOGICAL px (backend scales by its pixel
 * ratio): paneCx/paneCy/paneHalfW/paneHalfH/cornerRadius/zRadius/
 * shadowSpread/shadowOffY.
 */
export interface GlassQuadDrawParams {
  /** Full-surface composite quad (like drawFilteredQuad). */
  cx: number;
  cy: number;
  width: number;
  height: number;
  /** FROSTED backdrop snapshot (premultiplied). */
  backdrop: Texture;
  /** UNBLURRED backdrop snapshot; pass `backdrop` when blur is 0. */
  backdropSharp: Texture;
  /** GL-canvas snapshots are bottom-up; the shader flips at sample time. */
  backdropFlipY: boolean;
  /** Pane centre in surface coordinates. */
  paneCx: number;
  paneCy: number;
  /** Pane half-size. */
  paneHalfW: number;
  paneHalfH: number;
  /** Corner radius (clamped to min(half) in-shader). */
  cornerRadius: number;
  /** Pane rotation in degrees (SDF evaluates in pane-local coords). */
  rotation: number;
  /**
   * CKP/1.0 glass under 3D (§4.7): pane-local→surface homography
   * (column-major 3×3, LOGICAL px, origin at the pane centre, y down).
   * When set, pane-local coordinates come from its inverse and
   * refracted backdrop samples forward-map through it; `rotation` and
   * `paneCx`/`paneCy` are ignored (fold them into the homography).
   * Omitted = the 2D orthographic path, byte-stable.
   */
  paneHomography?: ArrayLike<number>;
  /** Bevel z-radius — the lens depth (our `edge_width`). */
  zRadius: number;
  /** Refraction dial, reference scale (≈0..1; displacement ∝ ×30 px). */
  refract: number;
  /** Chromatic aberration dial, reference scale (≈0..1; ×18 px). */
  chroma: number;
  /** Edge highlight (rim/glow/stroke) dial. */
  edgeHighlight: number;
  /** Blinn-Phong specular dial (reference default 0). */
  specular: number;
  /** Fresnel dial (reference default 1). */
  fresnel: number;
  /** Saturation adjustment, −1..1 (0 = unchanged). */
  saturation: number;
  /** Glass tint as STRAIGHT RGBA; alpha = strength. */
  tint: RGBA;
  /** Pane opacity 0..1. */
  alpha: number;
  /** 'pill' = biconvex (0), 'dome' = plano-convex magnifier (1). */
  bevelMode: number;
  /** Shadow opacity 0..1 (painted only outside the SDF). */
  shadowAlpha: number;
  /** Shadow spread in px. */
  shadowSpread: number;
  /** Shadow vertical offset in px. */
  shadowOffY: number;
  /** Blend against the destination. Default 'normal'. */
  blend?: BlendMode;
}

export interface Backend {
  /** The canvas this backend renders into. Set at construction. */
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  /** Current draw-buffer width in pixels. */
  readonly width: number;
  /** Current draw-buffer height in pixels. */
  readonly height: number;

  /**
   * Initialize the GPU context, device, and pipelines.
   * Returns false if this backend can't run in the current environment
   * (e.g. WebGPU not available). The caller can then fall back to a
   * different backend.
   */
  init(): Promise<boolean>;

  /** Capabilities — only valid after init() resolves true. */
  readonly capabilities: BackendCapabilities;

  /**
   * Resize the draw buffer.
   *
   * `width` and `height` are *logical* dimensions in source coordinates
   * — what `composeQuadTransform` uses to map source positions to NDC.
   * `pixelRatio` (default 1) multiplies the *physical* canvas backing
   * store and viewport. With pixelRatio=2, a source authored at
   * 1920×1080 renders into a 3840×2160 backing store at 2× pixel
   * density. Source coordinates stay the same; shaders rasterize at
   * higher resolution and the encoder pulls the larger frame.
   */
  resize(width: number, height: number, pixelRatio?: number): void;

  /**
   * Create a GPU texture from a source. Sources are assumed to be in
   * straight-alpha; the backend premultiplies during upload.
   */
  createTexture(source: TextureSource): Texture;
  /** Replace the contents of an existing texture (same dimensions). */
  updateTexture(texture: Texture, source: TextureSource): void;
  destroyTexture(texture: Texture): void;

  /**
   * Start a frame. Clears the canvas to the given premultiplied color
   * (defaults to opaque black).
   */
  beginFrame(clearColor?: RGBA): void;

  /** Draw a single-color rectangle / ellipse with optional rounded corners. */
  drawShape(params: ShapeDrawParams): void;

  /** Draw a drop shadow behind a shape — see `ShapeShadowDrawParams`. */
  drawShapeShadow(params: ShapeShadowDrawParams): void;

  /** Draw a textured rectangle. */
  drawTexturedQuad(params: TexturedQuadDrawParams): void;

  /** Composite a content texture through a mask texture. */
  drawMaskedQuad(params: MaskedQuadDrawParams): void;

  /** Composite a layer through the filter shader (blur / color ops). */
  drawFilteredQuad(params: FilteredQuadDrawParams): void;

  /** Composite a layer through one stylize-effect pass (§4.7). */
  drawStylizedQuad(params: StylizedQuadDrawParams): void;

  /** Glass composite — refract/frost a backdrop snapshot (§4.7). */
  drawGlassQuad(params: GlassQuadDrawParams): void;

  /** Composite an isolated layer with a piecewise blend mode (§4.5). */
  drawBackdropBlend(params: BackdropBlendDrawParams): void;

  /**
   * Copy the CURRENT surface's pixels into a render target of the same
   * logical size — the backdrop snapshot behind the glass effect. Call
   * while the surface still holds only the pixels drawn so far (i.e.
   * before pushing the effect chain's scratch targets). Returns whether
   * the copied rows are bottom-up (GL canvas) so the sampler can flip.
   */
  copySurfaceTo(target: RenderTarget): { flippedY: boolean };

  // ── Offscreen render targets ──────────────────────────────────────

  /** Allocate an offscreen layer (logical dimensions). */
  createRenderTarget(width: number, height: number): RenderTarget;
  /** Release a layer's GPU resources (including its texture). */
  destroyRenderTarget(target: RenderTarget): void;
  /**
   * Redirect subsequent draws into the target, cleared to `clearColor`
   * (default transparent). Nestable; MUST be balanced with popTarget
   * within the same frame.
   */
  pushTarget(target: RenderTarget, clearColor?: RGBA): void;
  /** Restore drawing to the previous surface (target or canvas). */
  popTarget(): void;

  /** Submit the frame's commands to the GPU and present. */
  endFrame(): void;

  /**
   * Resolve when all submitted GPU work has actually executed. Drains
   * the pipeline — use sparingly (e.g. periodic true-cost measurement
   * for the preview's adaptive motion-blur budget), never per frame.
   */
  finish(): Promise<void>;

  /** Release all GPU resources. After this the backend is unusable. */
  dispose(): void;
}
