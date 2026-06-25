// Shared context object threaded through element renderers.
//
// The runtime populates this once per frame and hands it to each
// renderElement(...) call. Renderers read what they need and call into
// the backend to emit draw commands.

import type { Backend, RenderTarget, Texture } from '../backend/backend.js';
import type { AssetCache } from '../assets/cache.js';
import type { Mp4FrameSource } from '../assets/mp4-frame-source.js';
import type { FontAtlas } from '../text/font-atlas.js';
import type { CanvasDimensions } from './unit.js';
import type { ResolvedEnvironment, ResolvedLight } from './lighting.js';

export interface ImageAsset {
  bitmap: ImageBitmap;
  texture: Texture;
}

export interface VideoAsset {
  /**
   * The decoding element when the runtime owns playback via the DOM
   * (page contexts). Null in worker contexts.
   */
  video: HTMLVideoElement | null;
  /**
   * Deterministic WebCodecs decode path (fetch + demux + VideoDecoder)
   * — the primary video source in worker contexts, where
   * HTMLVideoElement doesn't exist. `runtime.prepareVideoFrames(t)`
   * pulls the exact frame for each render time and uploads it before
   * the synchronous frame() pass.
   */
  frameSource: Mp4FrameSource | null;
  texture: Texture;
  /**
   * Element-backed: video.currentTime at last upload. FrameSource-
   * backed: the µs timestamp of the last uploaded frame. Externally
   * pumped: unused (uploads happen at push time).
   */
  lastUploadedTime: number;
  /** Natural media width in pixels (videoWidth for element-backed assets). */
  width: number;
  /** Natural media height in pixels. */
  height: number;
}

export interface SvgRasterAsset {
  canvas: OffscreenCanvas;
  ctx: OffscreenCanvasRenderingContext2D;
  texture: Texture;
  /**
   * Pixel signature — frame-to-frame compared in renderPathShape
   * so a static (or unchanged) SVG can skip the expensive raster +
   * GPU upload and just redraw the cached texture. Big win for the
   * common case where an SVG sits on screen after its path-draw
   * animation has settled at progress=1.
   *
   * undefined when the cache entry was just created (forces first
   * raster pass).
   */
  lastSignature?: SvgRasterSignature;
}

export interface SvgRasterSignature {
  /** Resolved trim window per path: flat [start, end, offset] triples. */
  trims: number[];
  /** Resolved d-string per path (morphing makes these time-varying). */
  ds: string[];
  /** Reference to element.paths array — changes only on source edits. */
  pathsRef: unknown;
  /** Reference to element.gradients — same. */
  gradientsRef: unknown;
  /** Raster canvas dimensions used. Changes if displayed size shifts. */
  rasterW: number;
  rasterH: number;
}

export interface MaskedTextAsset {
  canvas: OffscreenCanvas;
  ctx: OffscreenCanvasRenderingContext2D;
  texture: Texture;
}

/** Parsed .cube LUT, packed as an N²×N 2D atlas texture (§4.7 `lut`). */
export interface LutAsset {
  texture: Texture;
  /** Lattice size N (LUT_3D_SIZE). */
  size: number;
}

/** Per-group offscreen layer for `clip: true`, keyed by element id. */
export interface GroupClipTarget {
  target: RenderTarget;
  /** Logical dims the target was allocated at (recreated on change). */
  width: number;
  height: number;
  /**
   * Frame index (RenderContext.frameIndex) this entry was last acquired.
   * Drives frame-boundary LRU eviction of the offscreen-FBO pool: after
   * endFrame(), entries NOT touched this frame are the only eviction
   * candidates, dropped least-recently-touched first to bound peak GPU memory
   * on SwiftShader. Undefined only between create and first stamp.
   */
  lastTouched?: number;
}

/**
 * 4×4 transform matrix (CKP/1.0 §4.4), column-major f64 — see
 * compositor/mat4.ts for the element layout and operations.
 *
 * `aff` marks a pure 2D affine embedded in the 4×4 (trivial z/w rows
 * and columns): affine×affine operations run the exact CKP/1.0 float
 * expressions, keeping 2D documents byte-identical. The flag is load-
 * bearing for that guarantee — never construct a Mat4 with `aff: true`
 * unless the extra slots really are trivial.
 */
