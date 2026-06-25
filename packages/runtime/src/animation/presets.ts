// Named animation presets. The schema's `Animation` declares one of 16
// preset types (`fade-in`, `slide-up-in`, `scale-out`, …). At render time
// we compile each preset to one or more KeyframeAnimation-equivalent
// property tracks, applied over the animation's `duration` window at the
// animation's `time` ("start" | "end" | seconds).
//
// Pure function. The compositor calls compileAnimation once per element
// and pushes the resulting per-property tweens through the same
// keyframe-interpolation path as user keyframes.

import type { Animation, AnimationType, Easing, EasingFunction } from '@clipkit/protocol';

export interface PropertyTween {
  /** Element property being animated (e.g. 'opacity', 'x', 'scale'). */
  property: string;
  /** Animation start time, in seconds, relative to the element's `time`. */
  startTime: number;
  /** Animation duration, in seconds. */
  duration: number;
  /** Value at startTime. */
  from: number;
  /** Value at startTime + duration. */
  to: number;
  /** Easing applied across the tween. */
  easing: Easing;
  /**
   * If true, this tween's `from` should be added to whatever the static
   * property value is (e.g. slide-up-in starts 100px below the resting Y).
   * If false, the static value is overridden during the tween window.
   */
  relative: boolean;
  /**
   * Oscillation. When set, `from`/`to` define an amplitude ENVELOPE
   * (eased across the window) and the applied value is
   * `amplitude × sin(2π · frequency · t)`. Used by shake (decaying
   * envelope) and wiggle (constant envelope). Oscillating tweens are
   * always relative.
   */
  oscillate?: {
    frequency: number;
    /** Phase offset in radians (orbit's cos leg = π/2). */
    phase?: number;
    /** Drive with normative 1D value noise instead of sin (drift). */
    noise?: { seed: number };
  };
  /**
   * Fill-forward (CSS `animation-fill-mode: forwards`): after the tween
   * window ends, keep applying the `to` value instead of releasing back
   * to the static value. Used by shift, which translates and settles.
   */
  hold?: boolean;
  /**
   * Fill-backward (CSS `animation-fill-mode: backwards`): before the
   * tween window opens, hold the `from` value instead of releasing to
   * the static value. Set on entrance presets so a delayed `fade-in`
   * stays hidden at frame 0 rather than flashing its resting value and
   * popping back in when the window opens.
   */
  fillBackwards?: boolean;
}

const DEFAULT_DURATION = 0.5;
const DEFAULT_EASING: EasingFunction = 'ease-out';

interface PresetSpec {
  property: string;
  /** Start delta — added to static value for `relative: true` tweens. */
  fromDelta: number;
  /** End delta. */
  toDelta: number;
  relative: boolean;
  /** Override easing; falls back to animation.easing or DEFAULT_EASING. */
  defaultEasing?: EasingFunction;
}

// Slide-in convention follows animate.css / Framer Motion:
//   - Horizontal: slide-left-in starts on the LEFT, moves right into position;
//     slide-right-in starts on the RIGHT, moves left into position.
//   - Vertical: slide-up-in means motion direction is UP — the element starts
//     BELOW its resting position and rises up. slide-down-in starts ABOVE.
//   - Slide-out matches motion direction: slide-up-out moves UP (off the top),
//     slide-down-out moves DOWN (off the bottom).
// Static, parameter-free presets. The dynamic presets (spin, shake,
// wiggle, squash, pan, shift) are compiled in compileDynamicPreset.
const PRESETS: Partial<Record<AnimationType, PresetSpec[]>> = {
  'fade-in':        [{ property: 'opacity', fromDelta: 0, toDelta: 1, relative: false }],
  'fade-out':       [{ property: 'opacity', fromDelta: 1, toDelta: 0, relative: false }],
  'slide-left-in':  [{ property: 'x',       fromDelta: -200, toDelta: 0, relative: true }],
  'slide-right-in': [{ property: 'x',       fromDelta:  200, toDelta: 0, relative: true }],
  'slide-up-in':    [{ property: 'y',       fromDelta:  200, toDelta: 0, relative: true }],
  'slide-down-in':  [{ property: 'y',       fromDelta: -200, toDelta: 0, relative: true }],
  'slide-left-out': [{ property: 'x',       fromDelta: 0, toDelta: -200, relative: true }],
  'slide-right-out':[{ property: 'x',       fromDelta: 0, toDelta:  200, relative: true }],
  'slide-up-out':   [{ property: 'y',       fromDelta: 0, toDelta: -200, relative: true }],
  'slide-down-out': [{ property: 'y',       fromDelta: 0, toDelta:  200, relative: true }],
  'scale-in':       [{ property: 'scale',   fromDelta: 0,   toDelta: 1, relative: false }],
  'scale-out':      [{ property: 'scale',   fromDelta: 1,   toDelta: 0, relative: false }],
  'rotate-in':      [{ property: 'rotation',fromDelta: -90, toDelta: 0, relative: true }],
  'rotate-out':     [{ property: 'rotation',fromDelta: 0,   toDelta: 90, relative: true }],
  'bounce-in':      [{ property: 'scale',   fromDelta: 0,   toDelta: 1, relative: false, defaultEasing: 'ease-out-back' }],
  'bounce-out':     [{ property: 'scale',   fromDelta: 1,   toDelta: 0, relative: false, defaultEasing: 'ease-in-back' }],
};

