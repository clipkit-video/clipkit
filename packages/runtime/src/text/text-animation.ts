// Per-unit (letter / word) text animation evaluation.
//
// The text renderer draws one quad per glyph, so per-unit animation is
// just per-glyph math at draw time: each glyph carries a letter index
// and a word index; for each active text-* animation we compute the
// unit's eased progress (offset by `stagger × unitIndex`) and fold the
// result into an opacity multiplier + position offset applied in
// element-local space (before scale/skew/rotation, so kinetic type
// composes with every other transform).
//
// Pure functions — no caching, no state. Costs a few multiplies per
// glyph per frame.

import type { Animation, AnimationType, BaseElement, Easing } from '@clipkit/protocol';
import { applyEasing } from '../animation/easings.js';

const TEXT_ANIMATION_TYPES = new Set<AnimationType>([
  'text-appear',
  'text-slide',
  'text-fly',
  'text-typewriter',
  'text-wave',
  'text-flip',
]);

export function isTextAnimationType(t: AnimationType): boolean {
  return TEXT_ANIMATION_TYPES.has(t);
}

/** [xRot, yRot, zRot] in degrees, applied about the unit's center. */
export type UnitRotation = [number, number, number];

export interface UnitEffect {
  /** 0..1 multiplier folded into the glyph tint. */
  opacity: number;
  /** Element-local pixel offsets (pre-scale/skew/rotation). */
  dx: number;
  dy: number;
  /**
   * text-flip rotations (CKP/1.0, §6.5), accumulated per split
   * granularity — each applies about the center of ITS unit (letter
   * rotations about the glyph cell, word rotations about the word's
   * bounding box). Word composes OUTSIDE letter.
   */
  flips?: { letter?: UnitRotation; word?: UnitRotation };
}

export interface CompiledTextAnim {
  type: AnimationType;
  split: 'letter' | 'word';
  stagger: number;
  /** Per-unit animation duration, seconds. */
  duration: number;
  /** Animation start, seconds relative to element start. */
  startTime: number;
  distance: number;
  direction: 'left' | 'right' | 'up' | 'down';
  frequency: number;
  easing: Easing | undefined;
  /** text-flip: rotation axis + starting angle in degrees. */
  axis: 'x' | 'y' | 'z';
  angle: number;
  /** Stagger order across units (forward = reading order). */
  order: 'forward' | 'reverse' | 'random';
  /** Whether the unit fades opacity 0→1 as it animates in. */
  fade: boolean;
  /** Seed for `order: 'random'`. */
  seed: number;
}

const NO_EFFECT: UnitEffect = { opacity: 1, dx: 0, dy: 0 };

/** True when any compiled animation carries per-unit 3D rotation —
 * the text renderer's signal to take the matrix path (§6.5). */
export function hasUnitRotations(compiled: CompiledTextAnim[]): boolean {
  return compiled.some((a) => a.type === 'text-flip');
}

/**
 * Compile the element's text-* animations. Returns null when there are
 * none — the renderer's fast path.
 */
export function compileTextAnimations(element: BaseElement): CompiledTextAnim[] | null {
  const anims = element.animations;
  if (!anims || anims.length === 0) return null;
  let out: CompiledTextAnim[] | null = null;
  for (const a of anims) {
    if (!TEXT_ANIMATION_TYPES.has(a.type)) continue;
    // v1: entrance-only — 'end' anchoring unsupported (documented).
    if (a.time === 'end') continue;
    const split = a.split ?? defaultSplit(a.type);
    (out ??= []).push({
      type: a.type,
      split,
      stagger: a.stagger ?? (split === 'word' ? 0.09 : 0.035),
      duration: a.duration ?? 0.5,
      startTime: typeof a.time === 'number' ? a.time : 0,
      distance: a.distance ?? (a.type === 'text-fly' ? 140 : a.type === 'text-wave' ? 12 : 40),
      direction: a.direction ?? 'up',
      frequency: a.frequency ?? 1.5,
      easing: a.easing,
      axis: a.axis ?? 'x',
      angle: a.rotation ?? 90,
      order: a.order ?? 'forward',
      fade: a.fade ?? true,
      seed: a.seed ?? 0,
    });
  }
  return out;
}

function defaultSplit(t: AnimationType): 'letter' | 'word' {
  return t === 'text-typewriter' || t === 'text-wave' || t === 'text-flip' ? 'letter' : 'word';
}

