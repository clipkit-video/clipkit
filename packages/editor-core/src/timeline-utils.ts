// Pure helpers for the Timeline — time ↔ px math, layer listing,
// snapping, and overlap detection. No React, no DOM, no store.

import type { Element, Source } from '@clipkit/protocol';

// ── Element field accessors with defaults ──────────────────────────

export function elementTime(el: Element): number {
  return typeof el.time === 'number' ? el.time : 0;
}

export function elementLayer(el: Element): number {
  return typeof el.layer === 'number' ? el.layer : 1;
}

export function elementDuration(el: Element, sourceDuration: number): number {
  if (typeof el.duration === 'number') return el.duration;
  // 'auto' / 'end' / undefined → take what's left in the composition.
  return Math.max(0.1, sourceDuration - elementTime(el));
}

export function elementLabel(el: Element): string {
  if (el.type === 'text') {
    const t = (el as { text?: string }).text;
    return t ? t.slice(0, 28) : 'text';
  }
  if (el.type === 'shape') {
    const s = (el as { shape?: string }).shape;
    return s ?? 'shape';
  }
  if (el.type === 'image' || el.type === 'video' || el.type === 'audio') {
    const src = (el as { source?: string }).source;
    if (src) {
      const last = src.split('/').pop() ?? src;
      return last.slice(0, 24);
    }
    return el.type;
  }
  if (el.type === 'caption') return 'captions';
  if (el.type === 'group') {
    const n = ((el as { elements?: unknown[] }).elements?.length ?? 0);
    return `group · ${n}`;
  }
  return el.type;
}

// ── Layout: list used layers (ascending — layer 1 is the top row / on top) ──

export function listUsedLayers(source: Source): number[] {
  const set = new Set<number>();
  for (const el of source.elements) set.add(elementLayer(el));
  return Array.from(set).sort((a, b) => a - b);
}

// ── Edit-time layer invariant (correct-by-construction; NOT a load normalize) ──

/** A container's elements sorted FRONT-TO-BACK (layer ascending; layer 1 = front). */
export function byLayer<T extends Element>(elements: readonly T[]): T[] {
  return [...elements].sort((a, b) => elementLayer(a) - elementLayer(b));
}

/**
 * Stamp dense, unique `layer` values onto a container from its desired
 * FRONT-TO-BACK order: index 0 → layer 1 (front / on top), last → layer N.
 * Run on add / reorder / delete so the editor always writes valid, uniquely
 * layered sources — correct-by-construction at edit time, NOT a load pass.
 * Returns new element objects (all other fields untouched).
 */
export function reassignLayers<T extends Element>(frontToBack: readonly T[]): T[] {
  return frontToBack.map((el, i) => ({ ...el, layer: i + 1 }));
}

// ── Snap math ──────────────────────────────────────────────────────

/**
 * Snap `value` to the nearest target within `threshold`. Returns the
 * snapped value AND the target that won, so callers can render a
 * visual snap indicator. If no target wins, returns the input
 * unchanged with `target: null`.
 */
export function snapTo(
  value: number,
  targets: readonly number[],
  threshold: number,
): { value: number; target: number | null } {
  let bestTarget: number | null = null;
  let bestDist = threshold;
  for (const target of targets) {
    const dist = Math.abs(value - target);
    if (dist < bestDist) {
      bestDist = dist;
      bestTarget = target;
    }
  }
  if (bestTarget === null) return { value, target: null };
  return { value: bestTarget, target: bestTarget };
}

/**
 * Build the snap target list — composition bounds, the playhead, whole
 * seconds, and every non-dragged element's start + end. Recurses into
 * compositions.
 */
export function buildSnapTargets(
  source: Source,
  sourceDuration: number,
  excludeIds: ReadonlySet<string>,
  playhead: number,
): number[] {
  const targets: number[] = [0, sourceDuration, playhead];
  for (let s = 0; s <= Math.ceil(sourceDuration); s++) targets.push(s);
  collectElementEdges(source.elements, sourceDuration, excludeIds, targets);
  return targets;
}

function collectElementEdges(
  elements: readonly Element[],
  sourceDuration: number,
  excludeIds: ReadonlySet<string>,
  out: number[],
): void {
  for (const el of elements) {
    if (el.id && excludeIds.has(el.id)) continue;
    const t = elementTime(el);
    out.push(t, t + elementDuration(el, sourceDuration));
    if (el.type === 'group') {
      collectElementEdges(
        el.elements as readonly Element[],
        sourceDuration,
        excludeIds,
        out,
      );
    }
  }
}

