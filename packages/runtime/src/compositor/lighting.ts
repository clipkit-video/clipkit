// Lighting resolution (CKP/1.0 §4.8). Pure: resolves a Source's `lights`
// and an element's `material` to numbers at a given time, and derives the
// camera's world-space eye position (for view-dependent specular). No DOM,
// no GPU. The shading itself lives in the backends.

import type { Camera, Element, Environment, Light, Material, Source, Keyframe, Expr } from '@clipkit/protocol';
import { interpolateKeyframes } from '../animation/keyframes.js';
import { isExpr, evalExpr } from '../animation/expr.js';
import { parseColor } from './color.js';
import type { CanvasDimensions } from './unit.js';

const DEG = Math.PI / 180;

function num(v: number | Keyframe[] | Expr | undefined, time: number, fallback: number): number {
  if (v === undefined) return fallback;
  if (isExpr(v)) return evalExpr(v, { t: time, dur: 0, i: 0, n: 1, value: fallback });
  return Array.isArray(v) ? interpolateKeyframes(v, time) : v;
}

export interface ResolvedLight {
  ambient: boolean;
  /** Unit direction TOWARD the light (world space). Unused for ambient. */
  dir: [number, number, number];
  /** Linear-ish RGB, already scaled by intensity. */
  color: [number, number, number];
}

/** Resolve `source.lights` at `time`. Empty/absent ⇒ []. */
export function resolveLights(source: Source, time: number): ResolvedLight[] {
  const lights = source.lights;
  if (!lights || lights.length === 0) return [];
  const out: ResolvedLight[] = [];
  for (const l of lights as Light[]) {
    const c = parseColor(l.color ?? '#ffffff');
    const intensity = num((l as { intensity?: number | Keyframe[] }).intensity, time, 1);
    const color: [number, number, number] = [c[0] * intensity, c[1] * intensity, c[2] * intensity];
    if (l.type === 'ambient') {
      out.push({ ambient: true, dir: [0, 0, 1], color });
    } else {
      // azimuth around the view axis (0 = +x, CCW), elevation above the
      // screen plane toward the viewer (+z). Direction points to the light.
      const az = num(l.azimuth, time, 0) * DEG;
      const el = num(l.elevation, time, 45) * DEG;
      const ce = Math.cos(el);
      out.push({
        ambient: false,
        dir: [ce * Math.cos(az), ce * Math.sin(az), Math.sin(el)],
        color,
      });
    }
  }
  return out;
}

export interface ResolvedMaterial {
  roughness: number;
  metalness: number;
  reflectivity: number;
  emissive: number;
  /** Tangent-space normal map URL (§4.8 Phase 2), or null. */
  normalMap: string | null;
  /** Normal-map perturbation strength (0 = flat). */
  normalScale: number;
}

/** Resolve an element's `material` at `time`, or null if it has none. */
export function resolveMaterial(element: Element, time: number): ResolvedMaterial | null {
  const m = (element as Element & { material?: Material }).material;
  if (!m) return null;
  return {
    roughness: Math.max(0.02, Math.min(1, num(m.roughness, time, 0.5))),
    metalness: Math.max(0, Math.min(1, num(m.metalness, time, 0))),
    reflectivity: Math.max(0, num(m.reflectivity, time, 1)),
    emissive: Math.max(0, num(m.emissive, time, 0)),
    normalMap: typeof m.normal_map === 'string' && m.normal_map ? m.normal_map : null,
    normalScale: Math.max(0, num(m.normal_scale, time, 1)),
  };
}

export interface ResolvedEnvironment {
  /** Up to 4 gradient stops, sorted by offset (empty for image envs). */
  stops: Array<{ offset: number; color: [number, number, number] }>;
  /** Mean color — the irradiance / fully-rough reflection fallback. */
  avg: [number, number, number];
  /**
   * Equirectangular environment image URL (§4.8 Phase 3), or null for a
   * gradient env. The runtime resolves it to a bound texture at draw time
   * (it samples the lat-long image along the reflection vector).
   */
  image: string | null;
}

