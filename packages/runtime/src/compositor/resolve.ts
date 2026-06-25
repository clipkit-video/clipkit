// Animation-aware property resolution.
//
// Each element renderer first resolves the static schema value (e.g.
// `element.x → 100 pixels`), then calls applyAnimation() to overlay any
// active keyframe animation or named-preset tween for that property.
//
// Precedence (highest wins):
//   1. Keyframe animation matching the property
//   2. Named-preset tween (relative = added to static, absolute = replaces)
//   3. Static schema value (fallback)

import type { BaseElement, Element } from '@clipkit/protocol';
import {
  foldKeyframeTime,
  interpolateColorKeyframes,
  interpolateKeyframes,
  isColorKeyframes,
} from '../animation/keyframes.js';
import { noise1d } from '../animation/noise1d.js';
import { isExpr, evalExpr } from '../animation/expr.js';
import { resolveMotionPath } from '../animation/motion-path.js';
import { compileAnimation } from '../animation/presets.js';
import { applyEasing } from '../animation/easings.js';
import { rgbaToCss } from './color.js';
import { resolveLength } from './unit.js';
import type { RenderContext } from './render-context.js';

/**
 * Apply animations to a property's static value. Returns the static value
 * unchanged if no animation targets this property at the current time.
 */
export function applyAnimation(
  element: BaseElement,
  property: string,
  staticValue: number,
  ctx: RenderContext,
): number {
  // Group children's `time` is relative to the group's start —
  // ctx.timeOffset carries that base (0 at the root).
  const elementStart = ctx.timeOffset + numberOrZero(element.time);
  const elementDuration = parseDuration(
    element.duration,
    ctx.sourceDuration - elementStart,
  );
  // Clamp to the element's lifespan. The active-window check computes
  // the element's end as start + duration while this computes
  // time - start; at exact frame boundaries (the exporter samples
  // N/framerate precisely) float asymmetry can make localTime land a
  // hair PAST elementDuration while the element is still considered
  // active — skipping every end-anchored tween for one frame and
  // flashing the static value (the "fade-out flickers back" export
  // bug). An element's local time can't exceed its own duration.
  const localTime = Math.min(ctx.time - elementStart, elementDuration);

  // 0. A spatial motion path (§6.7) drives x and y — and z on 3D
  //    paths — and, with auto_orient, adds the xy travel direction to
  //    rotation (in-plane only; dz never orients).
  if (property === 'x' || property === 'y' || property === 'z' || property === 'rotation') {
    const path = resolveMotionPath(element, localTime);
    if (path) {
      if (property === 'x') return path.x;
      if (property === 'y') return path.y;
      if (property === 'z' && path.z !== null) return path.z;
      if (property === 'rotation' && path.autoOrient) {
        // Resolve the element's own rotation normally, then orient.
        const base = scalarAnimation(element, 'rotation', staticValue, localTime, elementDuration);
        return base + path.angle;
      }
    }
  }

  return scalarAnimation(element, property, staticValue, localTime, elementDuration);
}

