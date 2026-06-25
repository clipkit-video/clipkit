// Pure frame math — kept dependency-free so editors (and probes) can
// share the exact quantization the engine uses.

/**
 * Frame-quantized step: the time of the frame `frames` away from the
 * frame containing `time`, clamped to [0, duration]. `frames` may be
 * negative. The current frame index is round(time × fps) — at exact
 * frame boundaries (the common editor case) this is exact; mid-frame
 * times snap to the nearest boundary before stepping, so repeated
 * single steps land on consecutive frames instead of drifting.
 */
export function stepFrameTime(
  time: number,
  fps: number,
  frames: number,
  duration: number,
): number {
  const safeFps = fps > 0 ? fps : 30;
  const index = Math.round(time * safeFps) + Math.round(frames);
  return Math.max(0, Math.min(duration, index / safeFps));
}
