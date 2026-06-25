// Frame-level scene rendering.
//
// renderSourceFrame iterates the elements in a Source, filters by their
// active time window, and dispatches each to the appropriate element
// renderer. The element renderers call into the Backend.
//
// Animations (named + keyframe) are not yet applied here; that's a
// follow-up. For Phase 2a we render static schema values.

import type { CaptionElement, Element, GroupElement, Keyframe, ParticlesElement, ShapeElement, Source } from '@clipkit/protocol';
import { interpolateKeyframes } from '../animation/keyframes.js';
import type { Backend, BlendMode, StylizeMode, Texture } from '../backend/backend.js';
import { isProgrammableBlend } from '../backend/backend.js';
import { getLogger } from '../logger.js';
import { buildAsciiAtlasCanvas } from './bitfont.js';
import { parseColor } from './color.js';
import type { RGBA } from './color.js';
import { renderCaptionElement } from './element-renderers/caption.js';
import { renderGroupElement } from './element-renderers/group.js';
import { renderImageElement } from './element-renderers/image.js';
import { renderParticlesElement } from './element-renderers/particles.js';
import { renderShapeElement } from './element-renderers/shape.js';
import { renderPathShape } from './element-renderers/svg.js';
import { renderTextElement } from './element-renderers/text.js';
import { renderVideoElement } from './element-renderers/video.js';
import { applyAnimation, applyAspectRatio, depthOrder, resolve3D, resolveScalePair } from './resolve.js';
import { applyModelTransform, mat4Multiply } from './mat4.js';
import { resolveAnchor, resolveLength } from './unit.js';
import { anchorToCenter, quadMatrix3D } from './transform.js';
import type { GroupClipTarget, RenderContext } from './render-context.js';

/**
 * Render one frame of the source at the given time.
 * Caller is responsible for backend.beginFrame() / endFrame() — this lets
 * the runtime use the same scene-render code for preview and export
 * without worrying about who controls the frame lifecycle.
 */
export function renderSourceFrame(source: Source, ctx: RenderContext): void {
  const sourceDuration = typeof source.duration === 'number' ? source.duration : Infinity;
  // Attach the dispatch on the context so the group renderer (which
  // can't import this file without a cycle) can recurse into children.
  (ctx as RenderContext & { _dispatch?: typeof dispatchElement })._dispatch = dispatchElement;

  // Draw order: descending `layer` so the HIGHEST layer draws first
  // (farthest back) and layer 1 draws last (on top) — the After Effects
  // model. Array.prototype.sort is stable, so any elements that share a
  // layer keep definition order. Then (§4.4.3) the list is re-ordered
  // back-to-front by depth (`z`); equal depths keep this layer order.
  // With all z = 0 this is pure layer order.
  let ordered = [...source.elements].sort((a, b) => layerOf(b) - layerOf(a));
  if (ctx.depthSort) ordered = depthOrder(ordered, ctx);

  for (const element of ordered) {
    if (element.visible === false) continue;
    if (!isActiveAt(element, ctx.time, sourceDuration)) continue;

    try {
      dispatchElement(element, ctx);
    } catch (err) {
      // One bad element shouldn't break the rest of the frame.
      // eslint-disable-next-line no-console
      console.error('[clipkit] Element render failed:', element.type, element.id, err);
    }
  }
}

function layerOf(el: Element): number {
  // `layer` is required + validated; this fallback only guards malformed
  // live state. Missing → far back (drawn first) under the descending
  // sort, matching the old "missing track = back" behavior.
  if (typeof el.layer === 'number' && Number.isFinite(el.layer)) return el.layer;
  return Number.MAX_SAFE_INTEGER;
}

function dispatchElement(element: Element, ctx: RenderContext): void {
  // Filters (blur_radius / brightness / contrast / saturation) and
  // stylize effects (§4.7) wrap the element type-agnostically: render
  // the element — subtree included — into a transparent surface-sized
  // layer, then run the pass chain (blur → color ops → effects in
  // array order), compositing the last pass back onto the surface.
  // Cheap fast path: most elements have neither.
  // Piecewise blend modes (overlay/hard-light/soft-light) also need
  // the element isolated to a layer and composited against a backdrop
  // snapshot — same layer path as filters/effects.
  const progBlend = isProgrammableBlend(element.blend_mode);
  if (hasFilterFields(element) || (element.effects && element.effects.length > 0) || progBlend) {
    const filter = resolveFilter(element, ctx);
    const effects = resolveEffects(element, ctx);
    if (filter || effects.length > 0 || progBlend) {
      renderLayeredElement(element, ctx, filter, effects);
      return;
    }
  }
  renderElementByType(element, ctx);
}

