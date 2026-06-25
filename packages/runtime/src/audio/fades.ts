// Audio fade envelope — ONE piecewise-linear definition shared by the
// preview scheduler (realtime GainNode ramps) and the export mixer
// (OfflineAudioContext ramps), so preview and export are gain-identical.
//
// The envelope runs in TIMELINE seconds over the element's visible
// window [0, trackLength]:
//
//   g(τ) = min(1, τ / fade_in) × min(1, (trackLength − τ) / fade_out)
//
// (each factor is 1 when its fade is 0/absent). When the fades don't
// overlap, g is piecewise linear and ramping between its corner points
// reproduces it exactly; when fade_in + fade_out > trackLength the
// overlap region is quadratic and the linear ramps are a close
// approximation through the same corners. fadeBreakpoints returns the
// corners from a given starting offset, ready for setValueAtTime +
// linearRampToValueAtTime.

export interface FadePoint {
  /** Timeline seconds since the element became active. */
  tau: number;
  /** Envelope gain in [0, 1] (multiply with the element's volume gain). */
  gain: number;
}

/** Envelope value at timeline offset τ. */
export function fadeGainAt(
  tau: number,
  trackLength: number,
  fadeIn: number,
  fadeOut: number,
): number {
  let g = 1;
  if (fadeIn > 0) g *= Math.min(1, Math.max(0, tau / fadeIn));
  if (fadeOut > 0) g *= Math.min(1, Math.max(0, (trackLength - tau) / fadeOut));
  return g;
}

/**
 * Corner points of the envelope from `startTau` (inclusive) through the
 * end of the track. The first point is the value AT startTau (for
 * setValueAtTime); subsequent points are linearRamp targets. When both
 * fades are 0 the result is a single constant point.
 */
export function fadeBreakpoints(
  startTau: number,
  trackLength: number,
  fadeIn: number,
  fadeOut: number,
): FadePoint[] {
  const corners = new Set<number>([startTau, trackLength]);
  if (fadeIn > 0) corners.add(Math.min(fadeIn, trackLength));
  if (fadeOut > 0) corners.add(Math.max(0, trackLength - fadeOut));

  return [...corners]
    .filter((tau) => tau >= startTau)
    .sort((a, b) => a - b)
    .map((tau) => ({ tau, gain: fadeGainAt(tau, trackLength, fadeIn, fadeOut) }));
}