/**
 * Effect for one glyph at the element-local time. `letterIndex` counts
 * drawn glyphs (whitespace excluded); `wordIndex` counts whitespace-
 * separated runs. `letterCount` / `wordCount` are the totals — needed so
 * `order: 'reverse' | 'random'` can map a unit to its stagger slot.
 */
export function evaluateUnitEffect(
  compiled: CompiledTextAnim[],
  localTime: number,
  letterIndex: number,
  wordIndex: number,
  letterCount = 0,
  wordCount = 0,
): UnitEffect {
  let opacity = 1;
  let dx = 0;
  let dy = 0;
  let flips: UnitEffect['flips'];

  for (const anim of compiled) {
    const unit = anim.split === 'word' ? wordIndex : letterIndex;
    const unitCount = anim.split === 'word' ? wordCount : letterCount;

    if (anim.type === 'text-wave') {
      // Ambient bob: phase marches across units; no stagger gating.
      const t = localTime - anim.startTime;
      if (t < 0) continue;
      dy += Math.sin(2 * Math.PI * anim.frequency * t - unit * 0.6) * anim.distance;
      continue;
    }

    // Reading order (forward), last-first (reverse), or a deterministic
    // shuffle (random, AE Randomize Order) maps the unit to its slot.
    const slot = orderSlot(anim.order, unit, unitCount, anim.seed);
    const unitStart = anim.startTime + slot * anim.stagger;

    if (anim.type === 'text-typewriter') {
      if (localTime < unitStart) opacity = 0;
      continue;
    }

    const p =
      anim.duration > 0
        ? Math.max(0, Math.min(1, (localTime - unitStart) / anim.duration))
        : localTime >= unitStart
          ? 1
          : 0;
    const eased = applyEasing(
      anim.easing ?? (anim.type === 'text-fly' ? 'ease-out-back' : 'ease-out-cubic'),
      p,
    );

    // Entrance types fade in over the unit's window unless `fade` is off
    // (a solid position/transform-only entrance, e.g. an AE Position-only
    // animator). text-appear is fade-only, so it ignores the flag.
    if (anim.fade || anim.type === 'text-appear') {
      opacity *= Math.max(0, Math.min(1, eased));
    }

    if (anim.type === 'text-flip') {
      // Rotate from `angle` to rest about the unit's own center.
      const remaining = anim.angle * (1 - eased);
      if (remaining !== 0) {
        flips ??= {};
        const slot = (flips[anim.split] ??= [0, 0, 0]);
        slot[anim.axis === 'x' ? 0 : anim.axis === 'y' ? 1 : 2] += remaining;
      }
      continue;
    }

    if (anim.type === 'text-slide' || anim.type === 'text-fly') {
      // Start displaced OPPOSITE the motion direction, settle at rest.
      const remaining = (1 - eased) * anim.distance;
      switch (anim.direction) {
        case 'up': dy += remaining; break;
        case 'down': dy -= remaining; break;
        case 'left': dx += remaining; break;
        case 'right': dx -= remaining; break;
      }
    }
  }

  if (opacity === 1 && dx === 0 && dy === 0 && !flips) return NO_EFFECT;
  return { opacity, dx, dy, flips };
}

/**
 * Map a unit index to its stagger slot under the chosen reveal order.
 * `forward` is identity; `reverse` counts from the last unit; `random`
 * ranks the unit within a deterministic, seed-driven shuffle of all
 * units (pure integer math — identical on every backend and run). The
 * total span (count × stagger) is the same for every order; only which
 * unit occupies which slot changes.
 */
function orderSlot(
  order: 'forward' | 'reverse' | 'random',
  unit: number,
  count: number,
  seed: number,
): number {
  if (count <= 1) return unit;
  if (order === 'reverse') return count - 1 - unit;
  if (order === 'random') {
    // slot = how many units sort before this one by hash key (index
    // breaks ties), i.e. this unit's rank in the shuffled permutation.
    const ku = hashKey(unit, seed);
    let rank = 0;
    for (let j = 0; j < count; j++) {
      if (j === unit) continue;
      const kj = hashKey(j, seed);
      if (kj < ku || (kj === ku && j < unit)) rank++;
    }
    return rank;
  }
  return unit;
}

/** Deterministic 32-bit integer hash of (index, seed) → uint32. */
function hashKey(index: number, seed: number): number {
  let x = (Math.imul(index + 1, 2654435761) ^ Math.imul(seed + 1, 40503)) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 2246822519) >>> 0;
  x ^= x >>> 13;
  x = Math.imul(x, 3266489917) >>> 0;
  x ^= x >>> 16;
  return x >>> 0;
}
