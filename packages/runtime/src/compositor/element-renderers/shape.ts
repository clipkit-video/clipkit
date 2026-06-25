import type { LinearGradient, RadialGradient, ShapeElement } from '@clipkit/protocol';
import { parseColor, parseColorPremultiplied } from '../color.js';
import { applyModelTransform, quadWorldTransform } from '../mat4.js';
import { resolveAnchor, resolveLength } from '../unit.js';
import { anchorToCenter } from '../transform.js';
import { applyAnimation, applyAspectRatio, resolve3D, resolveColorProperty, resolveScalePair, resolveSkewPair } from '../resolve.js';
import { resolveMaterial } from '../lighting.js';
import { buildLitParams } from './lit.js';
import type { BackendGradient } from '../../backend/backend.js';
import type { RenderContext } from '../render-context.js';

export function renderShapeElement(element: ShapeElement, ctx: RenderContext): void {
  const { canvas, backend } = ctx;

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
  const rotation = applyAnimation(element, 'rotation', numberOr((element.rotation ?? (element as { z_rotation?: unknown }).z_rotation) as never, 0), ctx);
  const { skewX, skewY } = resolveSkewPair(element, ctx);
  const opacity01 = applyAnimation(element, 'opacity', numberOr(element.opacity as never, 1), ctx);
  const xAnchor = resolveAnchor(element.x_anchor);
  const yAnchor = resolveAnchor(element.y_anchor);

  const { cx, cy } = anchorToCenter(x, y, width, height, xAnchor, yAnchor);

  // CKP/1.0 3D (§4.4): own 3D fields, or an un-flattened 3D ancestor,
  // route through the full-matrix hand-off. Everything else stays on
  // the byte-stable 2D decomposition.
  const t3d = resolve3D(element, ctx);
  const matrixPath = t3d !== null || !ctx.modelMatrix.aff;

  // Apply the group transform stack (no-op when not nested in a group).
  // Under the matrix path only opacity01 is meaningful (it is matrix-
  // independent); the spatial fields are superseded by `transform`.
  const w = applyModelTransform(
    ctx.modelMatrix, ctx.opacityFactor,
    cx, cy, rotation, opacity01, width, height,
  );
  const transform = matrixPath
    ? quadWorldTransform(ctx.modelMatrix, cx, cy, width, height, rotation, skewX, skewY, t3d)
    : undefined;

  // Color: parse hex → straight RGBA, multiply alpha by opacity, premultiply.
  // (parseColorPremultiplied premultiplies by the parsed alpha — we apply
  // element-level opacity by multiplying the alpha channel before that.)
  // fill_color is animatable via color-valued keyframe_animations.
  const fillColor = resolveColorProperty(
    element,
    'fill_color',
    typeof element.fill_color === 'string' ? element.fill_color : undefined,
    ctx,
  );
  const straight = parseColorPremultipliedWithOpacity(fillColor, w.opacity01);

  // Border radius is in PIXELS — the backend now does corner SDF in pixel
  // space (so corners stay circular on non-square rects) and clamps to a
  // safe maximum internally. Animatable via keyframe_animations (no keyframes
  // ⇒ applyAnimation returns the static value, so static shapes are unchanged).
  const cornerRadius = applyAnimation(element, 'border_radius', numberOr(element.border_radius, 0), ctx);

  // Primitive kind: rectangle (default) or ellipse. Arbitrary geometry takes
  // the `paths` form and never reaches this SDF renderer.
  const shapeName = (typeof element.shape === 'string' && element.shape) || 'rectangle';
  const isEllipse = shapeName.toLowerCase() === 'ellipse';

  // Parse gradient if present. Hex stops → premultiplied RGBA; angle deg → rad.
  const gradient = element.gradient
    ? compileGradient(element.gradient, w.opacity01)
    : undefined;

  // Stroke (border) — the SDF in SHAPE_FS paints the stroke band
  // directly, so semi-transparent fills no longer let the stroke color
  // bleed through the interior. We just pass through to the backend.
  const strokeColorStr = resolveColorProperty(
    element,
    'stroke_color',
    typeof element.stroke_color === 'string' ? element.stroke_color : undefined,
    ctx,
  ) ?? null;
  const strokeWidth = applyAnimation(element, 'stroke_width', numberOr(element.stroke_width, 0), ctx);
  const strokePremul = strokeColorStr && strokeWidth > 0
    ? parseColorPremultipliedWithOpacity(strokeColorStr, w.opacity01)
    : undefined;

  // Draw the drop shadow (if any) BEFORE the shape so the shape paints
  // over the inside-of-SDF region. Shadow opacity scales with the
  // element's overall opacity so animating the shape's opacity fades
  // the shadow alongside it.
  if (element.shadow && typeof element.shadow.color === 'string') {
    const shadowPremul = parseColorPremultipliedWithOpacity(element.shadow.color, w.opacity01);
    const offsetX = numberOr(element.shadow.offset_x, 0);
    const offsetY = numberOr(element.shadow.offset_y, 0);
    const blur = Math.max(0, numberOr(element.shadow.blur, 0));
    backend.drawShapeShadow({
      cx: w.cx,
      cy: w.cy,
      width: matrixPath ? width : w.width,
      height: matrixPath ? height : w.height,
      rotation: w.rotation,
      skewX,
      skewY,
      // Under 3D the EXPANDED quad foreshortens with the element while
      // the offset translates in the PARENT plane — consistent with 2D,
      // where a rotated shape's shadow offset stays screen-aligned.
      transform: matrixPath
        ? quadWorldTransform(
            ctx.modelMatrix, cx + offsetX, cy + offsetY,
            width + blur * 2, height + blur * 2, rotation, skewX, skewY, t3d,
          )
        : undefined,
      cornerRadius,
      shape: isEllipse ? 'ellipse' : 'rectangle',
      offsetX,
      offsetY,
      blur,
      color: shadowPremul,
    });
  }

  // §4.8 PBR lighting: when the shape carries a material and the scene
  // has lights, build the lit payload (world-space normal + position via
  // the camera-FREE world matrix, straight-alpha albedo). gradient fills
  // aren't lit in Phase 1.
  const material = !gradient ? resolveMaterial(element, ctx.time) : null;
  const opacityFactor = Math.max(0, Math.min(1, w.opacity01));
  const lit = material
    ? buildLitParams(
        ctx,
        quadWorldTransform(ctx.worldMatrix, cx, cy, width, height, rotation, skewX, skewY, t3d),
        material,
        straightWithOpacity(fillColor, opacityFactor),
        strokeColorStr && strokeWidth > 0 ? straightWithOpacity(strokeColorStr, opacityFactor) : undefined,
      )
    : null;

  backend.drawShape({
    cx: w.cx,
    cy: w.cy,
    // Matrix path: local dims (the SDF works in element pixel space and
    // the projection lives in `transform`); 2D path: decomposed dims.
    width: matrixPath ? width : w.width,
    height: matrixPath ? height : w.height,
    rotation: w.rotation,
    skewX,
    skewY,
    transform,
    color: straight,
    gradient,
    cornerRadius,
    shape: isEllipse ? 'ellipse' : 'rectangle',
    strokeColor: strokePremul,
    strokeWidth: strokePremul ? strokeWidth : 0,
    blend: element.blend_mode,
    lit: lit ?? undefined,
  });
}