export interface Mat4 {
  /** 16 elements, column-major: e[col * 4 + row]. */
  e: number[];
  /** True when the matrix is a 2D affine embedded in 4×4. */
  aff: boolean;
}

export const MAT4_IDENTITY: Mat4 = {
  e: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  aff: true,
};

export interface RenderContext {
  backend: Backend;
  canvas: CanvasDimensions;
  /** Global time in seconds. Used for animation evaluation. */
  time: number;
  /**
   * Total duration of the current source in seconds. Used to resolve
   * `duration: "auto"` and `time: "end"` for elements and animations.
   */
  sourceDuration: number;
  /**
   * Monotonic eviction epoch from the runtime (NOT a 1:1 output-frame count).
   * Stamped onto every acquired groupTargets pool entry so post-endFrame LRU
   * eviction can tell which entries were touched this frame (never evicted)
   * from stale ones. Constant across all motion-blur sub-frame samples of one
   * output frame (makeContext does not bump it).
   */
  frameIndex: number;

  images: AssetCache<ImageAsset>;
  videos: AssetCache<VideoAsset>;
  fontAtlases: AssetCache<FontAtlas>;
  /**
   * Per-element rasterization caches for elements that draw to an
   * OffscreenCanvas each frame and upload to a single texture. Keyed by
   * element.id (or a synthesized key when id is absent).
   */
  svgRasters: AssetCache<SvgRasterAsset>;
  maskedTexts: AssetCache<MaskedTextAsset>;
  /** Offscreen layers for clipped groups. */
  groupTargets: AssetCache<GroupClipTarget>;
  /** Parsed .cube LUT atlases, keyed by source URL. */
  luts: AssetCache<LutAsset>;

  /**
   * Current model matrix. Identity at the root; group elements push their
   * own transform onto this when rendering children, and pop afterwards.
   * Element renderers read this and apply it to their computed positions
   * before emitting draw calls.
   */
  modelMatrix: Mat4;
  /**
   * §4.8 lighting: the cumulative transform WITHOUT the scene camera —
   * identity at the root, group locals multiply in (parallel to
   * modelMatrix). An element's world-space placement for lighting is
   * `worldMatrix · localQuad`; combined with `eye`, that gives the
   * view-dependent specular that sweeps as the camera moves. (modelMatrix
   * bakes in the camera P·V, so it can't be used for world-space shading.)
   */
  worldMatrix: Mat4;
  /** Resolved scene lights at this frame (§4.8). Empty ⇒ unlit. */
  lights: ResolvedLight[];
  /** Camera eye in world space (§4.8); view-vector origin for specular. */
  eye: [number, number, number];
  /** Resolved scene environment (§4.8); reflective materials sample it. Null ⇒ no reflections. */
  environment: ResolvedEnvironment | null;
  /**
   * §4.4.3 2.5D depth sort. When set, sibling draw lists (top-level
   * elements and the children of plain, non-flattened groups) paint
   * back-to-front by depth (eye-space `z`) instead of pure `track`
   * order. `z` orders always — true unless `camera.sort: 'paint'`, or
   * (with no camera) the doc has no depth fields at all, in which case
   * it stays plain track order, byte-identical to a 2D document.
   */
  depthSort: boolean;
  /**
   * Cumulative opacity factor in [0, 1]. Group elements multiply their
   * own opacity into this when rendering children. Element renderers
   * multiply their own opacity by this before computing tints.
   */
  opacityFactor: number;
  /**
   * Time offset applied to children of a group, in seconds. Children's
   * `time` is interpreted relative to this offset (so a child with
   * `time: 0` inside a group at `time: 3` fires at global time 3).
   */
  timeOffset: number;
  /**
   * LOGICAL dimensions of the surface currently receiving draws — the
   * canvas at the root, a group's box while rendering into its
   * clip/mask layers. Filtered elements (blur_radius / brightness /
   * contrast / saturation) allocate their offscreen layers at exactly
   * this size so the 1:1 composite back is exact at any nesting depth.
   */
  surfaceWidth: number;
  surfaceHeight: number;
}
