// Particles renderer — Clipkit extension.
//
// Pure-function-of-time simulation: every particle's position, rotation,
// size, and color is deterministically derived from (element id, particle
// index, age). No state carried frame-to-frame, so seeking backward and
// rendering arbitrary frames works without resimulation.
//
// Each frame:
//   1. Enumerate which particle indices are currently alive.
//   2. For each, run simulateParticle(n, age) → {x, y, rotation, size, color, alpha}.
//   3. Emit one backend.drawShape per particle.
//
// Active-window enumeration is O(maxAlive) per frame regardless of total
// emission count — for continuous mode the alive window slides forward in
// time, so we only iterate ceil(lifetime × rate) indices.

import type { EasingFunction, ParticlesElement } from '@clipkit/protocol';
import { parseColor } from '../color.js';
import { mat4ApplyToPoint, mat4Multiply, mat4PlaneAt, mat4Rotation, quadWorldTransform } from '../mat4.js';
import { resolveLength } from '../unit.js';
import { applyAnimation , resolve3D } from '../resolve.js';
import { applyEasing } from '../../animation/easings.js';
import type { RenderContext } from '../render-context.js';

export function renderParticlesElement(element: ParticlesElement, ctx: RenderContext): void {
  const { canvas, backend } = ctx;

  const elementStart = ctx.timeOffset + numberOr(element.time, 0);
  const localTime = ctx.time - elementStart;
  if (localTime < 0) return;

  // Emitter position (animatable like any other element).
  const emitterX = applyAnimation(element, 'x', resolveLength(element.x as never, canvas.width, canvas), ctx);
  const emitterY = applyAnimation(element, 'y', resolveLength(element.y as never, canvas.height, canvas), ctx);

  // Per-particle depth (CKP/1.0, §5.7.3): vz along the emitter plane's
  // normal. Authoring either field puts the element on the matrix path
  // (like element `z`, depth is invisible without perspective).
  const zVelocity = numberOr(element.z_velocity, 0);
  const zSpread = numberOr(element.z_spread, 0);
  const hasZDynamics = zVelocity !== 0 || zSpread !== 0;

  // CKP/1.0 3D (§4.4): the whole particle field tilts as one plane
  // anchored at the emitter.
  const t3d = resolve3D(element, ctx);
  const planeChain = t3d !== null || !ctx.modelMatrix.aff || hasZDynamics
    ? mat4Multiply(ctx.modelMatrix, mat4PlaneAt(emitterX, emitterY, t3d?.z ?? 0, 0, t3d?.yRot ?? 0, t3d?.xRot ?? 0))
    : null;

  // Config with defaults.
  const rate = Math.max(1, numberOr(element.rate, 60));
  const lifetime = Math.max(0.01, numberOr(element.lifetime, 1.5));
  const velocity = numberOr(element.velocity, 300);
  const spread = numberOr(element.spread, 360);
  const direction = numberOr(element.direction, -90);
  const gravity = numberOr(element.gravity, 600);
  const size = Math.max(1, numberOr(element.size, 12));
  const sizeVariation = clamp01(numberOr(element.size_variation, 0.4));
  const rotSpeed = numberOr(element.rotation_speed, 360);
  const burst = element.burst === true;
  const burstCount = Math.max(1, Math.floor(numberOr(element.burst_count, 80)));
  const fadeAt = clamp01(numberOr(element.fade_at, 0.7));
  const isCircle = element.particle_shape === 'circle';

  // Convergence mode setup.
  const targetPoints = Array.isArray(element.target_points) ? element.target_points : null;
  const convergenceEasing: EasingFunction = element.convergence_easing ?? 'ease-out-quart';
  const scatterRadius = numberOr(element.scatter_radius, Math.max(canvas.width, canvas.height));

  const colors = normalizeColors(element.color);
  const elementOpacity = clamp01(applyAnimation(element, 'opacity', numberOr(element.opacity, 1), ctx) * ctx.opacityFactor);
  if (elementOpacity <= 0) return;

  // Stable seed per element so the particle field is deterministic across frames.
  const seedBase = hashString(typeof element.id === 'string' ? element.id : 'particles');

  // Enumerate active particle indices.
  // Burst mode: all particles share spawnTime=0, age=localTime.
  // Continuous mode: particle n spawns at n/rate; alive when 0 ≤ age < lifetime.
  let firstN: number;
  let lastN: number;
  if (burst) {
    if (localTime >= lifetime) return;
    firstN = 0;
    lastN = burstCount - 1;
  } else {
    firstN = Math.max(0, Math.ceil((localTime - lifetime) * rate));
    lastN = Math.floor(localTime * rate);
  }

  for (let n = firstN; n <= lastN; n++) {
    const spawnTime = burst ? 0 : n / rate;
    const age = localTime - spawnTime;
    if (age < 0 || age >= lifetime) continue;

    // 6 independent random values per particle.
    const rng = mulberry32(seedBase + n * 0x9e3779b9);
    const r1 = rng(); // angle within spread / scatter x
    const r2 = rng(); // speed jitter / scatter y
    const r3 = rng(); // rotation direction
    const r4 = rng(); // size
    const r5 = rng(); // color index
    const r6 = rng(); // z-velocity spread (§5.7.3)

    let px: number;
    let py: number;

    if (targetPoints && targetPoints.length > 0) {
      // ── Convergence mode ────────────────────────────────────────────
      // Random scattered start position (in a disk of radius scatterRadius
      // centered on the emitter), animating to its assigned target point.
      const startAngle = r1 * Math.PI * 2;
      const startDist = scatterRadius * (0.5 + 0.5 * r2); // 50%..100% radius
      const startX = emitterX + Math.cos(startAngle) * startDist;
      const startY = emitterY + Math.sin(startAngle) * startDist;
      const target = targetPoints[n % targetPoints.length]!;
      const progress = clamp01(age / lifetime);
      const eased = applyEasing(convergenceEasing, progress);
      px = startX + (target[0] - startX) * eased;
      py = startY + (target[1] - startY) * eased;
    } else {
      // ── Ballistic emission (default) ────────────────────────────────
      const angleDeg = direction + (r1 - 0.5) * spread;
      const angleRad = (angleDeg * Math.PI) / 180;
      const speed = velocity * (0.7 + 0.6 * r2); // 70%..130%
      const vx = Math.cos(angleRad) * speed;
      const vy = Math.sin(angleRad) * speed;
      px = emitterX + vx * age;
      py = emitterY + vy * age + 0.5 * gravity * age * age;
    }

    // Depth along the plane normal: vz = z_velocity + (r6 − 0.5) ×
    // z_spread, pz = vz · age. No z gravity (gravity stays in-plane y).
    // Applies in convergence mode too (orthogonal, no special case).
    const pz = hasZDynamics ? (zVelocity + (r6 - 0.5) * zSpread) * age : 0;

    // Rotation accumulates linearly; sign randomized per particle.
    const rot = rotSpeed * age * (r3 < 0.5 ? -1 : 1);

    // Size — anchored at `size`, scaled down by up to sizeVariation.
    const partSize = size * (1 - sizeVariation + sizeVariation * r4);

    // Color — pick from the palette.
    const color = colors[Math.floor(r5 * colors.length) % colors.length]!;

    // Fade — full alpha until fade_at, then linear ramp to 0.
    const lifeProg = age / lifetime;
    let alpha = elementOpacity;
    if (lifeProg > fadeAt) {
      alpha *= (1 - lifeProg) / (1 - fadeAt);
    }
    if (alpha <= 0) continue;

    // Apply group transform stack: each particle's center is translated
    // through the model matrix, rotation is summed, opacity multiplied.
    // Under 3D the particle field lives in the emitter's plane: local
    // coords stay local and each quad projects through planeChain.
    const [worldX, worldY] = planeChain ? [px, py] : mat4ApplyToPoint(ctx.modelMatrix, px, py);
    const totalRot = planeChain ? rot : rot + mat4Rotation(ctx.modelMatrix);

    // Premultiplied RGBA. Group's opacity factor was already folded
    // into elementOpacity at the top of this loop's caller.
    const c = parseColor(color);
    const ca = c[3] * alpha;
    const premul: readonly [number, number, number, number] = [
      c[0] * ca,
      c[1] * ca,
      c[2] * ca,
      ca,
    ];

    backend.drawShape({
      cx: worldX,
      cy: worldY,
      width: partSize,
      height: partSize,
      rotation: totalRot,
      transform: planeChain
        ? quadWorldTransform(planeChain, px, py, partSize, partSize, rot, 0, 0,
            pz !== 0 ? { xRot: 0, yRot: 0, z: pz } : null)
        : undefined,
      color: premul,
      shape: isCircle ? 'ellipse' : 'rectangle',
      cornerRadius: isCircle ? 0 : 0,
      blend: element.blend_mode,
    });
  }
}

// ── helpers ────────────────────────────────────────────────────────────────

function numberOr(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = parseFloat(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function normalizeColors(c: ParticlesElement['color']): string[] {
  if (!c) return ['#ffffff'];
  if (Array.isArray(c)) return c.length > 0 ? c : ['#ffffff'];
  return [c];
}

// FNV-1a string hash — fast, decent dispersion, no allocations.
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Mulberry32 — small, fast, good-enough PRNG. Returns a thunk that yields
// successive [0, 1) values from a single seed.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