const FILTER_PROPS = ['blur_radius', 'brightness', 'contrast', 'saturation', 'hue_rotate'] as const;

function hasFilterFields(element: Element): boolean {
  for (const prop of FILTER_PROPS) {
    if (element[prop] !== undefined) return true;
  }
  const kfs = element.keyframe_animations;
  if (kfs) {
    for (const kf of kfs) {
      if ((FILTER_PROPS as readonly string[]).includes(kf.property)) return true;
    }
  }
  return false;
}

interface ResolvedFilter {
  blur: number;
  brightness: number;
  contrast: number;
  saturation: number;
  /** Hue rotation in degrees (SVG hueRotate matrix). */
  hueRotate: number;
}

function resolveFilter(element: Element, ctx: RenderContext): ResolvedFilter | null {
  const blur = Math.max(0, resolveFilterValue(element, 'blur_radius', 0, ctx));
  const brightness = Math.max(0, resolveFilterValue(element, 'brightness', 1, ctx));
  const contrast = Math.max(0, resolveFilterValue(element, 'contrast', 1, ctx));
  const saturation = Math.max(0, resolveFilterValue(element, 'saturation', 1, ctx));
  const hueRotate = resolveFilterValue(element, 'hue_rotate', 0, ctx);
  if (blur === 0 && brightness === 1 && contrast === 1 && saturation === 1 && hueRotate === 0) return null;
  return { blur, brightness, contrast, saturation, hueRotate };
}

/** number | Keyframe[] field, overlaid by keyframe_animations / presets. */
function resolveFilterValue(
  element: Element,
  property: (typeof FILTER_PROPS)[number],
  fallback: number,
  ctx: RenderContext,
): number {
  const raw = element[property];
  let staticValue = fallback;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    staticValue = raw;
  } else if (Array.isArray(raw)) {
    const elementStart = ctx.timeOffset + numberOrZero(element.time);
    staticValue = interpolateKeyframes(raw as Keyframe[], ctx.time - elementStart);
  }
  return applyAnimation(element, property, staticValue, ctx);
}

type ResolvedEffect =
  | {
      kind: 'stylize';
      mode: StylizeMode;
      p0: number;
      p1?: number;
      /** Premultiplied effect color (layer styles). */
      tint?: RGBA;
      /** σ for the ladder-blurred aux layer (drop_shadow / glow). */
      auxBlur?: number;
      /** Pre-built LUT atlas texture ('lut'). */
      lutTex?: Texture;
    }
  | {
      kind: 'glass';
      blur: number;
      refract: number;       // reference dial (≈0..1)
      chroma: number;        // reference dial
      edgeHL: number;
      specular: number;
      fresnel: number;
      saturation: number;    // −1..1, 0 = unchanged
      zRadius: number;
      bevelMode: number;     // 0 pill, 1 dome
      shadowAlpha: number;
      tint: RGBA;
    };

