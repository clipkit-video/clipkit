// Waveform peak extraction — the editor's clip waveforms and asset
// tiles need real min/max peaks, not the dashboard's procedural mock.
//
// Split in two so the math is probe-able in Node:
//   computeWaveformPeaks — pure: Float32Array channels → peak pairs
//   extractWaveformPeaks — browser: fetch + decodeAudioData + compute,
//                           cached per (url, peaksPerSecond)

export interface WaveformPeaks {
  /** Interleaved [min, max] per bucket: [min0, max0, min1, max1, …]. */
  peaks: Float32Array;
  /** Buckets per second of audio. */
  peaksPerSecond: number;
  /** Decoded duration in seconds. */
  duration: number;
}

/**
 * Min/max peak pairs over the mixdown of `channels` (peak across
 * channels — the loudest excursion either side carries). Pure.
 */
export function computeWaveformPeaks(
  channels: ReadonlyArray<Float32Array>,
  sampleRate: number,
  peaksPerSecond = 50,
): WaveformPeaks {
  const frames = channels.length > 0 ? channels[0]!.length : 0;
  const pps = Math.max(1, peaksPerSecond);
  const samplesPerBucket = Math.max(1, sampleRate / pps);
  const bucketCount = Math.max(1, Math.ceil(frames / samplesPerBucket));
  const peaks = new Float32Array(bucketCount * 2);
  for (let b = 0; b < bucketCount; b++) {
    const start = Math.floor(b * samplesPerBucket);
    const end = Math.min(frames, Math.floor((b + 1) * samplesPerBucket));
    let min = 0;
    let max = 0;
    for (const ch of channels) {
      for (let i = start; i < end; i++) {
        const v = ch[i]!;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    peaks[b * 2] = min;
    peaks[b * 2 + 1] = max;
  }
  return {
    peaks,
    peaksPerSecond: pps,
    duration: sampleRate > 0 ? frames / sampleRate : 0,
  };
}

const peakCache = new Map<string, Promise<WaveformPeaks>>();

/**
 * Fetch + decode an audio (or video-with-audio) URL and compute its
 * waveform peaks. Cached per (url, peaksPerSecond) — clip tiles and
 * the timeline share one decode. Requires a browser AudioContext
 * (pass one to share; a throwaway OfflineAudioContext is used
 * otherwise).
 */
export function extractWaveformPeaks(
  url: string,
  options: { peaksPerSecond?: number; audioContext?: AudioContext } = {},
): Promise<WaveformPeaks> {
  const pps = options.peaksPerSecond ?? 50;
  const key = `${url}::${pps}`;
  const cached = peakCache.get(key);
  if (cached) return cached;
  const job = (async (): Promise<WaveformPeaks> => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`waveform fetch failed (${res.status}) for ${url}`);
    const bytes = await res.arrayBuffer();
    // decodeAudioData needs a context; OfflineAudioContext avoids
    // spinning up an audio output thread for a pure decode.
    const ctx =
      options.audioContext ?? new OfflineAudioContext(1, 1, 44100);
    const buffer = await ctx.decodeAudioData(bytes);
    const channels: Float32Array[] = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      channels.push(buffer.getChannelData(c));
    }
    return computeWaveformPeaks(channels, buffer.sampleRate, pps);
  })();
  // Drop failed jobs from the cache so a transient fetch error doesn't
  // poison the URL forever.
  peakCache.set(key, job);
  job.catch(() => peakCache.delete(key));
  return job;
}
