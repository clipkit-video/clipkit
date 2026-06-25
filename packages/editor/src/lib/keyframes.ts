// Shared keyframe-at-playhead logic (inspector diamond + timeline
// lane rows). All edits are literal keyframe_animations writes;
// insertion samples through the runtime's NORMATIVE applyEasing so a
// new keyframe sits exactly on the existing curve.

import { applyEasing } from '@clipkit/runtime';
import type { Element, Keyframe, KeyframeAnimation } from '@clipkit/protocol';

/** Find an element by id, descending into groups. */
export function findElementById(
  elements: readonly Element[],
  id: string,
): Element | null {
  for (const el of elements) {
    if (el.id === id) return el;
    if (el.type === 'group') {
      const nested = findElementById(el.elements as readonly Element[], id);
      if (nested) return nested;
    }
  }
  return null;
}

/** "On a keyframe" tolerance, seconds. */
export const KF_EPS = 0.05;

export const kfTime = (k: Keyframe): number =>
  typeof k.time === 'number' ? k.time : parseFloat(String(k.time)) || 0;

const round3 = (v: number): number => Math.round(v * 1000) / 1000;

/** Is there a keyframe within KF_EPS of this element-local time? */
export function isOnKeyframe(anim: KeyframeAnimation, local: number): boolean {
  return anim.keyframes.some((k) => Math.abs(kfTime(k) - local) <= KF_EPS);
}

/**
 * Sample the animation's value at an element-local time via the
 * normative evaluator (scalars exact; arrays componentwise — position
 * tangent curves are refined in the curve editor).
 */
export function sampleAnimation(
  anim: KeyframeAnimation,
  local: number,
): Keyframe['value'] {
  const sorted = [...anim.keyframes].sort((a, b) => kfTime(a) - kfTime(b));
  if (sorted.length === 0) return 0;
  if (local <= kfTime(sorted[0]!)) return sorted[0]!.value;
  const last = sorted[sorted.length - 1]!;
  if (local >= kfTime(last)) return last.value;
  const bi = sorted.findIndex((k) => kfTime(k) > local);
  const a = sorted[bi - 1]!;
  const b = sorted[bi]!;
  const p = (local - kfTime(a)) / (kfTime(b) - kfTime(a));
  if (typeof a.value === 'number' && typeof b.value === 'number') {
    return round3(a.value + (b.value - a.value) * applyEasing(b.easing, p));
  }
  if (Array.isArray(a.value) && Array.isArray(b.value)) {
    const eased = applyEasing(b.easing, p);
    return a.value.map((av, i) =>
      round3(av + (((b.value as number[])[i] ?? av) - av) * eased),
    ) as Keyframe['value'];
  }
  return a.value;
}

/**
 * Toggle a keyframe at an element-local time on animation `animIndex`.
 * On a keyframe → splice it (removing the last keyframe removes the
 * whole entry); otherwise → insert one sampled from the curve.
 * Returns the next keyframe_animations array, or undefined when the
 * last entry was removed (byte-clean documents).
 */
/**
 * Write a VALUE into the keyframe at an element-local time: replaces
 * the value when the playhead sits on a keyframe, otherwise inserts a
 * new keyframe there (AE-style auto-key for animated properties).
 */
export function setKeyframeValueAt(
  anims: readonly KeyframeAnimation[],
  animIndex: number,
  local: number,
  value: Keyframe['value'],
): KeyframeAnimation[] {
  const anim = anims[animIndex];
  if (!anim) return [...anims];
  const hit = anim.keyframes.findIndex((k) => Math.abs(kfTime(k) - local) <= KF_EPS);
  const keyframes =
    hit >= 0
      ? anim.keyframes.map((k, i) => (i === hit ? { ...k, value } : k))
      : [...anim.keyframes, { time: round3(local), value }].sort(
          (a, b) => kfTime(a) - kfTime(b),
        );
  return anims.map((a, i) => (i === animIndex ? { ...a, keyframes } : a));
}

export function toggleKeyframeAt(
  anims: readonly KeyframeAnimation[],
  animIndex: number,
  local: number,
): KeyframeAnimation[] | undefined {
  const anim = anims[animIndex];
  if (!anim) return [...anims];
  const hit = anim.keyframes.findIndex((k) => Math.abs(kfTime(k) - local) <= KF_EPS);
  if (hit >= 0) {
    const remaining = anim.keyframes.filter((_, i) => i !== hit);
    if (remaining.length === 0) {
      const next = anims.filter((_, i) => i !== animIndex);
      return next.length > 0 ? next : undefined;
    }
    return anims.map((a, i) => (i === animIndex ? { ...a, keyframes: remaining } : a));
  }
  const inserted = [...anim.keyframes, { time: round3(local), value: sampleAnimation(anim, local) }].sort(
    (a, b) => kfTime(a) - kfTime(b),
  );
  return anims.map((a, i) => (i === animIndex ? { ...a, keyframes: inserted } : a));
}