function resolveEffects(element: Element, ctx: RenderContext): ResolvedEffect[] {
  const list = element.effects;
  if (!list || list.length === 0) return [];
  const elementStart = ctx.timeOffset + numberOrZero(element.time);
  const localTime = ctx.time - elementStart;
  const param = (raw: unknown, fallback: number): number => {
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    if (Array.isArray(raw)) return interpolateKeyframes(raw as Keyframe[], localTime);
    return fallback;
  };
  const out: ResolvedEffect[] = [];
  for (const fx of list) {
    switch (fx.type) {
      case 'pixelate':
        out.push({ kind: 'stylize', mode: 'pixelate', p0: Math.max(1, param(fx.cell_size, 8)) });
        break;
      case 'dither':
        out.push({
          kind: 'stylize', mode: 'dither',
          p0: Math.max(2, param(fx.levels, 4)),
          p1: Math.max(1, param(fx.pixel_size, 2)), // Bayer cell, logical px
        });
        break;
      case 'halftone':
        out.push({ kind: 'stylize', mode: 'halftone', p0: Math.max(2, param(fx.cell_size, 8)), p1: param(fx.angle, 45) });
        break;
      case 'ascii':
        out.push({ kind: 'stylize', mode: 'ascii', p0: Math.max(4, param(fx.cell_size, 12)) });
        break;
      case 'glow': {
        const c = parseColor(typeof fx.color === 'string' ? fx.color : '#FFFFFF');
        out.push({
          kind: 'stylize', mode: 'glow',
          p0: Math.max(0, param(fx.intensity, 1)),
          auxBlur: Math.max(1, param(fx.radius, 20)),
          tint: [c[0] * c[3], c[1] * c[3], c[2] * c[3], c[3]],
        });
        break;
      }
      case 'drop_shadow': {
        const c = parseColor(typeof fx.color === 'string' ? fx.color : '#000000');
        const op = Math.max(0, Math.min(1, param(fx.opacity, 0.6))) * c[3];
        out.push({
          kind: 'stylize', mode: 'drop_shadow',
          p0: param(fx.offset_x, 0),
          p1: param(fx.offset_y, 12),
          auxBlur: Math.max(0.5, param(fx.blur, 18)),
          tint: [c[0] * op, c[1] * op, c[2] * op, op],
        });
        break;
      }
      case 'stroke': {
        const c = parseColor(typeof fx.color === 'string' ? fx.color : '#FFFFFF');
        out.push({
          kind: 'stylize', mode: 'stroke',
          p0: Math.max(1, param(fx.width, 4)),
          tint: [c[0] * c[3], c[1] * c[3], c[2] * c[3], c[3]],
        });
        break;
      }
      case 'chroma_key': {
        // tint carries the STRAIGHT key color; alpha = spill strength.
        const c = parseColor(typeof fx.color === 'string' ? fx.color : '#00FF00');
        out.push({
          kind: 'stylize', mode: 'chroma_key',
          p0: Math.max(0, param(fx.tolerance, 0.18)),
          p1: Math.max(0, param(fx.softness, 0.1)),
          tint: [c[0], c[1], c[2], Math.max(0, Math.min(1, param(fx.spill, 0.5)))],
        });
        break;
      }
      case 'luma_key':
        out.push({
          kind: 'stylize', mode: 'luma_key',
          p0: Math.max(0, Math.min(1, param(fx.threshold, 0.5))),
          p1: Math.max(0, param(fx.softness, 0.1)),
          tint: [fx.invert === true ? 1 : 0, 0, 0, 0],
        });
        break;
      case 'levels': {
        const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
        out.push({
          kind: 'stylize', mode: 'levels',
          p0: Math.max(0.01, param(fx.gamma, 1)),
          tint: [
            clamp01(param(fx.in_black, 0)), clamp01(param(fx.in_white, 1)),
            clamp01(param(fx.out_black, 0)), clamp01(param(fx.out_white, 1)),
          ],
        });
        break;
      }
      case 'lut': {
        const url = typeof fx.source === 'string' ? fx.source : '';
        const asset = url ? ctx.luts.get(url) : undefined;
        if (!asset) {
          getLogger().warn(`lut not loaded — pass skipped: ${url}`);
          break;
        }
        out.push({
          kind: 'stylize', mode: 'lut',
          p0: asset.size,
          p1: Math.max(0, Math.min(1, param(fx.intensity, 1))),
          lutTex: asset.texture,
        });
        break;
      }
      case 'fractal_noise': {
        // Offsets pass pre-divided by scale (noise units) so the shader
        // needs no pixel-ratio knowledge — see backend.ts param table.
        const scale = Math.max(0.001, param(fx.scale, 100));
        out.push({
          kind: 'stylize', mode: 'fractal_noise',
          p0: scale,
          p1: param(fx.evolution, 0),
          tint: [
            param(fx.offset_x, 0) / scale,
            param(fx.offset_y, 0) / scale,
            Math.max(1, Math.min(8, Math.round(typeof fx.octaves === 'number' ? fx.octaves : 4))),
            Math.max(0, Math.round(typeof fx.seed === 'number' ? fx.seed : 0)),
          ],
        });
        break;
      }
      case 'turbulent_displace':
        out.push({
          kind: 'stylize', mode: 'turbulent_displace',
          p0: Math.max(0, param(fx.amount, 16)),
          p1: Math.max(1, param(fx.scale, 120)),
          tint: [
            param(fx.evolution, 0),
            Math.max(1, Math.min(8, Math.round(typeof fx.octaves === 'number' ? fx.octaves : 2))),
            Math.max(0, Math.round(typeof fx.seed === 'number' ? fx.seed : 0)),
            0,
          ],
        });
        break;
      case 'glass': {
        // Defaults track the liquidglass reference: CLEAR glass
        // (blur 0), refraction 0.69, chroma 0.05, edge highlight 0.05
        // + full fresnel, shadow 0.3. Our dials map onto theirs:
        // refraction is ÷30 (their unit ≈ 30px of bend), and
        // edge_highlight scales the whole stock light rig (0.35 ≡
        // exactly the reference's default mix).
        const eh = Math.max(0, param(fx.edge_highlight, 0.35));
        out.push({
          kind: 'glass',
          blur: Math.max(0, param(fx.blur_radius, 0)),
          refract: Math.abs(param(fx.refraction, 21)) / 30,
          chroma: Math.max(0, param(fx.dispersion, 0.05)),
          edgeHL: eh * (0.05 / 0.35),
          specular: 0,
          fresnel: eh * (1 / 0.35),
          saturation: Math.max(0, param(fx.backdrop_saturation, 1)) - 1,
          zRadius: Math.max(1, param(fx.edge_width, 40)),
          bevelMode: fx.mode === 'dome' ? 1 : 0,
          shadowAlpha: Math.max(0, param(fx.shadow, 0.3)),
          tint: typeof fx.tint === 'string' ? parseColor(fx.tint) : [0, 0, 0, 0],
        });
        break;
      }
      default:
        // Future effect types: skip with a warning, keep the element.
        getLogger().warn(`unknown effect type — skipped: ${String((fx as { type?: unknown }).type)}`);
    }
  }
  return out;
}