/** The scalar resolution chain (expression → keyframes → presets → static). */
function scalarAnimation(
  element: BaseElement,
  property: string,
  staticValue: number,
  localTime: number,
  elementDuration: number,
): number {
  // 0. A Tier-A expression on the property (§Expressions) — a pure function of
  //    `t`/`i`/`n`/`dur`/`value` — overrides everything. `z_rotation` shares the
  //    `rotation` slot.
  const raw = (element as Record<string, unknown>)[property]
    ?? (property === 'rotation' ? (element as { z_rotation?: unknown }).z_rotation : undefined);
  if (isExpr(raw)) {
    return evalExpr(raw, { t: localTime, dur: elementDuration, i: 0, n: 1, value: staticValue });
  }

  // 1. Keyframe animations override the static value. `z_rotation` is
  //    the same slot as `rotation` (§4.4) — accept either spelling.
  const keyframeAnims = element.keyframe_animations;
  if (keyframeAnims) {
    for (const kf of keyframeAnims) {
      if (kf.property === property || (property === 'rotation' && kf.property === 'z_rotation')) {
        return interpolateKeyframes(
          kf.keyframes,
          foldKeyframeTime(kf.keyframes, kf.loop, localTime),
        );
      }
    }
  }

  // 2. Named animations apply tweens. Relative tweens add to static,
  //    absolute tweens replace.
  const namedAnims = element.animations;
  if (namedAnims && namedAnims.length > 0) {
    let result = staticValue;
    let modified = false;
    for (const anim of namedAnims) {
      const tweens = compileAnimation(anim, elementDuration);
      for (const tween of tweens) {
        if (tween.property !== property) continue;
        const tweenEnd = tween.startTime + tween.duration;
        if (localTime < tween.startTime) {
          // Before the window: fill-backward tweens (entrance presets)
          // hold their `from` value so a delayed entrance stays hidden at
          // frame 0; everything else releases back to the static value.
          if (!tween.fillBackwards) continue;
          result = tween.relative ? staticValue + tween.from : tween.from;
          modified = true;
          continue;
        }
        // Past the window: fill-forward tweens keep applying their end
        // value; everything else releases back to the static value.
        if (localTime > tweenEnd && !tween.hold) continue;

        const span = tween.duration > 0 ? Math.min(1, (localTime - tween.startTime) / tween.duration) : 1;
        const easedT = applyEasing(tween.easing, span);
        let tweenValue = tween.from + (tween.to - tween.from) * easedT;
        if (tween.oscillate) {
          // from/to define the amplitude envelope; the value oscillates
          // around 0 so oscillating tweens are inherently relative.
          const ot = localTime - tween.startTime;
          tweenValue *= tween.oscillate.noise
            ? (noise1d(tween.oscillate.frequency * ot, tween.oscillate.noise.seed) - 0.5) * 2
            : Math.sin(
                2 * Math.PI * tween.oscillate.frequency * ot + (tween.oscillate.phase ?? 0),
              );
        }
        result = tween.relative ? staticValue + tweenValue : tweenValue;
        modified = true;
      }
    }
    if (modified) return result;
  }

  return staticValue;
}

/**
 * Resolve the element's CKP/1.0 3D transform (§4.4.1) at the current
 * time. Returns null when the element carries none of the 3D fields —
 * the renderer's signal to stay on the byte-stable 2D fast path.
 * `z_rotation` is NOT 3D (it's the in-plane `rotation` alias, resolved
 * through the normal rotation slot).
 */
export function resolve3D(
  element: BaseElement,
  ctx: RenderContext,
): { xRot: number; yRot: number; z: number } | null {
  const el = element as BaseElement & {
    x_rotation?: unknown;
    y_rotation?: unknown;
    z?: unknown;
  };
  const has =
    el.x_rotation !== undefined || el.y_rotation !== undefined || el.z !== undefined ||
    element.keyframe_animations?.some(
      (k) =>
        k.property === 'x_rotation' || k.property === 'y_rotation' || k.property === 'z' ||
        // A 3D position path (§6.7) drives z, so it puts the element
        // on the matrix path even with no 3D fields authored.
        (k.property === 'position' &&
          k.keyframes.some((kf) => Array.isArray(kf.value) && kf.value.length === 3)),
    );
  if (!has) return null;
  return {
    xRot: applyAnimation(element, 'x_rotation', staticNumber(el.x_rotation), ctx),
    yRot: applyAnimation(element, 'y_rotation', staticNumber(el.y_rotation), ctx),
    z: applyAnimation(element, 'z', staticNumber(el.z), ctx),
  };
}

function staticNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * §4.4.3 depth key: the EYE-SPACE z of the element's anchor under the
 * current model matrix. The perspective matrix P leaves the z output row
 * untouched (its row 2 is [0,0,1,0]), so the z component of `M·anchor`
 * is the eye-space depth whether or not a camera/perspective is present —
 * with no camera it is simply `element.z`. LARGER z = nearer the viewer.
 * Resolved with the same `applyAnimation` / `resolve3D` path the renderer
 * uses, so the sort matches what's drawn.
 */
export function cameraDepthZ(el: Element, ctx: RenderContext): number {
  const m = ctx.modelMatrix.e;
  const x = applyAnimation(el, 'x', resolveLength(el.x as never, ctx.canvas.width, ctx.canvas), ctx);
  const y = applyAnimation(el, 'y', resolveLength(el.y as never, ctx.canvas.height, ctx.canvas), ctx);
  const z = resolve3D(el, ctx)?.z ?? 0;
  return m[2] * x + m[6] * y + m[10] * z + m[14];
}

