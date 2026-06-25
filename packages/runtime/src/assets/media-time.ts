// Composition-time → media-time mapping for video (and video-audio)
// elements. ONE implementation shared by:
//   - runtime.prepareVideoFrames (WebCodecs decode path)
//   - runtime.renderAsync (element-backed export seeks)
//   - the playback engine's fallback <video> pump
//   - the audio scheduler / offline mixer (video audio tracks)
//
// Semantics:
//   - `trim_start` offsets into the media.
//   - `trim_duration` caps the playable media window (clamped to what
//     the media actually has after trim_start).
//   - `playback_rate` multiplies media consumption per timeline second.
//     Static number only — keyframed rates would make this an integral.
//   - `loop` wraps WITHIN the trim window; otherwise the last frame
//     holds (clamp just inside the window's end).
//   - `time_remap` (§5.3.2), when present, REPLACES all of the above:
//     the keyframe curve maps element-local time directly to media
//     time (clamped to the media), making speed ramps, freeze frames,
//     and reverse playback plain data.

import type { Keyframe } from '@clipkit/protocol';
import { interpolateKeyframes } from '../animation/keyframes.js';

export interface MediaTiming {
  /** Composition time the element becomes active, seconds. */
  elementStart: number;
  /** trim_start, seconds into the media. */
  trimStart: number;
  /** trim_duration, seconds of media after trimStart. null = to media end. */
  trimDuration: number | null;
  /** playback_rate. 1 = realtime. */
  rate: number;
  loop: boolean;
  /** time_remap keyframes (element-local time → media seconds), or null. */
  timeRemap?: Keyframe[] | null;
}

/** The playable media window [start, start+length] after trims. */
export function trimWindow(
  timing: Pick<MediaTiming, 'trimStart' | 'trimDuration'>,
  mediaDuration: number,
): { start: number; length: number } {
  const start = Math.max(0, timing.trimStart);
  const available = Math.max(0, mediaDuration - start);
  const length =
    timing.trimDuration != null
      ? Math.max(0, Math.min(timing.trimDuration, available))
      : available;
  return { start, length };
}

/**
 * Media time for a composition time. Returns a value inside the trim
 * window (wrapping when looping, clamping otherwise).
 */
export function mapToMediaTime(
  compositionTime: number,
  timing: MediaTiming,
  mediaDuration: number,
): number {
  // time_remap replaces the trim/rate/loop mapping entirely (§5.3.2).
  if (timing.timeRemap && timing.timeRemap.length > 0) {
    const local = Math.max(0, compositionTime - timing.elementStart);
    const t = interpolateKeyframes(timing.timeRemap, local);
    return Math.max(0, Math.min(t, Math.max(0, mediaDuration - 1e-4)));
  }
  const { start, length } = trimWindow(timing, mediaDuration);
  if (length <= 0) return start;
  const consumed = Math.max(0, compositionTime - timing.elementStart) * timing.rate;
  if (timing.loop) return start + (consumed % length);
  return start + Math.min(consumed, length - 1e-4);
}

/** Coerce a schema time_remap value (keyframe array or absent). */
export function timeRemapOf(value: unknown): Keyframe[] | null {
  return Array.isArray(value) && value.length > 0 ? (value as Keyframe[]) : null;
}

/** Coerce a schema playback_rate value (static number only). */
export function rateOf(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  return 1;
}

/** Coerce a schema trim_duration value. */
export function trimDurationOf(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  return null;
}