/** Per-backend ascii glyph atlas (built once from the embedded bitfont). */
const asciiAtlases = new WeakMap<Backend, Texture>();

function asciiAtlasFor(backend: Backend): Texture {
  let atlas = asciiAtlases.get(backend);
  if (!atlas) {
    atlas = backend.createTexture(buildAsciiAtlasCanvas());
    asciiAtlases.set(backend, atlas);
  }
  return atlas;
}

function renderLayeredElement(
  element: Element,
  ctx: RenderContext,
  filter: ResolvedFilter | null,
  effects: ResolvedEffect[],
): void {
  const { backend } = ctx;
  const sw = ctx.surfaceWidth;
  const sh = ctx.surfaceHeight;
  const keyBase = element.id ?? '__fx__';

  // Render the element with its normal transform into a transparent
  // layer. Its own filter/effect fields are stripped from the inner
  // pass (the chain applies them) and so is blend_mode — blending
  // against an empty layer would lose the backdrop, so the element's
  // blend applies at the final composite instead.
  const inner = {
    ...element,
    blur_radius: undefined,
    brightness: undefined,
    contrast: undefined,
    saturation: undefined,
    effects: undefined,
    blend_mode: undefined,
  } as Element;
  // Glass (§4.7) AND piecewise blend modes (§4.5) read the BACKDROP —
  // snapshot the surface now, while it holds exactly the pixels drawn
  // before this element, and before any scratch targets are pushed.
  const progMode = isProgrammableBlend(element.blend_mode) ? element.blend_mode : undefined;
  let backdropSnap: GroupClipTarget | null = null;
  let backdropFlipY = false;
  if (progMode || effects.some((fx) => fx.kind === 'glass')) {
    backdropSnap = acquireFilterTarget(ctx, `${keyBase}::bd`, sw, sh);
    backdropFlipY = backend.copySurfaceTo(backdropSnap.target).flippedY;
  }

  const layerA = acquireFilterTarget(ctx, `${keyBase}::fx`, sw, sh);
  backend.pushTarget(layerA.target, [0, 0, 0, 0]);
  // try/finally so a throw mid-effect-chain can't leave the surface stack
  // unbalanced — otherwise every later element in the frame draws into an
  // orphaned offscreen FBO and the whole frame blackens (EXPORT-FLOW-ISSUES §4A).
  try {
    renderElementByType(inner, ctx);
  } finally {
    backend.popTarget();
  }

  const cx = sw / 2;
  const cy = sh / 2;

  // Build the pass chain: blur+color ops → effects in array order.
  // Each pass reads `src` and draws — into a ping-pong target for
  // intermediate passes, onto the surface (with the element's blend
  // mode) for the last. Blurs run through blurLadder (downsample →
  // dense-tap blur → bilinear upsample at the consuming draw).
  type Pass = (src: Texture, blend: BlendMode | undefined) => void;
  const passes: Pass[] = [];
  if (filter) {
    passes.push((src, blend) => {
      const blurred = filter.blur > 0
        ? blurLadder(ctx, `${keyBase}::blur`, src, filter.blur, sw, sh)
        : src;
      backend.drawFilteredQuad({
        cx, cy, width: sw, height: sh, texture: blurred,
        blurRadius: 0, blurDir: [0, 1],
        brightness: filter.brightness, contrast: filter.contrast,
        saturation: filter.saturation, hueRotate: filter.hueRotate, blend,
      });
    });
  }
  for (const fx of effects) {
    if (fx.kind === 'stylize') {
      passes.push((src, blend) => backend.drawStylizedQuad({
        cx, cy, width: sw, height: sh, texture: src,
        mode: fx.mode, p0: fx.p0, p1: fx.p1,
        aux: fx.mode === 'ascii'
          ? asciiAtlasFor(backend)
          : fx.lutTex
            ? fx.lutTex
            : fx.auxBlur
              ? blurLadder(ctx, `${keyBase}::style`, src, fx.auxBlur, sw, sh)
              : undefined,
        tint: fx.tint,
        blend,
      }));
    } else {
      // Glass (§4.7) — analytic: the pane geometry comes from the shape
      // element itself (rounded-rect SDF in-shader, the liquidglass
      // reference model). Non-shape elements skip the effect — deriving
      // lens geometry from rasterized alpha produces rim artifacts.
      passes.push((src, blend) => {
        if (element.type !== 'shape') {
          getLogger().warn('glass applies to shape elements — effect skipped');
          backend.drawTexturedQuad({
            cx, cy, width: sw, height: sh, rotation: 0, texture: src, blend,
          });
          return;
        }
        const snap = backdropSnap!;
        const backdropTex = fx.blur > 0
          ? blurLadder(ctx, `${keyBase}::gfrost`, snap.target.texture, fx.blur, sw, sh)
          : snap.target.texture;
        const pane = resolvePaneBox(element as ShapeElement, ctx);
        backend.drawGlassQuad({
          cx, cy, width: sw, height: sh,
          backdrop: backdropTex,
          backdropSharp: snap.target.texture,
          backdropFlipY,
          paneCx: pane.cx, paneCy: pane.cy,
          paneHalfW: pane.width / 2, paneHalfH: pane.height / 2,
          cornerRadius: pane.radius, rotation: pane.rotation,
          paneHomography: pane.paneH,
          zRadius: fx.zRadius,
          refract: fx.refract, chroma: fx.chroma,
          edgeHighlight: fx.edgeHL, specular: fx.specular, fresnel: fx.fresnel,
          saturation: fx.saturation, tint: fx.tint, alpha: pane.alpha,
          bevelMode: fx.bevelMode,
          shadowAlpha: fx.shadowAlpha, shadowSpread: 10, shadowOffY: 1,
          blend,
        });
      });
    }
  }

  let src: Texture = layerA.target.texture;
  let useA = false; // layerA holds the content; first intermediate goes to B

  // Piecewise blend: every pass renders into an offscreen target (never
  // straight to the surface), then the final texture is composited
  // against the backdrop snapshot via drawBackdropBlend. With no
  // filter/effect passes, the isolated layer itself is the result.
  if (progMode) {
    for (let i = 0; i < passes.length; i++) {
      const dst = useA ? layerA : acquireFilterTarget(ctx, `${keyBase}::fx-scratch`, sw, sh);
      backend.pushTarget(dst.target, [0, 0, 0, 0]);
      try {
        passes[i]!(src, undefined);
      } finally {
        backend.popTarget();
      }
      src = dst.target.texture;
      useA = !useA;
    }
    backend.drawBackdropBlend({
      src,
      backdrop: backdropSnap!.target.texture,
      mode: progMode,
      width: sw,
      height: sh,
      backdropFlipY,
    });
    return;
  }

  for (let i = 0; i < passes.length; i++) {
    const last = i === passes.length - 1;
    if (last) {
      passes[i]!(src, element.blend_mode);
    } else {
      const dst = useA ? layerA : acquireFilterTarget(ctx, `${keyBase}::fx-scratch`, sw, sh);
      backend.pushTarget(dst.target, [0, 0, 0, 0]);
      try {
        passes[i]!(src, undefined);
      } finally {
        backend.popTarget();
      }
      src = dst.target.texture;
      useA = !useA;
    }
  }
}

