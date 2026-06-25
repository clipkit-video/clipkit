// Keyframe interpolation. Pure function — no caching, no state.
// The previous v0 implementation had a frame cache keyed by time, which
// meant every distinct frame was a cache miss. We drop the cache entirely
// here; if profiling shows interpolation is hot, we add memoization later.

import type { Keyframe } from '@clipkit/protocol';
import { applyEasing } from './easings.js';
import { parseColor, type RGBA } from '../compositor/color.js';

/**
 * Interpolate a numeric keyframe sequence at a given time (seconds).
 * Returns the start value before the first keyframe, and the end value
 * after the last. Keyframes are assumed to be sorted by time.
 */
/**
 * Fold local time for looping keyframe animations (§6.3): `true` wraps
 * modulo the last keyframe's time; `'ping-pong'` reflects.
 */
export function foldKeyframeTime(
  keyframes: Keyframe[],
  loop: boolean | 'ping-pong' | undefined,
  t: number,
): number {
  if (!loop || keyframes.length < 2 || t <= 0) return t;
  const last = keyframes[keyframes.length - 1]!.time;
  const span = typeof last === 'number' ? last : parseFloat(String(last));
  if (!Number.isFinite(span) || span <= 0) return t;
  if (loop === 'ping-pong') {
    const c = t % (2 * span);
    return c <= span ? c : 2 * span - c;
  }
  return t % span;
}

export function interpolateKeyframes(keyframes: Keyframe[], time: number): number {
  if (keyframes.length === 0) return 0;
  if (keyframes.length === 1) return toNumber(keyframes[0]!.value);

  const first = keyframes[0]!;
  const last = keyframes[keyframes.length - 1]!;
  if (time <= toNumber(first.time)) return toNumber(first.value);
  if (time >= toNumber(last.time)) return toNumber(last.value);

  for (let i = 0; i < keyframes.length - 1; i++) {
    const a = keyframes[i]!;
    const b = keyframes[i + 1]!;
    const at = toNumber(a.time);
    const bt = toNumber(b.time);
    if (time >= at && time <= bt) {
      const span = bt - at;
      const localT = span > 0 ? (time - at) / span : 0;
      const easedT = applyEasing(b.easing, localT);
      const av = toNumber(a.value);
      const bv = toNumber(b.value);
      return av + (bv - av) * easedT;
    }
  }

  // Unreachable given the sentinels above, but TS doesn't know that.
  return toNumber(last.value);
}

/**
 * Interpolate a COLOR keyframe sequence at a given time. Values are CSS
 * color strings (hex / rgb / rgba); interpolation is componentwise in
 * straight-alpha RGB space, easing taken from the destination keyframe
 * (same convention as numeric keyframes). Returns straight-alpha RGBA.
 */
export function interpolateColorKeyframes(keyframes: Keyframe[], time: number): RGBA {
  if (keyframes.length === 0) return [1, 1, 1, 1];
  if (keyframes.length === 1) return toColor(keyframes[0]!.value);

  const first = keyframes[0]!;
  const last = keyframes[keyframes.length - 1]!;
  if (time <= toNumber(first.time)) return toColor(first.value);
  if (time >= toNumber(last.time)) return toColor(last.value);

  for (let i = 0; i < keyframes.length - 1; i++) {
    const a = keyframes[i]!;
    const b = keyframes[i + 1]!;
    const at = toNumber(a.time);
    const bt = toNumber(b.time);
    if (time >= at && time <= bt) {
      const span = bt - at;
      const localT = span > 0 ? (time - at) / span : 0;
      const easedT = applyEasing(b.easing, localT);
      const av = toColor(a.value);
      const bv = toColor(b.value);
      return [
        av[0] + (bv[0] - av[0]) * easedT,
        av[1] + (bv[1] - av[1]) * easedT,
        av[2] + (bv[2] - av[2]) * easedT,
        av[3] + (bv[3] - av[3]) * easedT,
      ];
    }
  }

  return toColor(last.value);
}

/** True when every keyframe value parses as a color string. */
export function isColorKeyframes(keyframes: Keyframe[]): boolean {
  return (
    keyframes.length > 0 &&
    keyframes.every(
      (k) =>
        typeof k.value === 'string' &&
        (k.value.startsWith('#') || k.value.trim().startsWith('rgb')),
    )
  );
}

function toColor(v: unknown): RGBA {
  return parseColor(typeof v === 'string' ? v : undefined);
}

/**
 * Coerce a Keyframe.time or .value (which the schema allows as number or
 * string e.g. "1.5s") to a number. Non-numeric strings yield 0.
 */
function toNumber(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}
