// beat-sync — turn a BeatMap into motion.
//
// This is the MAPPING layer. @clipkit/music-analysis produces the facts (where
// the beats are); these helpers turn them into ordinary keyframes / pure
// expressions that drop onto any element. Nothing here reaches the runtime as a
// new concept — the output is plain protocol data, so renders stay deterministic
// with no audio dependency. (The agent supplies the taste: WHICH element gets
// WHICH accent.)
//
// Two tiers, matching the architecture:
//   • pulseToTempo  — Tier 1: a pure expression that breathes on the beat from
//                     just bpm + phase. Cheap, continuous, no per-beat data.
//   • accentOnBeats — Tier 2: keyframes that punch a property on each detected
//                     beat (or downbeat), with anticipation and settle.

import type { BeatMap, Marker } from '@clipkit/music-analysis';
import type { Easing, Keyframe, KeyframeAnimation } from '@clipkit/protocol';

const round = (n: number): number => Math.round(n * 1000) / 1000;

// ── Tier 1: tempo-parametric pulse ───────────────────────────────────────────

export interface PulseToTempoOptions {
  /** Resting value (the property's baseline). Default 1. */
  baseline?: number;
  /** Height of each beat pulse, added to `baseline`. Default 0.08. */
  amp?: number;
  /** How sharply each pulse decays before the next beat — higher = snappier,
   *  more percussive. Default 6. */
  decay?: number;
  /** Pulses per beat. 2 = eighth-notes, 0.5 = every other beat. Default 1. */
  subdivision?: number;
}

/**
 * A pure Tier-A expression that pulses on the beat — a sharp rise exactly on
 * each beat that decays before the next. Needs only `bpm` + `phase`, so it works
 * off a synthesized {@link beatGrid} as happily as a detected map. Drop the
 * result on any numeric property (`scale`, `opacity`, `blur_radius`, …):
 *
 * ```ts
 * { ...logo, scale: pulseToTempo(map, { amp: 0.06 }) }
 * ```
 */
export function pulseToTempo(
  map: BeatMap,
  opts: PulseToTempoOptions = {},
): { expr: string } {
  const baseline = opts.baseline ?? 1;
  const amp = opts.amp ?? 0.08;
  const decay = opts.decay ?? 6;
  const rate = round((map.bpm / 60) * (opts.subdivision ?? 1)); // pulses/sec
  const phase = round(map.phase);
  // fract((t - phase)·rate) is the saw 0→1 across each pulse; exp(-decay·saw)
  // is 1 at the beat, decaying after → a percussive pump.
  return {
    expr: `${round(baseline)} + ${round(amp)}*exp(-${round(decay)}*fract((t-${phase})*${rate}))`,
  };
}

// ── Tier 2: event-baked accents ──────────────────────────────────────────────

export interface AccentOnBeatsOptions {
  /** Property to drive. Default "scale". */
  property?: string;
  /** Sync to every beat or only bar downbeats. Default "beats". */
  on?: 'beats' | 'downbeats';
  /** Resting value between hits. Default 1. */
  base?: number;
  /** Peak offset from `base` at full strength. The actual peak scales with each
   *  marker's `strength`, so downbeats hit harder. Default 0.18. */
  amp?: number;
  /** Anticipation lead-in before the hit, seconds. Default 0.05. */
  attack?: number;
  /** Time to ease back to `base` after the hit, seconds. Default 0.2. */
  settle?: number;
  /** Easing for both the rise and the settle. Default "ease-out-cubic". */
  easing?: Easing;
  /** Ignore markers weaker than this (0..1). Default 0 (all). */
  minStrength?: number;
}

/**
 * Keyframes that punch a property on each beat — the discrete "hit" sync. Each
 * marker gets an anticipation keyframe, a peak ON the beat (scaled by the
 * marker's strength so downbeats land bigger), and a settle back to rest.
 *
 * Returns one {@link KeyframeAnimation}; push it onto an element's
 * `keyframe_animations`. Times are in the element's local seconds — put the
 * accented element at `time: 0` so they line up with the beat map's clock.
 *
 * ```ts
 * { ...title, keyframe_animations: [accentOnBeats(map, { on: 'downbeats', amp: 0.22 })] }
 * ```
 */