/**
 * Gaussian blur via a downsample ladder (normative — PROTOCOL.md §4.6).
 *
 * The 25-tap kernel spaces its taps σ/4 apart; at full resolution a
 * large σ means taps 4+ px apart, and blurring a hard edge with taps
 * that sparse leaves a faint staircase — H × V staircases cross into a
 * visible grid of σ/4-sized squares (Ian spotted it in the glass
 * frost). So: halve the image (each halving is a clean bilinear 2×2
 * average) until the residual σ/f ≤ 4 — taps ≤ 1px apart — blur there,
 * and let the consuming draw's bilinear sampling upsample smoothly.
 * Also much cheaper: the heavy taps run on 1/f² of the pixels.
 *
 * Returns a texture LOGICALLY sized sw/f × sh/f; consumers sample by
 * normalized UV so the size difference is invisible to them.
 */
function blurLadder(
  ctx: RenderContext,
  keyPrefix: string,
  src: Texture,
  sigma: number,
  sw: number,
  sh: number,
): Texture {
  const { backend } = ctx;
  if (sigma <= 0) return src;
  let f = 1;
  while (sigma / f > 4 && f < 16) f *= 2;

  let cur = src;
  let w = sw;
  let h = sh;
  for (let level = 1; level < f; level *= 2) {
    const nw = Math.max(1, Math.round(w / 2));
    const nh = Math.max(1, Math.round(h / 2));
    const t = acquireFilterTarget(ctx, `${keyPrefix}::ds${level}`, nw, nh);
    backend.pushTarget(t.target, [0, 0, 0, 0]);
    try {
      backend.drawTexturedQuad({
        cx: nw / 2, cy: nh / 2, width: nw, height: nh, rotation: 0, texture: cur,
      });
    } finally {
      backend.popTarget();
    }
    cur = t.target.texture;
    w = nw;
    h = nh;
  }

  const s = sigma / f;
  const th = acquireFilterTarget(ctx, `${keyPrefix}::bh`, w, h);
  backend.pushTarget(th.target, [0, 0, 0, 0]);
  try {
    backend.drawFilteredQuad({
      cx: w / 2, cy: h / 2, width: w, height: h, texture: cur,
      blurRadius: s, blurDir: [1, 0], brightness: 1, contrast: 1, saturation: 1,
    });
  } finally {
    backend.popTarget();
  }
  const tv = acquireFilterTarget(ctx, `${keyPrefix}::bv`, w, h);
  backend.pushTarget(tv.target, [0, 0, 0, 0]);
  try {
    backend.drawFilteredQuad({
      cx: w / 2, cy: h / 2, width: w, height: h, texture: th.target.texture,
      blurRadius: s, blurDir: [0, 1], brightness: 1, contrast: 1, saturation: 1,
    });
  } finally {
    backend.popTarget();
  }
  return tv.target.texture;
}

