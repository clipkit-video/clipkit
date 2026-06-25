// beatGrid — synthesize a BeatMap from a KNOWN tempo.
//
// Tempo detection from raw audio is the analyzer's job (see analyze.ts) and is
// still ahead of us. But the moment you know the BPM — and you very often do
// (the track's metadata, a creator who typed it in, a loop at a fixed tempo) —
// the entire grid is determined: beat k sits at `phase + k·60/bpm`. This builds
// that grid as a real, fully-formed BeatMap, so motion can be synced to music
// today while the detector is built behind the same BeatMap contract.
//
// Deterministic and pure: same options → same map.

import type { BeatMap, Marker } from './beat-map.js';

export interface BeatGridOptions {
  /** Tempo, beats per minute. Must be > 0. */
  bpm: number;
  /** Total span to fill with beats, seconds. */
  duration: number;
  /** Time of beat 0, seconds. Default 0. */
  phase?: number;
  /** Beats per bar — a downbeat lands every Nth beat from beat 0. Default 4. */
  beatsPerBar?: number;
  /** Label recorded as the map's `source`. Default "synthetic:bpm". */
  source?: string;
}

/**
 * Build a {@link BeatMap} from a known tempo. Populates `bpm`, `phase`,
 * `beats`, and `downbeats`; `onsets` and `sections` are left empty (those need
 * real audio analysis). The first beat at or after `phase` is beat 0, and every
 * `beatsPerBar`-th beat from there is a downbeat.
 */
export function beatGrid(opts: BeatGridOptions): BeatMap {
  const { bpm, duration } = opts;
  const phase = opts.phase ?? 0;
  const beatsPerBar = opts.beatsPerBar ?? 4;
  if (!(bpm > 0)) throw new RangeError(`beatGrid: bpm must be > 0, got ${bpm}`);

  const interval = 60 / bpm; // seconds per beat
  const beats: Marker[] = [];
  const downbeats: Marker[] = [];

  // Beat 0 is the first beat at or after `phase`; index counts from there so
  // the downbeat phase is stable regardless of where `phase` falls.
  for (let k = 0; ; k++) {
    const time = phase + k * interval;
    if (time > duration) break;
    if (time < 0) continue;
    const isDownbeat = k % beatsPerBar === 0;
    const marker: Marker = { time, strength: isDownbeat ? 1 : 0.7 };
    beats.push(marker);
    if (isDownbeat) downbeats.push(marker);
  }

  return {
    source: opts.source ?? `synthetic:${bpm}bpm`,
    duration,
    bpm,
    phase,
    beats,
    downbeats,
    onsets: [],
    sections: [],
  };
}
