// Varispeed audio under warped clocks (§5.3.2 / §5.8.3).
//
// When a sound element sits under group time_remap (or carries video
// time_remap itself), its media position is a piecewise function of
// REAL composition time. Rather than algebra over nested keyframe
// chains, the reference implementation SAMPLES the effective
// media-time function at 10 ms, splits it into monotonic runs, and
// schedules each run on an AudioBufferSourceNode:
//
//   forward  — start(t0, offset m(t0)); playbackRate follows the
//              sampled derivative via setValueCurveAtTime (tape-style
//              pitch: 2× plays high, slow-mo plays low)
//   freeze   — silence (the tape isn't moving)
//   backward — a cached REVERSED copy of the buffer plays forward at
//              |dm/dt|, which is reversed audio at the right speed
//
// Pitch-preserving time-stretch is deliberately out of scope (no
// exactly-specifiable algorithm).

/** Sampling interval for the media-time function, seconds. */
export const VARISPEED_STEP = 0.01;
/** Below this |Δmedia/Δt| a sample step counts as frozen. */
const FREEZE_EPS = 0.02;

export interface VarispeedRun {
  /** Composition-time window of the run. */
  t0: number;
  t1: number;
  /** Media position at each 10 ms sample inside [t0, t1]. */
  media: number[];
  direction: 'forward' | 'backward';
}

/**
 * Split a sampled media-time function into monotonic runs. `mediaAt`
 * returns the media position at a real composition time, or null when
 * the element is inactive (outside its own or an ancestor's window).
 */
export function varispeedRuns(
  mediaAt: (t: number) => number | null,
  start: number,
  end: number,
): VarispeedRun[] {
  const runs: VarispeedRun[] = [];
  let cur: VarispeedRun | null = null;
  let prev: number | null = null;

  for (let t = start; t <= end + 1e-9; t += VARISPEED_STEP) {
    const m = mediaAt(t);
    const step = prev !== null && m !== null ? (m - prev) / VARISPEED_STEP : null;
    const dir: 'forward' | 'backward' | 'freeze' | null =
      step === null ? null : step > FREEZE_EPS ? 'forward' : step < -FREEZE_EPS ? 'backward' : 'freeze';

    if (dir === 'forward' || dir === 'backward') {
      if (cur && cur.direction === dir) {
        cur.media.push(m!);
        cur.t1 = t;
      } else {
        if (cur && cur.media.length > 1) runs.push(cur);
        cur = { t0: t - VARISPEED_STEP, t1: t, media: [prev!, m!], direction: dir };
      }
    } else {
      if (cur && cur.media.length > 1) runs.push(cur);
      cur = null;
    }
    prev = m;
  }
  if (cur && cur.media.length > 1) runs.push(cur);
  return runs;
}

/** Reversed copies, keyed by the original buffer (per-mix lifetime). */
const reversedCache = new WeakMap<AudioBuffer, AudioBuffer>();

function reversedBuffer(ctx: BaseAudioContext, buffer: AudioBuffer): AudioBuffer {
  const hit = reversedCache.get(buffer);
  if (hit) return hit;
  const rev = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch);
    const dst = rev.getChannelData(ch);
    for (let i = 0, n = src.length; i < n; i++) dst[i] = src[n - 1 - i]!;
  }
  reversedCache.set(buffer, rev);
  return rev;
}

/**
 * Schedule one varispeed run. Returns the created source node (caller
 * may track it for cancellation in live contexts).
 */
export function scheduleVarispeedRun(
  ctx: BaseAudioContext,
  buffer: AudioBuffer,
  run: VarispeedRun,
  destination: AudioNode,
  /** AudioContext time corresponding to composition time run.t0. */
  when: number,
  gain: number,
): AudioBufferSourceNode {
  const node = ctx.createBufferSource();
  const dur = run.t1 - run.t0;
  const n = run.media.length;

  // Rate curve: |Δmedia| per step, one value per sample interval.
  const rates = new Float32Array(Math.max(2, n - 1));
  for (let i = 0; i < n - 1; i++) {
    rates[i] = Math.max(0.001, Math.abs(run.media[i + 1]! - run.media[i]!) / VARISPEED_STEP);
  }
  if (n - 1 === 1) rates[1] = rates[0]!;

  const m0 = run.media[0]!;
  const mEnd = run.media[n - 1]!;
  const mediaSpan = Math.abs(mEnd - m0);

  if (run.direction === 'forward') {
    node.buffer = buffer;
    node.playbackRate.setValueCurveAtTime(rates, when, dur);
    const g = ctx.createGain();
    g.gain.value = gain;
    node.connect(g).connect(destination);
    node.start(when, Math.max(0, Math.min(m0, buffer.duration)), mediaSpan);
  } else {
    const rev = reversedBuffer(ctx, buffer);
    node.buffer = rev;
    node.playbackRate.setValueCurveAtTime(rates, when, dur);
    const g = ctx.createGain();
    g.gain.value = gain;
    node.connect(g).connect(destination);
    // Media position p lives at reversed offset (duration − p).
    node.start(when, Math.max(0, Math.min(buffer.duration - m0, buffer.duration)), mediaSpan);
  }
  return node;
}
