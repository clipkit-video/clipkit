import type { Element, GroupElement } from '@clipkit/protocol';
import { interpolateKeyframes } from '../../animation/keyframes.js';
import { applyModelTransform, mat4Identity, mat4Multiply, mat4TRS, mat4TRS3D, quadWorldTransform } from '../mat4.js';
import { resolveAnchor, resolveLength } from '../unit.js';
import { anchorToCenter } from '../transform.js';
import { applyAnimation, depthOrder, resolve3D, resolveScalePair } from '../resolve.js';
import { resolveMaterial } from '../lighting.js';
import { buildLitParams } from './lit.js';
import { getLogger } from '../../logger.js';
import type { GroupClipTarget, RenderContext } from '../render-context.js';

// A flattened group card lights from its layer pixels, so the albedo
// color is unused by the lit-textured shader — pass white.
const WHITE: readonly [number, number, number, number] = [1, 1, 1, 1];

/**
 * Render a group element. Pushes the group's transform / opacity / time
 * scope, then walks children. Stack is restored on return.
 *
 * Layers within a group establish local paint order — children render
 * in descending-layer order (layer 1 on top), just like at the top
 * level.
 */
export function renderGroupElement(el: GroupElement, ctx: RenderContext): void {
  // Time-window check against the local timeline. ctx.time is global;
  // we compare against the group's global start + duration.
  const groupStart = ctx.timeOffset + numberOr(el.time, 0);
  const groupDur = parseDuration(el.duration, ctx.sourceDuration - groupStart);
  if (ctx.time < groupStart || ctx.time > groupStart + groupDur) return;

  // §5.8.4 time_remap: the SUBTREE runs on a warped clock. The group's
  // own animations (opacity/rotation/scale below) read REAL time; only
  // children see the warp. ctx.time is swapped while children render.
  const prevGlobalTime = ctx.time;
  const warpedTime =
    Array.isArray(el.time_remap) && el.time_remap.length > 0
      ? groupStart + Math.max(0, interpolateKeyframes(el.time_remap, ctx.time - groupStart))
      : ctx.time;

  const opacity01 = applyAnimation(el, 'opacity', numberOr(el.opacity, 1), ctx);
  const opFactor = Math.max(0, Math.min(1, opacity01));
  if (opFactor === 0) return;

  const { canvas } = ctx;
  const x = resolveLength(el.x as never, canvas.width, canvas);
  const y = resolveLength(el.y as never, canvas.height, canvas);
  const width = el.width !== undefined
    ? resolveLength(el.width as never, canvas.width, canvas)
    : 0;
  const height = el.height !== undefined
    ? resolveLength(el.height as never, canvas.height, canvas)
    : 0;
  const ax = resolveAnchor(el.x_anchor);
  const ay = resolveAnchor(el.y_anchor);
  const rotation = applyAnimation(el, 'rotation', numberOr(el.rotation ?? (el as { z_rotation?: unknown }).z_rotation, 0), ctx);
  const { sx, sy } = resolveScalePair(el, ctx);
  // CKP/1.0 3D (§4.4): groups with 3D fields stack a general matrix
  // (plain path) or project their flattened layer's quad (clip/mask).
  const t3d = resolve3D(el, ctx);

  // Render children in descending `layer` order (local paint order,
  // layer 1 on top). The plain-group path below re-orders by depth
  // (`z`) when ctx.depthSort is set; the flattened layer keeps this
  // layer order (its children are coplanar in the flat layer).
  const sortedChildren = [...el.elements].sort(
    (a, b) => numberOr(b.layer, Number.MAX_SAFE_INTEGER) - numberOr(a.layer, Number.MAX_SAFE_INTEGER),
  );

  const dispatch = (ctx as RenderContext & { _dispatch?: (el: Element, ctx: RenderContext) => void })
    ._dispatch;

  const prevMatrix = ctx.modelMatrix;
  const prevWorld = ctx.worldMatrix;
  const prevOpacity = ctx.opacityFactor;
  const prevTime = ctx.timeOffset;
  const prevSurfW = ctx.surfaceWidth;
  const prevSurfH = ctx.surfaceHeight;

  // ── Layered paths (clip and/or mask): render children into an
  // offscreen layer the size of the group's box, optionally render the
  // mask elements into a second layer, then composite with the group's
  // transform + opacity. Layer bounds do the clipping (mask implies
  // clip — both layers are box-sized).
  if (el.clip === true || el.mask) {
    if (width <= 0 || height <= 0) {
      getLogger().warn('group clip/mask requires explicit width and height — skipping');
    } else {
      const renderIntoLayer = (key: string, elements: readonly Element[]): GroupClipTarget => {
        let entry = ctx.groupTargets.get(key);
        if (entry && (entry.width !== width || entry.height !== height)) {
          ctx.backend.destroyRenderTarget(entry.target);
          entry = undefined;
        }
        if (!entry) {
          entry = { target: ctx.backend.createRenderTarget(width, height), width, height };
          ctx.groupTargets.set(key, entry);
        }
        // Stamp on EVERY acquire (reuse path included) for frame-boundary LRU.
        entry.lastTouched = ctx.frameIndex;
        ctx.backend.pushTarget(entry.target, [0, 0, 0, 0]);
        // try/finally so a throw while rendering a child can't leave the surface
        // stack unbalanced and blacken the rest of the frame (EXPORT-FLOW §4A).
        try {
          // Inside the layer: identity transform (child coordinates are
          // relative to the group's top-left, which is the layer origin),
          // full opacity (the group's opacity applies at composite).
          ctx.modelMatrix = mat4Identity();
          ctx.worldMatrix = mat4Identity();
          ctx.opacityFactor = 1;
          ctx.timeOffset = groupStart;
          ctx.time = warpedTime;
          ctx.surfaceWidth = width;
          ctx.surfaceHeight = height;
          const ordered = [...elements].sort(
            (a, b) => numberOr(b.layer, Number.MAX_SAFE_INTEGER) - numberOr(a.layer, Number.MAX_SAFE_INTEGER),
          );
          for (const child of ordered) {
            if (child.visible === false) continue;
            if (!isActiveInGroup(child, ctx.time, groupStart, groupDur)) continue;
            dispatch?.(child, ctx);
          }
        } finally {
          ctx.backend.popTarget();
        }
        ctx.modelMatrix = prevMatrix;
        ctx.worldMatrix = prevWorld;
        ctx.opacityFactor = prevOpacity;
        ctx.timeOffset = prevTime;
        ctx.time = prevGlobalTime;
        ctx.surfaceWidth = prevSurfW;
        ctx.surfaceHeight = prevSurfH;
        return entry;
      };

      const baseKey = el.id ?? '__group_layer__';
      const content = renderIntoLayer(baseKey, sortedChildren);
      const maskLayer = el.mask ? renderIntoLayer(`${baseKey}::mask`, el.mask.elements) : null;

      // Composite like a textured leaf element. With 3D on the group
      // (or an un-flattened 3D ancestor) the LAYER's quad is projected
      // by the full matrix chain — the §4.4.3 flattening rule and the
      // "tilted UI card" shot.
      const { cx, cy } = anchorToCenter(x, y, width, height, ax, ay);
      const matrixPath = t3d !== null || !prevMatrix.aff;
      const w = applyModelTransform(
        prevMatrix, prevOpacity,
        cx, cy, rotation, opacity01, width * sx, height * sy,
      );
      const transform = matrixPath
        ? quadWorldTransform(prevMatrix, cx, cy, width * sx, height * sy, rotation, 0, 0, t3d)
        : undefined;
      const tintA = Math.max(0, Math.min(1, w.opacity01));
      const tint: readonly [number, number, number, number] = [tintA, tintA, tintA, tintA];
      if (maskLayer && el.mask) {
        ctx.backend.drawMaskedQuad({
          cx: w.cx,
          cy: w.cy,
          width: matrixPath ? width * sx : w.width,
          height: matrixPath ? height * sy : w.height,
          rotation: w.rotation,
          transform,
          content: content.target.texture,
          mask: maskLayer.target.texture,
          mode: el.mask.mode,
          tint,
          blend: el.blend_mode,
        });
      } else {
        // A rounded clip box (rounded card clipping its content): mask the
        // composited layer to a rounded rect. border_radius is in the
        // group's local px, so it scales with the quad's x-scale.
        const cornerRadius =
          typeof el.border_radius === 'number' && el.border_radius > 0
            ? el.border_radius * sx
            : undefined;
        // §4.8 PBR: a material on the group shades the WHOLE flattened
        // card as one lit plane (albedo = the layer's pixels). World quad
        // from the camera-free matrix so the sheen is view-dependent.
        const material = resolveMaterial(el, ctx.time);
        const litLayer = material
          ? buildLitParams(
              ctx,
              quadWorldTransform(prevWorld, cx, cy, width * sx, height * sy, rotation, 0, 0, t3d),
              material,
              WHITE,
            )
          : null;
        ctx.backend.drawTexturedQuad({
          cx: w.cx,
          cy: w.cy,
          width: matrixPath ? width * sx : w.width,
          height: matrixPath ? height * sy : w.height,
          rotation: w.rotation,
          transform,
          texture: content.target.texture,
          tint,
          cornerRadius,
          blend: el.blend_mode,
          lit: litLayer ?? undefined,
        });
      }
      return;
    }
  }

  // ── Unclipped path: compose the group's local matrix with the
  // current model matrix and render children directly.
  // blend_mode applies when compositing a group's FLATTENED layer; an
  // unlayered group never rasterizes, so there's nothing to blend (§4.5).
  if (el.blend_mode && el.blend_mode !== 'normal') {
    getLogger().warn('group blend_mode requires clip: true or mask — ignored; children composite with their own blend modes');
  }
  // 3D groups stack a general matrix — children live in the group's 3D
  // space (nested rotations compose; flattening only at layer
  // boundaries, §4.4.3).
  // Position the group's box via its anchor (default top-left), but pivot
  // rotation/scale around the box CENTER — the same model as leaf elements
  // (anchor = position only; transforms pivot center). Identical to the old
  // anchor-as-pivot math when the group isn't rotated/scaled. See
  // ANCHOR-CONVENTION-PLAN.md.
  const { cx, cy } = anchorToCenter(x, y, width, height, ax, ay);
  const localMatrix = t3d
    ? mat4TRS3D(cx, cy, t3d.z, width, height, 0.5, 0.5, rotation, t3d.yRot, t3d.xRot, sx, sy)
    : mat4TRS(cx, cy, width, height, 0.5, 0.5, rotation, sx, sy);

  ctx.modelMatrix = mat4Multiply(prevMatrix, localMatrix);
  ctx.worldMatrix = mat4Multiply(prevWorld, localMatrix);
  ctx.opacityFactor = prevOpacity * opFactor;
  ctx.timeOffset = groupStart;
  ctx.time = warpedTime;

  // §4.4.3: under a camera, plain-group children paint back-to-front by
  // camera depth (computed against the just-composed model matrix so the
  // group's own 3D transform is included). Flattened groups (the clip/
  // mask path above) keep layer order — their children are coplanar in
  // the flat layer.
  const drawOrder = ctx.depthSort ? depthOrder(sortedChildren, ctx) : sortedChildren;

  for (const child of drawOrder) {
    if (child.visible === false) continue;
    if (!isActiveInGroup(child, ctx.time, groupStart, groupDur)) continue;
    // Lazy import would create a cycle; the dispatch is reachable via
    // the parent module passing dispatchElement in. Inline the dispatch
    // here by calling back through ctx-attached function set in scene.ts.
    dispatch?.(child, ctx);
  }

  ctx.modelMatrix = prevMatrix;
  ctx.worldMatrix = prevWorld;
  ctx.opacityFactor = prevOpacity;
  ctx.timeOffset = prevTime;
  ctx.time = prevGlobalTime;
}

function numberOr(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = parseFloat(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function parseDuration(v: unknown, fallback: number): number {
  if (v === 'auto' || v === 'end' || v == null) return fallback;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function isActiveInGroup(
  el: Element,
  globalTime: number,
  groupStart: number,
  groupDur: number,
): boolean {
  const localStart = numberOr(el.time, 0);
  const start = groupStart + localStart;
  const dur = parseDuration(el.duration, groupDur - localStart);
  return globalTime >= start && globalTime <= start + dur;
}