function straightWithOpacity(
  hex: unknown,
  opacityFactor: number,
): readonly [number, number, number, number] {
  const c = parseColor(typeof hex === 'string' ? hex : '#ffffff');
  return [c[0], c[1], c[2], c[3] * opacityFactor];
}

function compileGradient(
  g: LinearGradient | RadialGradient,
  opacity01: number,
): BackendGradient {
  const opacityFactor = Math.max(0, Math.min(1, opacity01));
  const stops = g.stops.slice(0, 4).map((s) => {
    const c = parseColorPremultiplied(s.color);
    return {
      offset: Math.max(0, Math.min(1, s.offset)),
      color: [
        c[0] * opacityFactor,
        c[1] * opacityFactor,
        c[2] * opacityFactor,
        c[3] * opacityFactor,
      ] as const as [number, number, number, number],
    };
  });

  if (g.type === 'linear') {
    // CSS `linear-gradient(θ)`: 0° = to top, clockwise (90° = to right,
    // 180° = to bottom). Default 180 (to bottom). The shader projects
    // centered UV onto (cos, sin) of its angle, whose basis is 0° = +x
    // (right), 90° = +y (down) — so map CSS θ → shader (θ − 90).
    const angleDeg = typeof g.angle === 'number' ? g.angle : 180;
    return { type: 'linear', angle: ((angleDeg - 90) * Math.PI) / 180, stops };
  }
  return {
    type: 'radial',
    cx: typeof g.cx === 'number' ? g.cx : 0.5,
    cy: typeof g.cy === 'number' ? g.cy : 0.5,
    radius: typeof g.radius === 'number' ? g.radius : 0.5,
    stops,
  };
}

function numberOr(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = parseFloat(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function parseColorPremultipliedWithOpacity(
  hex: unknown,
  opacity01: number,
): readonly [number, number, number, number] {
  const c = parseColorPremultiplied(typeof hex === 'string' ? hex : '#ffffff');
  const opacityFactor = Math.max(0, Math.min(1, opacity01));
  return [c[0] * opacityFactor, c[1] * opacityFactor, c[2] * opacityFactor, c[3] * opacityFactor];
}
