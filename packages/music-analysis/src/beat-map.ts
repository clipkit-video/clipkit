// The beat map — the intermediate artifact this package produces and the
// stable seam between audio analysis and motion authoring.
//
// Analysis (which DSP/ML approach, JS vs. a server-side analyzer) will churn;
// the motion side (AI agents, @clipkit/patterns helpers) reads ONLY this shape.
// Keep the two decoupled the way the importers keep `ir-types` between their
// parser and converter, so the analyzer can be rewritten without touching the
// authoring layer.
//
// This is AUTHORING-TIME data. It is deliberately NOT part of the Clipkit
// Protocol: the runtime never reads a beat map. A patterns helper consumes it
// and emits ordinary keyframes/expressions, so the rendered Source stays a pure,
// deterministic function of time with no audio dependency.
//
// ── Units ──────────────────────────────────────────────────────────────────
// ALL times are in SECONDS, matching the protocol's element `time` and keyframe
// `time`. (The AE importer's IR is in frames because AE is; here we line up with
// the Source directly, so a marker time drops straight into a keyframe.)

/** A musical event detected in the audio, at a point in time. */
export interface Marker {
  /** Time of the event, in seconds from the start of the audio. */
  time: number;
  /**
   * Relative salience of the event, 0..1. For onsets this is transient
   * strength; for beats/downbeats it is detection confidence. Authoring uses
   * it to scale accent magnitude — strong hits get bigger moves.
   */
  strength: number;
}

/** Frequency band an onset's energy is concentrated in. */
export type Band = 'low' | 'mid' | 'high';

/** A transient hit — a drum, a stab, a vocal onset. The "hit points" that
 *  discrete accents (punch, flash, shake) sync to. */
export interface Onset extends Marker {
  /** Dominant band of the transient — lets authoring route kicks vs. hats to
   *  different motions (bass → scale pulse, highs → shimmer). */
  band: Band;
}

/** A structural region of the track (intro / build / drop / verse / …). The
 *  unit at which scene changes and major reveals belong. */
export interface Section {
  /** Start time, seconds. */
  start: number;
  /** End time, seconds (== next section's start, or track end). */
  end: number;
  /**
   * Coarse label when the analyzer can infer one. Free-form on purpose — the
   * analyzer may only know boundaries, not names — so authoring should treat an
   * unknown label as "a boundary worth cutting on", not rely on the string.
   */
  label?: string;
  /** Mean energy of the region, 0..1. The jump between adjacent sections is the
   *  "drop" signal: a low region followed by a high one. */
  energy: number;
}

/**
 * The full analysis of one audio file. Start minimal — tempo + the event
 * tracks below cover Tier-1 tempo-pulse and Tier-2 accents. Add sampled band
 * envelopes (continuous drivers) only once a consumer needs them; an IR field
 * nothing reads is just maintenance.
 */
export interface BeatMap {
  /** Source audio URL or path this map was computed from. */
  source: string;
  /** Total duration of the audio, seconds. */
  duration: number;

  /** Estimated global tempo, beats per minute. */
  bpm: number;
  /**
   * Time of the first beat (beat 0), seconds. With `bpm` this defines the whole
   * grid: beat k ≈ phase + k·60/bpm. Tier-1 tempo-pulse needs only these two
   * numbers — a pure expression can breathe on the beat from them alone.
   */
  phase: number;

  /** Every detected beat (the full grid, including downbeats). */
  beats: Marker[];
  /** Beats that fall on bar boundaries — where the BIG moves go. */
  downbeats: Marker[];
  /** Transient hits, for discrete accents. */
  onsets: Onset[];
  /** Structural regions, for scene changes / major reveals. */
  sections: Section[];
}