// Presets whose natural reading is "for the whole element" — when both
// `time` and `duration` are omitted they span the element's full duration
// instead of the 0.5s accent default.
const FULL_LENGTH_TYPES = new Set<AnimationType>(['spin', 'shake', 'wiggle', 'pan', 'drift', 'breathe', 'orbit']);

/**
 * Compile a schema Animation into per-property tweens.
 *
 * @param animation       The schema Animation declaration.
 * @param elementDuration Total visible duration of the element (seconds).
 *                        Used to resolve `time: "end"` to a concrete number.
 */
export function compileAnimation(
  animation: Animation,
  elementDuration: number,
): PropertyTween[] {
  const fullLength =
    FULL_LENGTH_TYPES.has(animation.type) &&
    animation.duration == null &&
    animation.time == null;
  const duration = fullLength
    ? elementDuration
    : animation.duration ?? DEFAULT_DURATION;
  const easing = animation.easing ?? DEFAULT_EASING;

  let startTime: number;
  if (animation.time === 'start' || animation.time == null) {
    startTime = 0;
  } else if (animation.time === 'end') {
    startTime = Math.max(0, elementDuration - duration);
  } else {
    startTime = animation.time;
  }

  const dynamic = compileDynamicPreset(animation, startTime, duration);
  if (dynamic) return dynamic;

  const specs = PRESETS[animation.type];
  if (!specs) return [];

  // Entrance presets (`*-in`) fill backwards: before their window opens
  // they hold the hidden/off-screen `from` value, so a delayed entrance
  // doesn't flash the resting value at frame 0. Exits and oscillators
  // release to the static value before they start, as before.
  const fillBackwards = animation.type.endsWith('-in');

  return specs.map((spec) => ({
    property: spec.property,
    startTime,
    duration,
    from: spec.fromDelta,
    to: spec.toDelta,
    easing: spec.defaultEasing ?? easing,
    relative: spec.relative,
    fillBackwards,
  }));
}

/** Direction → axis/sign for pan and shift. */
function directionVector(direction: Animation['direction']): { property: 'x' | 'y'; sign: number } {
  switch (direction) {
    case 'left': return { property: 'x', sign: -1 };
    case 'up':   return { property: 'y', sign: -1 };
    case 'down': return { property: 'y', sign: 1 };
    case 'right':
    default:     return { property: 'x', sign: 1 };
  }
}

/**
 * Presets that depend on the Animation's parameters (frequency, rotation,
 * distance, direction, scale) and so can't live in the static PRESETS
 * table. Returns null for table-driven types.
 */