/**
 * Stable back-to-front order by depth (farthest painted first → nearest
 * on top). `elements` MUST already be in `track` order; equal depths fall
 * back to that order (the explicit index tiebreak keeps it stable across
 * engines). Sorting by ascending eye-space z puts the farthest (smallest
 * z) first. Used by the scene and plain-group child walkers when
 * `ctx.depthSort` is set. With all z equal (e.g. a 2D doc) this is a
 * stable no-op → pure track order.
 */
export function depthOrder(elements: readonly Element[], ctx: RenderContext): Element[] {
  return elements
    .map((el, i) => ({ el, i, z: cameraDepthZ(el, ctx) }))
    .sort((a, b) => a.z - b.z || a.i - b.i)
    .map((o) => o.el);
}

/**
 * Resolve the element's effective per-axis scale at the current time:
 * uniform `scale` (factor, default 1) multiplied with per-axis
 * `x_scale` / `y_scale` (factor, or "N%" string). All three are
 * animatable — via keyframe_animations or preset tweens (scale-in,
 * squash, …).
 *
 * Renderers multiply their resolved width/height (and, for glyph-based
 * renderers, glyph offsets around the pivot) by the returned factors.
 */
export function resolveScalePair(
  element: BaseElement,
  ctx: RenderContext,
): { sx: number; sy: number } {
  const uniform = applyAnimation(element, 'scale', scaleOr(element.scale, 1), ctx);
  const xs = applyAnimation(element, 'x_scale', scaleOr(element.x_scale, 1), ctx);
  const ys = applyAnimation(element, 'y_scale', scaleOr(element.y_scale, 1), ctx);
  return { sx: uniform * xs, sy: uniform * ys };
}

/**
 * Derive the missing box dimension from `aspect_ratio` (width/height).
 * Only applies when EXACTLY ONE of width/height is authored — both or
 * neither leaves the resolved values untouched.
 */
export function applyAspectRatio(
  element: BaseElement,
  width: number,
  height: number,
): { width: number; height: number } {
  const ar = element.aspect_ratio;
  if (typeof ar !== 'number' || !(ar > 0)) return { width, height };
  if (element.width !== undefined && element.height === undefined) {
    return { width, height: width / ar };
  }
  if (element.height !== undefined && element.width === undefined) {
    return { width: height * ar, height };
  }
  return { width, height };
}

/**
 * Resolve a color property (fill_color, stroke_color, …) at the current
 * time. When a keyframe_animation targets the property with color-string
 * values, the colors are lerped componentwise in straight-alpha RGB
 * space and returned as a CSS rgba() string — so renderers consume the
 * result through the exact same string paths as static schema values.
 * Falls back to the static color otherwise.
 */
export function resolveColorProperty(
  element: BaseElement,
  property: string,
  staticColor: string | undefined,
  ctx: RenderContext,
): string | undefined {
  const keyframeAnims = element.keyframe_animations;
  if (keyframeAnims) {
    for (const kf of keyframeAnims) {
      if (kf.property === property && isColorKeyframes(kf.keyframes)) {
        const elementStart = ctx.timeOffset + numberOrZero(element.time);
        const localTime = foldKeyframeTime(kf.keyframes, kf.loop, ctx.time - elementStart);
        return rgbaToCss(interpolateColorKeyframes(kf.keyframes, localTime));
      }
    }
  }
  return staticColor;
}

/**
 * Resolve the element's shear angles (degrees, CSS skewX/skewY
 * semantics) at the current time. Animatable like any other property.
 */
export function resolveSkewPair(
  element: BaseElement,
  ctx: RenderContext,
): { skewX: number; skewY: number } {
  return {
    skewX: applyAnimation(element, 'x_skew', numberOrZero(element.x_skew), ctx),
    skewY: applyAnimation(element, 'y_skew', numberOrZero(element.y_skew), ctx),
  };
}

/** Parse a scale factor: number as-is, "150%" → 1.5, anything else → fallback. */
function scaleOr(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    if (Number.isFinite(n)) return v.trim().endsWith('%') ? n / 100 : n;
  }
  return fallback;
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