// ── Overlap detection ──────────────────────────────────────────────

/**
 * Returns true if `[start, end)` on `layer` overlaps any non-excluded
 * element on the same layer. Used to reject invalid drops.
 */
export function hasOverlapOnLayer(
  source: Source,
  sourceDuration: number,
  layer: number,
  start: number,
  end: number,
  excludeIds: ReadonlySet<string>,
): boolean {
  for (const el of source.elements) {
    if (el.id && excludeIds.has(el.id)) continue;
    if (elementLayer(el) !== layer) continue;
    const elStart = elementTime(el);
    const elEnd = elStart + elementDuration(el, sourceDuration);
    if (start < elEnd && end > elStart) return true;
  }
  return false;
}

// ── Source duration (mirrors the engine's computeDuration) ─────────

export function computeSourceDuration(source: Source): number {
  if (typeof source.duration === 'number') return source.duration;
  let max = 0;
  for (const el of source.elements) {
    const t = elementTime(el);
    const d = typeof el.duration === 'number' ? el.duration : 0;
    if (t + d > max) max = t + d;
  }
  return max;
}

// ── Ruler ticks + time formatting ───────────────────────────────────
//
// Shared by every shell's ruler/readout so 100s-long sources stay
// readable at any zoom: the tick interval adapts to px-per-second and
// labels switch to m:ss (and h:mm:ss) once times leave the seconds
// range.

/** Candidate major-tick intervals, seconds. */
const TICK_STEPS = [
  0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200, 1800, 3600,
];

/**
 * Pick the smallest tick interval whose labels stay at least
 * `minLabelPx` apart at the current zoom. `minor` subdivides each
 * major span into 5 for unlabeled sub-ticks.
 */
export function chooseTickInterval(
  pxPerSec: number,
  minLabelPx = 64,
): { major: number; minor: number } {
  const major =
    TICK_STEPS.find((s) => s * pxPerSec >= minLabelPx) ??
    TICK_STEPS[TICK_STEPS.length - 1]!;
  return { major, minor: major / 5 };
}

/**
 * Format a time for display. The UNIT is chosen from `unitFor`
 * (default: the value itself) so a readout pair like "0:02.57 /
 * 1:46.00" stays in one consistent format — pass the larger value
 * (total duration) as `unitFor` for both sides.
 *
 *   < 60s   → "2.57s"
 *   < 1h    → "1:46.00"
 *   ≥ 1h    → "1:02:03.00"
 */
export function formatTimecode(t: number, unitFor: number = t): string {
  const v = Math.max(0, t);
  if (unitFor < 60) return `${v.toFixed(2)}s`;
  const h = Math.floor(v / 3600);
  const m = Math.floor((v % 3600) / 60);
  const ss = (v % 60).toFixed(2).padStart(5, '0');
  return unitFor < 3600 && h === 0
    ? `${m}:${ss}`
    : `${h}:${String(m).padStart(2, '0')}:${ss}`;
}

/**
 * Format a ruler tick label. Whole-unit display (no trailing
 * decimals): "5s" / "2.5s" below a minute, "1:30" / "1:02:30" above
 * (unit again chosen by `unitFor`, normally the source duration).
 */
export function formatTickLabel(
  t: number,
  unitFor: number = t,
  /** The tick interval. When sub-second, labels gain decimals so a
   * zoomed-in long composition shows 0.5s / 1:02.50 instead of
   * repeating whole seconds. */
  step = 1,
): string {
  const sub = step < 1;
  // Decimal places needed to represent the step exactly (0.5→1,
  // 0.25→2, 0.1→1, ≥1→0) so labels never round a tick to a wrong value.
  const dec = decimalPlaces(step);
  if (unitFor < 60) {
    return `${parseFloat(t.toFixed(dec))}s`;
  }
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const secRaw = t % 60;
  const s = sub
    ? secRaw.toFixed(dec).padStart(3 + dec, '0')
    : String(Math.round(secRaw)).padStart(2, '0');
  return unitFor < 3600 && h === 0
    ? `${m}:${s}`
    : `${h}:${String(m).padStart(2, '0')}:${s}`;
}

function decimalPlaces(n: number): number {
  const s = String(n);
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}
