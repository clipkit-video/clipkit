// Master output limiter — a fixed, knob-less safety stage on the master bus,
// identical in preview (playback) and export (runtime mixer) so what you hear
// is what you render.
//
// It is TRANSPARENT below the ceiling: signal under the threshold passes at
// unity (Web Audio's DynamicsCompressorNode applies no makeup gain), so it
// only acts when the summed mix would otherwise clip past 0 dBFS — replacing
// ugly digital clipping with controlled limiting. This is an output-stage
// guarantee, NOT a document field: nothing here is serialized into the Source,
// and there are no per-element side effects (it sees only the final sum).
//
// Tradeoff: a DynamicsCompressorNode at ratio 20 is not a perfectly infinite
// brick-wall, but with -1 dB of headroom it keeps typical material comfortably
// under 0 dBFS without the lookahead cost of a custom limiter. Lean by design.

/** Threshold just below 0 dBFS — a hair of headroom before the ceiling. */
const THRESHOLD_DB = -1;
/** Hard knee — no soft transition, so quiet content stays untouched. */
const KNEE_DB = 0;
/** Steepest ratio Web Audio allows; effectively a limiter. */
const RATIO = 20;
/** Fast enough to catch transients without audible pumping. */
const ATTACK_S = 0.003;
const RELEASE_S = 0.1;

/**
 * Create the master limiter node. Works on both AudioContext (preview) and
 * OfflineAudioContext (export). Route the summed master gain through this,
 * then to the destination — and tap meters POST-limiter so they show what
 * you actually hear.
 */
export function createMasterLimiter(ctx: BaseAudioContext): DynamicsCompressorNode {
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = THRESHOLD_DB;
  limiter.knee.value = KNEE_DB;
  limiter.ratio.value = RATIO;
  limiter.attack.value = ATTACK_S;
  limiter.release.value = RELEASE_S;
  return limiter;
}