/**
 * Resolve `source.environment`, or null if absent. A gradient env
 * (offset 0 = down, 1 = up) returns sorted stops + their mean; an image
 * env returns its `src` (the runtime binds the equirect texture and the
 * shader samples it along the reflection vector). `avg` for an image is
 * filled in by the runtime from the loaded pixels.
 */
export function resolveEnvironment(source: Source, _time: number): ResolvedEnvironment | null {
  const env = source.environment as Environment | undefined;
  if (!env) return null;
  if (env.type === 'image') {
    if (!env.src) return null;
    return { stops: [], avg: [0.5, 0.5, 0.5], image: env.src };
  }
  if (env.type !== 'gradient' || !env.stops || env.stops.length === 0) return null;
  const stops = env.stops
    .slice(0, 4)
    .map((s) => {
      const c = parseColor(s.color);
      return { offset: Math.max(0, Math.min(1, s.offset)), color: [c[0], c[1], c[2]] as [number, number, number] };
    })
    .sort((a, b) => a.offset - b.offset);
  const avg: [number, number, number] = [0, 0, 0];
  for (const s of stops) { avg[0] += s.color[0]; avg[1] += s.color[1]; avg[2] += s.color[2]; }
  avg[0] /= stops.length; avg[1] /= stops.length; avg[2] /= stops.length;
  return { stops, avg, image: null };
}

export interface ResolvedBloom {
  threshold: number;
  knee: number;
  intensity: number;
  radius: number;
}

/** Resolve `source.bloom` at `time`, or null if absent / a no-op. */
export function resolveBloom(source: Source, time: number): ResolvedBloom | null {
  const b = (source as Source & { bloom?: import('@clipkit/protocol').Bloom }).bloom;
  if (!b) return null;
  const intensity = Math.max(0, num(b.intensity, time, 1));
  const radius = Math.max(0, num(b.radius, time, 24));
  if (intensity <= 0 || radius <= 0) return null;
  return {
    threshold: Math.max(0, Math.min(1, num(b.threshold, time, 0.75))),
    knee: Math.max(1e-3, num(b.knee, time, 0.1)),
    intensity,
    radius,
  };
}

/**
 * The camera's eye position in world (canvas-pixel) space. From the pose
 * V = T(o)·R⁻¹·T(−e)·T(−o) and perspective `d`, the eye is the point that
 * maps to the lens apex: `eye = o + e + d · (R·ẑ)`. With no pose this is
 * `(ox, oy, d)` — the lens distance `d` in front of the origin. Used as
 * the view-vector origin so specular sweeps as the camera moves.
 */
export function cameraEyeWorld(
  camera: Camera,
  time: number,
  canvas: CanvasDimensions,
): [number, number, number] {
  const d = Math.max(1e-3, num(camera.perspective, time, 1000));
  const ox = camera.origin_x !== undefined && typeof camera.origin_x === 'number'
    ? camera.origin_x : canvas.width / 2;
  const oy = camera.origin_y !== undefined && typeof camera.origin_y === 'number'
    ? camera.origin_y : canvas.height / 2;
  const ex = num(camera.x, time, 0);
  const ey = num(camera.y, time, 0);
  const ez = num(camera.z, time, 0);
  // R·ẑ (camera forward), R = Rz·Ry·Rx — third column of the rotation.
  const rx = num(camera.x_rotation, time, 0) * DEG;
  const ry = num(camera.y_rotation, time, 0) * DEG;
  const rz = num(camera.z_rotation, time, 0) * DEG;
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);
  // ẑ=(0,0,1) through Rz·Ry·Rx: Rx→(0,−sx,cx); Ry→(cx·sy,−sx,cx·cy);
  // Rz rotates the (x,y) pair.
  const vx = cx * sy, vy = -sx, vz = cx * cy;
  const fx = vx * cz - vy * sz;
  const fy = vx * sz + vy * cz;
  const fz = vz;
  return [ox + ex + d * fx, oy + ey + d * fy, ez + d * fz];
}
