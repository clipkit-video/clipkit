// analyzeAudio — audio in, beat map out. The real analyzer (see dsp.ts):
// decode → spectral-flux onsets + autocorrelation tempo/phase + energy-novelty
// sections. Deterministic: same bytes → same map.
//
// Decoding is WAV-only here (decode-wav.ts, no deps). For other containers
// (mp3/aac/…), decode upstream and pass `samples` + `sampleRate` via options —
// the DSP is container-agnostic. Tempo detection from raw audio lives here;
// when you already know the BPM, beatGrid() is the cheaper path.

import type { BeatMap } from './beat-map.js';
import { analyzePcm } from './dsp.js';
import { decodeWav } from './decode-wav.js';

export interface AnalyzeOptions {
  /** Decoded mono (or multi-channel) PCM. When given, `source` is only a label
   *  and no decoding happens. */
  samples?: Float32Array;
  /** Sample rate of `samples`, Hz. Required when `samples` is given. */
  sampleRate?: number;
  /** Beats per bar for downbeat spacing. Default 4. */
  beatsPerBar?: number;
}

async function loadWav(source: string): Promise<{ samples: Float32Array; sampleRate: number }> {
  let bytes: Uint8Array;
  if (/^https?:\/\//.test(source)) {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`analyzeAudio: fetch ${source} → ${res.status}`);
    bytes = new Uint8Array(await res.arrayBuffer());
  } else {
    // Local path — Node only (authoring-time tool).
    const { readFile } = await import('node:fs/promises');
    bytes = new Uint8Array(await readFile(source));
  }
  return decodeWav(bytes);
}

/**
 * Analyze an audio file (or raw PCM) into a {@link BeatMap}: detected `bpm`,
 * `phase`, the implied beat/downbeat grid, detected `onsets` (hits), and
 * energy-based `sections`. WAV files decode directly; for other formats pass
 * decoded `samples`/`sampleRate` via {@link AnalyzeOptions}.
 */
export async function analyzeAudio(
  source: string,
  options: AnalyzeOptions = {},
): Promise<BeatMap> {
  let samples: Float32Array;
  let sampleRate: number;
  if (options.samples) {
    samples = options.samples;
    sampleRate = options.sampleRate ?? 44100;
  } else {
    ({ samples, sampleRate } = await loadWav(source));
  }

  const a = analyzePcm(samples, sampleRate, options.beatsPerBar ?? 4);
  return {
    source,
    duration: Math.round((samples.length / sampleRate) * 1000) / 1000,
    bpm: a.bpm,
    phase: a.phase,
    beats: a.beats,
    downbeats: a.downbeats,
    onsets: a.onsets,
    sections: a.sections,
  };
}
