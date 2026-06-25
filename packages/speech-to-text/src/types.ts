// Core transcription types. Environment- and model-agnostic.
//
// The audio fed to the model is always 16 kHz mono PCM (Float32, samples in
// [-1, 1]) — Whisper's canonical input. How you GET there (ffmpeg in Node,
// WebAudio in the browser) is the only env-specific concern; see `./node` and
// `./browser`.

/** One transcribed word with absolute timings in the source audio. */
export interface TranscriptWord {
  text: string;
  /** Seconds from the start of the transcribed audio. */
  start: number;
  /** Seconds from the start of the transcribed audio. */
  end: number;
}

/** The result of transcribing an audio buffer. */
export interface TranscriptResult {
  /** The full transcript, untimed. */
  text: string;
  /** Word-level transcript with timings. */
  words: TranscriptWord[];
  /** Detected (or forced) BCP-47-ish language code, when the model reports one. */
  language?: string;
  /** Length of the transcribed audio, in seconds. */
  duration: number;
}

/** 16 kHz mono PCM — the canonical model input. */
export interface MonoAudio {
  /** Samples in [-1, 1]. */
  samples: Float32Array;
  /** Sample rate in Hz. MUST be 16000 for the model. */
  sampleRate: number;
}