/**
 * The glass pane's box in SURFACE coordinates — the same resolution
 * path the shape renderer uses (animations, anchors, aspect ratio,
 * scale pair, group model transform), so the SDF in the glass shader
 * lands exactly on the shape's footprint.
 */
function resolvePaneBox(element: ShapeElement, ctx: RenderContext): {
  cx: number; cy: number; width: number; height: number;
  rotation: number; radius: number; alpha: number;
  /** CKP/1.0 glass under 3D: pane-local→surface homography (§4.7). */
  paneH?: number[];
} {
  const { canvas } = ctx;
  const x = applyAnimation(element, 'x', resolveLength(element.x as never, canvas.width, canvas), ctx);
  const y = applyAnimation(element, 'y', resolveLength(element.y as never, canvas.height, canvas), ctx);
  const { sx, sy } = resolveScalePair(element, ctx);
  const box = applyAspectRatio(
    element,
    applyAnimation(element, 'width', resolveLength(element.width as never, canvas.width, canvas, 100), ctx),
    applyAnimation(element, 'height', resolveLength(element.height as never, canvas.height, canvas, 100), ctx),
  );
  const width = sx * box.width;
  const height = sy * box.height;
  const rotation = applyAnimation(
    element, 'rotation',
    numberOrZero(element.rotation ?? (element as { z_rotation?: unknown }).z_rotation), ctx,
  );
  const opacity01 = applyAnimation(
    element, 'opacity',
    typeof element.opacity === 'number' ? element.opacity : 1, ctx,
  );
  const xA = resolveAnchor(element.x_anchor);
  const yA = resolveAnchor(element.y_anchor);
  const { cx, cy } = anchorToCenter(x, y, width, height, xA, yA);
  const isEllipse =
    String((element.shape ?? 'rectangle') as string).toLowerCase() === 'ellipse';

  // CKP/1.0 glass under 3D (§4.7): own 3D fields or a non-affine chain
  // put the pane on the projective path — pane geometry stays LOCAL and
  // the homography (the plane restriction of the full matrix chain)
  // carries every projection. The shader inverts it per fragment.
  const t3d = resolve3D(element, ctx);
  if (t3d !== null || !ctx.modelMatrix.aff) {
    // quadMatrix3D with w = h = 2 is T(cx,cy,z)·Rz·Ry·Rx·F (unit scale);
    // dropping the local-z row/col and un-flipping Y (pane-local is
    // y-down) leaves the plane's 3×3 homography.
    const m = mat4Multiply(ctx.modelMatrix, {
      e: quadMatrix3D(cx, cy, 2, 2, rotation, 0, 0, t3d?.xRot ?? 0, t3d?.yRot ?? 0, t3d?.z ?? 0),
      aff: false,
    }).e;
    const paneH = [m[0]!, m[1]!, m[3]!, -m[4]!, -m[5]!, -m[7]!, m[12]!, m[13]!, m[15]!];
    const radius = isEllipse ? Math.min(width, height) / 2 : numberOrZero(element.border_radius);
    return {
      cx: 0, cy: 0, width, height, rotation: 0, radius, paneH,
      alpha: Math.max(0, Math.min(1, opacity01 * ctx.opacityFactor)),
    };
  }

  const w = applyModelTransform(
    ctx.modelMatrix, ctx.opacityFactor, cx, cy, rotation, opacity01, width, height,
  );
  // An ellipse renders via the rounded-rect SDF with r = min(half) —
  // a circle when square, a stadium otherwise (documented in §4.7).
  const radius = isEllipse
    ? Math.min(w.width, w.height) / 2
    : numberOrZero(element.border_radius);
  return {
    cx: w.cx, cy: w.cy, width: w.width, height: w.height,
    rotation: w.rotation, radius,
    alpha: Math.max(0, Math.min(1, w.opacity01)),
  };
}

