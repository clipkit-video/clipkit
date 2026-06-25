// Public entry point. Anything imported as `@clipkit/playback` lives here.
//
// `TransportClock` is intentionally NOT exported. It's an internal
// collaborator the engine owns; the consumer never constructs one
// directly. See SPRINT.md for the rationale.

export { PlaybackEngine } from './engine.js';
export type {
  Backend,
  BufferStatus,
  EngineStats,
  PlaybackEngineOptions,
  Unsubscribe,
} from './types.js';

// Editor-facing additions (EDITORS-PLAN A3).
export { stepFrameTime } from './frame-math.js';
export { computeWaveformPeaks, extractWaveformPeaks } from './waveform.js';
export type { WaveformPeaks } from './waveform.js';
export type { AudioLevels, StereoPeak } from './audio.js';
