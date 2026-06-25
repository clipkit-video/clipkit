// Shared builder for a draw's PBR `LitParams` (§4.8). Given the element's
// world (pre-camera) quad matrix and resolved material, splits the scene
// lights into ambient + directional and derives the world face normal.
// Used by shape/image/group renderers; returns null when there's nothing
// to light (no material or no lights → unlit fast path).

import type { LitParams } from '../../backend/backend.js';
import type { RGBA } from '../color.js';
import type { ResolvedMaterial } from '../lighting.js';
import type { RenderContext } from '../render-context.js';

export function buildLitParams(
  ctx: RenderContext,
  worldQuadMatrix: ArrayLike<number>,
  material: ResolvedMaterial | null,
  albedo: RGBA,
  strokeAlbedo?: RGBA,
): LitParams | null {
  // Lit if there's a material AND something to shade with — direct
  // lights and/or an environment to reflect. No material, or neither
  // lights nor environment ⇒ unlit fast path.
  if (!material || (ctx.lights.length === 0 && !ctx.environment)) return null;

  const m = worldQuadMatrix;
  // Column 2 of the unit-quad→world matrix is the face normal direction;
  // columns 0/1 are the tangent (+U) / bitangent (+V) for normal mapping.
  let nx = m[8]!, ny = m[9]!, nz = m[10]!;
  const nl = Math.hypot(nx, ny, nz) || 1;
  nx /= nl; ny /= nl; nz /= nl;

  // §4.8 Phase 2 normal map: resolve the texture + world TBN basis.
  let normalMap: LitParams['normalMap'];
  if (material.normalMap && material.normalScale > 0) {
    const asset = ctx.images.get(material.normalMap);
    if (asset) {
      let tx = m[0]!, ty = m[1]!, tz = m[2]!;
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl; ty /= tl; tz /= tl;
      let bx = m[4]!, by = m[5]!, bz = m[6]!;
      const bl = Math.hypot(bx, by, bz) || 1;
      bx /= bl; by /= bl; bz /= bl;
      normalMap = {
        texture: asset.texture,
        scale: material.normalScale,
        tangent: [tx, ty, tz],
        bitangent: [bx, by, bz],
      };
    }
  }

  const ambient: [number, number, number] = [0, 0, 0];
  const lightDirs: Array<readonly [number, number, number]> = [];
  const lightColors: Array<readonly [number, number, number]> = [];
  for (const l of ctx.lights) {
    if (l.ambient) {
      ambient[0] += l.color[0]; ambient[1] += l.color[1]; ambient[2] += l.color[2];
    } else if (lightDirs.length < 4) {
      lightDirs.push(l.dir);
      lightColors.push(l.color);
    }
  }

  const env = ctx.environment
    ? {
        stopColors: ctx.environment.stops.map((s) => s.color),
        stopOffsets: ctx.environment.stops.map((s) => s.offset),
        avg: ctx.environment.avg,
        image: ctx.environment.image ? ctx.images.get(ctx.environment.image)?.texture : undefined,
      }
    : undefined;

  return {
    albedo,
    strokeAlbedo,
    roughness: material.roughness,
    metalness: material.metalness,
    reflectivity: material.reflectivity,
    emissive: material.emissive,
    worldMatrix: worldQuadMatrix,
    normal: [nx, ny, nz],
    eye: ctx.eye,
    ambient,
    lightDirs,
    lightColors,
    env,
    normalMap,
  };
}