export function accentOnBeats(
  map: BeatMap,
  opts: AccentOnBeatsOptions = {},
): KeyframeAnimation {
  const property = opts.property ?? 'scale';
  const base = opts.base ?? 1;
  const amp = opts.amp ?? 0.18;
  const easing = opts.easing ?? 'ease-out-cubic';
  const minStrength = opts.minStrength ?? 0;
  const markers: Marker[] = opts.on === 'downbeats' ? map.downbeats : map.beats;

  // Keep the rise + settle inside one beat so adjacent accents never collide.
  const interval = map.bpm > 0 ? 60 / map.bpm : Infinity;
  const attack = Math.min(opts.attack ?? 0.05, interval * 0.3);
  const settle = Math.min(opts.settle ?? 0.2, interval * 0.6);

  const keyframes: Keyframe[] = [];
  let lastTime = -Infinity;
  // Push only if it keeps times strictly increasing and non-negative, so the
  // sequence stays monotonic even for a beat sitting exactly at t=0.
  const push = (time: number, value: number): void => {
    const t = round(time);
    if (t < 0 || t <= lastTime) return;
    keyframes.push({ time: t, value: round(value), easing });
    lastTime = t;
  };

  for (const m of markers) {
    if (m.strength < minStrength) continue;
    // Anticipation seat at rest just before the hit (keeps the value flat
    // between beats instead of ramping up across the whole gap), then the peak
    // ON the beat, then the settle back to rest.
    push(m.time - attack, base);
    push(m.time, base + amp * m.strength);
    push(m.time + settle, base);
  }

  // Seed a resting keyframe at t=0 so the value holds at `base` before the
  // first hit (unless a beat already owns t=0).
  if (keyframes.length === 0 || keyframes[0]!.time !== 0) {
    keyframes.unshift({ time: 0, value: round(base), easing });
  }

  return { property, keyframes };
}

// ── Tier 2 (transitions): land MOTION EVENTS on the beat ─────────────────────
// This is the heart of "hit-syncing": entrances, exits, and screen-to-screen
// cuts whose moment of impact lands ON a beat. Unlike pulseToTempo (continuous,
// for music-visualizer pulsing), these sync the EVENTS a piece already needs —
// a logo arriving, a list ticking in, a screen changing — and otherwise leave
// the element still. They return plain {expr} / numbers (protocol values), so
// they drop straight onto an element's opacity / x / y.

/** Snap a time (seconds) to the nearest beat — or downbeat — in the map, so an
 *  authored moment locks to the grid instead of drifting near it. */
export function snapToBeat(
  map: BeatMap,
  t: number,
  which: 'beat' | 'downbeat' = 'beat',
): number {
  const markers = which === 'downbeat' ? map.downbeats : map.beats;
  let best = t;
  let bestD = Infinity;
  for (const m of markers) {
    const d = Math.abs(t - m.time);
    if (d < bestD) {
      best = m.time;
      bestD = d;
    }
  }
  return best;
}

export interface RevealOnBeatOptions {
  /** Fade-in seconds; the reveal is fully present ON `enter`. Default 0.28. */
  fadeIn?: number;
  /** Beat time to clear at; omit to stay to the end. */
  exit?: number;
  /** Fade-out seconds. Default 0.28. */
  fadeOut?: number;
}

/**
 * Opacity {expr} that is fully present ON beat `enter` and (optionally) fully
 * CLEARED by beat `exit` — both edges land on a beat. On a shared boundary the
 * old screen is gone exactly as the new one arrives: a clean cut, not a muddy
 * overlap. Pair with {@link slideOnBeat} for a slide arriving on the same beat.
 */
export function revealOnBeat(enter: number, opts: RevealOnBeatOptions = {}): { expr: string } {
  const fi = opts.fadeIn ?? 0.28;
  const inExpr = `linear(t,${round(enter - fi)},${round(enter)},0,1)`;
  if (opts.exit == null) return { expr: inExpr };
  const fo = opts.fadeOut ?? 0.28;
  return { expr: `(${inExpr} - linear(t,${round(opts.exit - fo)},${round(opts.exit)},0,1))` };
}

export interface SlideOnBeatOptions {
  /** Start offset in px (element begins this far from `target`). Default 60. */
  from?: number;
  /** Travel seconds; the slide ARRIVES on `enter`. Default 0.45. */
  dur?: number;
  /** Beat time to push back out; omit to stay put. */
  exit?: number;
  /** Exit offset px (default = `from`) and seconds (default 0.4). */
  exitTo?: number;
  exitDur?: number;
}

/**
 * A coordinate {expr} for a slide that ARRIVES at `target` px on beat `enter`
 * (coming from `target + from`), and optionally pushes back out so it has fully
 * left BY beat `exit`. Use directly as an element's `x` or `y`. The arrival/
 * departure — not a wobble — is the sync, so it reads on the beat without
 * distracting while the element rests.
 */
export function slideOnBeat(
  target: number,
  enter: number,
  opts: SlideOnBeatOptions = {},
): { expr: string } {
  const from = opts.from ?? 60;
  const dur = opts.dur ?? 0.45;
  let expr = `${round(target)} + ${round(from)}*(1 - ease(t,${round(enter - dur)},${round(enter)},0,1))`;
  if (opts.exit != null) {
    const exitTo = opts.exitTo ?? from;
    const exitDur = opts.exitDur ?? 0.4;
    // push completes BY the exit beat (window ends on it) — leaves on the beat
    expr += ` + ${round(exitTo)}*ease(t,${round(opts.exit - exitDur)},${round(opts.exit)},0,1)`;
  }
  return { expr };
}