function compileDynamicPreset(
  animation: Animation,
  startTime: number,
  duration: number,
): PropertyTween[] | null {
  const easing = animation.easing ?? 'linear';

  switch (animation.type) {
    case 'spin': {
      // Rotate by `rotation` degrees (default one full turn) on top of
      // the element's static rotation.
      const total = animation.rotation ?? 360;
      return [{
        property: 'rotation', startTime, duration,
        from: 0, to: total, easing, relative: true,
      }];
    }
    case 'shake': {
      // Horizontal jitter with a decaying amplitude envelope.
      const amplitude = animation.distance ?? 24;
      return [{
        property: 'x', startTime, duration,
        from: amplitude, to: 0, easing, relative: true,
        oscillate: { frequency: animation.frequency ?? 8 },
      }];
    }
    case 'wiggle': {
      // Rotational wobble at constant amplitude.
      const amplitude = animation.rotation ?? 8;
      return [{
        property: 'rotation', startTime, duration,
        from: amplitude, to: amplitude, easing, relative: true,
        oscillate: { frequency: animation.frequency ?? 2 },
      }];
    }
    case 'drift': {
      // Seeded smooth random walk (§6.2): offsets are centered
      // normative 1D value noise — organic, deterministic float.
      const amplitude = animation.distance ?? 30;
      const f = animation.frequency ?? 0.5;
      const seed = Math.max(0, Math.round(animation.seed ?? 0));
      return [
        {
          property: 'x', startTime, duration,
          from: amplitude, to: amplitude, easing: 'linear', relative: true,
          oscillate: { frequency: f, noise: { seed } },
        },
        {
          property: 'y', startTime, duration,
          from: amplitude, to: amplitude, easing: 'linear', relative: true,
          oscillate: { frequency: f, noise: { seed: seed + 7919 } },
        },
      ];
    }
    case 'breathe': {
      // Gentle scale oscillation: scale × (1 + amp·sin(2πft)).
      const amp = animation.scale ?? 0.05;
      return [{
        property: 'scale', startTime, duration,
        from: amp, to: amp, easing: 'linear', relative: true,
        oscillate: { frequency: animation.frequency ?? 0.4 },
      }];
    }
    case 'orbit': {
      // Circular position motion: x += r·cos(2πft), y += ±r·sin(2πft).
      const r = animation.distance ?? 40;
      const f = animation.frequency ?? 0.5;
      const ccw = animation.direction === 'left';
      return [
        {
          property: 'x', startTime, duration,
          from: r, to: r, easing: 'linear', relative: true,
          oscillate: { frequency: f, phase: Math.PI / 2 },
        },
        {
          property: 'y', startTime, duration,
          from: ccw ? -r : r, to: ccw ? -r : r, easing: 'linear', relative: true,
          oscillate: { frequency: f },
        },
      ];
    }
    case 'squash': {
      // Squash & stretch accent: y compresses by `scale` while x bulges
      // by ~60% of the depth, then both recover in the second half.
      const depth = animation.scale ?? 0.3;
      const half = duration / 2;
      const mid = startTime + half;
      const bulge = depth * 0.6;
      return [
        { property: 'y_scale', startTime, duration: half, from: 1, to: 1 - depth, easing: 'ease-in-quad', relative: false },
        { property: 'y_scale', startTime: mid, duration: half, from: 1 - depth, to: 1, easing: 'ease-out-back', relative: false },
        { property: 'x_scale', startTime, duration: half, from: 1, to: 1 + bulge, easing: 'ease-in-quad', relative: false },
        { property: 'x_scale', startTime: mid, duration: half, from: 1 + bulge, to: 1, easing: 'ease-out-back', relative: false },
      ];
    }
    case 'pan': {
      // Centered drift: travels `distance` px through the resting
      // position (Ken Burns-style when run full-length).
      const dist = animation.distance ?? 200;
      const { property, sign } = directionVector(animation.direction);
      return [{
        property, startTime, duration,
        from: (-dist / 2) * sign, to: (dist / 2) * sign, easing, relative: true,
      }];
    }
    case 'shift': {
      // One-shot translation by `distance` px that settles at the
      // shifted position for the rest of the element's life (hold).
      const dist = animation.distance ?? 200;
      const { property, sign } = directionVector(animation.direction);
      return [{
        property, startTime, duration,
        from: 0, to: dist * sign,
        easing: animation.easing ?? DEFAULT_EASING, relative: true,
        hold: true,
      }];
    }
    default:
      return null;
  }
}