function acquireFilterTarget(
  ctx: RenderContext,
  key: string,
  width: number,
  height: number,
): GroupClipTarget {
  let entry = ctx.groupTargets.get(key);
  if (entry && (entry.width !== width || entry.height !== height)) {
    ctx.backend.destroyRenderTarget(entry.target);
    entry = undefined;
  }
  if (!entry) {
    entry = { target: ctx.backend.createRenderTarget(width, height), width, height };
    ctx.groupTargets.set(key, entry);
  }
  // Stamp on EVERY acquire (incl. the reuse path above, where `set` is not
  // called) so frame-boundary LRU eviction sees this entry as touched this frame.
  entry.lastTouched = ctx.frameIndex;
  return entry;
}

function renderElementByType(element: Element, ctx: RenderContext): void {
  switch (element.type) {
    case 'shape':
      // A shape is a primitive (SDF) unless it carries `paths` (vector form).
      if ((element as ShapeElement).paths) renderPathShape(element as ShapeElement, ctx);
      else renderShapeElement(element, ctx);
      return;
    case 'text':
      renderTextElement(element, ctx);
      return;
    case 'image':
      renderImageElement(element, ctx);
      return;
    case 'video':
      renderVideoElement(element, ctx);
      return;
    case 'audio':
      // Audio elements don't render to the visual frame. Phase 2b.
      return;
    case 'caption':
      renderCaptionElement(element as CaptionElement, ctx);
      return;
    case 'particles':
      renderParticlesElement(element as ParticlesElement, ctx);
      return;
    case 'group':
      renderGroupElement(element as GroupElement, ctx);
      return;
  }
}

function isActiveAt(element: Element, time: number, sourceDuration: number): boolean {
  const start = numberOrZero(element.time);
  const elDur = parseDuration(element.duration, sourceDuration - start);
  const end = start + elDur;
  return time >= start && time <= end;
}

function numberOrZero(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function parseDuration(v: unknown, fallback: number): number {
  if (v === 'auto' || v === 'end' || v == null) return fallback;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}
