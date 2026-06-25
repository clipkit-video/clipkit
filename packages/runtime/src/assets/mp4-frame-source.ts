// Worker-compatible, deterministic video frame source.
//
// HTMLVideoElement bundles demux + decode + a playback clock — but it
// doesn't exist in workers, and its seeking is approximate. This class
// rebuilds the pipeline from parts that DO exist in workers:
//
//   fetch(url)  →  mp4box demux (sample table + codec config)
//               →  VideoDecoder (WebCodecs)
//               →  getFrame(t) returns the exact VideoFrame for time t
//
// Determinism is the point: preview frame N is pixel-identical to
// exported frame N, because both decode the same sample.
//
// Decode model — PIPELINED, not batch-per-seek:
//   - One persistent decoder. Samples are fed in decode order through a
//     cursor (`nextFeedIndex`); outputs land in a frame cache keyed by
//     sample index.
//   - getFrame(t) keeps the feed cursor FEED_AHEAD samples past the
//     target, so during linear playback each request feeds ~1 new
//     sample (amortized one hardware decode per frame — real-time).
//   - Only a backward seek or a large forward jump resets the decoder
//     to the target's preceding keyframe. flush() happens only at
//     end-of-stream.
//   - Decoded frames behind the playhead are evicted + closed.
//
// v1 limits (documented in PARITY-PLAN.md):
//   - MP4 containers only (mp4box). Other containers fall back to the
//     host's main-thread pump.
//   - The whole file is fetched up front. Fine for clip-length assets;
//     long-form needs ranged fetches + incremental demux.

import { createFile, DataStream, Endianness, type MP4ArrayBuffer, type MP4Sample } from 'mp4box';
import { getLogger } from '../logger.js';

/** Samples kept fed beyond the target — the decode pipeline depth. */
const FEED_AHEAD = 12;
/** Cached frames kept behind the target (handles tiny backwards jitter). */
const CACHE_BEHIND = 2;
/**
 * Cached frames kept behind the target while playing BACKWARD
 * (time_remap reverse). H.264 only decodes forward from a keyframe,
 * so reverse playback re-decodes a GOP chunk and then serves the next
 * ~24 descending requests from cache — one GOP decode per chunk
 * instead of per frame, with memory bounded to the window.
 */
const REVERSE_CACHE = 24;
/** Forward jump (in samples) beyond which we reset to a keyframe instead of decoding through. */
const FORWARD_RESET_THRESHOLD = 90;
/** Safety timeout for a single frame request. */
const FRAME_TIMEOUT_MS = 2000;

interface SampleRef {
  /** Composition time in seconds. */
  time: number;
  isKey: boolean;
  chunk: EncodedVideoChunk;
}

export class Mp4FrameSource {
  readonly width: number;
  readonly height: number;
  /** Media duration in seconds. */
  readonly duration: number;

  /** Samples in decode order, with composition times. */
  private samples: SampleRef[];
  /** Indices of keyframes within `samples`, ascending. */
  private keyIndices: number[];
  /** Decoder-output timestamp → sample index (composition order lookup). */
  private tsToIndex = new Map<number, number>();
  private config: VideoDecoderConfig;

  private decoder: VideoDecoder | null = null;
  /** Next sample index (decode order) to feed the decoder. */
  private nextFeedIndex = Number.POSITIVE_INFINITY;
  /** True after an end-of-stream flush — next decode needs a reset. */
  private flushed = false;
  /** Decoded frames, keyed by sample index. Evicted + closed as the window moves. */
  private cache = new Map<number, VideoFrame>();
  /** Cache window [lo, hi] — outputs outside it are closed on arrival. */
  private windowLo = 0;
  private windowHi = Number.POSITIVE_INFINITY;
  /** Previous request's target — direction detection for the window shape. */
  private lastTarget = -1;
  /** Pending getFrame waiters, keyed by sample index. */
  private waiters = new Map<number, Array<(f: VideoFrame | null) => void>>();
  /** Serializes getFrame calls. */
  private opChain: Promise<unknown> = Promise.resolve();
  private disposed = false;

  static isSupported(): boolean {
    return typeof VideoDecoder !== 'undefined';
  }

  private constructor(
    config: VideoDecoderConfig,
    samples: SampleRef[],
    width: number,
    height: number,
    duration: number,
  ) {
    this.config = config;
    this.samples = samples;
    this.width = width;
    this.height = height;
    this.duration = duration;
    this.keyIndices = [];
    for (let i = 0; i < samples.length; i++) {
      if (samples[i]!.isKey) this.keyIndices.push(i);
      this.tsToIndex.set(samples[i]!.chunk.timestamp, i);
    }
    if (this.keyIndices.length === 0 || this.keyIndices[0] !== 0) {
      // Defensive: treat the first sample as a sync point — most
      // encoders emit a keyframe first; without one we can't decode.
      this.keyIndices.unshift(0);
    }
  }

  /** Fetch + demux + verify the codec is decodable. Throws on any failure. */
  static async load(url: string): Promise<Mp4FrameSource> {
    if (!Mp4FrameSource.isSupported()) {
      throw new Error('WebCodecs VideoDecoder unavailable in this context');
    }

    // 10s fetch timeout (mirrors loadImage): a dead video host (e.g. the retired
    // MDN flower.mp4) otherwise dangles a connection through preload.
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 10000);
    let response: Response;
    try {
      response = await fetch(url, { mode: 'cors', signal: ac.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) throw new Error(`fetch failed (${response.status})`);
    const buffer = (await response.arrayBuffer()) as MP4ArrayBuffer;
    buffer.fileStart = 0;

    const mp4 = createFile();
    const { info, rawSamples } = await new Promise<{
      info: import('mp4box').MP4Info;
      rawSamples: MP4Sample[];
    }>((resolve, reject) => {
      const collected: MP4Sample[] = [];
      let trackInfo: import('mp4box').MP4Info | null = null;
      mp4.onError = (e) => reject(new Error(`mp4box: ${e}`));
      mp4.onReady = (i) => {
        if (i.videoTracks.length === 0) {
          reject(new Error('no video track in container'));
          return;
        }
        trackInfo = i;
        const track = i.videoTracks[0]!;
        mp4.setExtractionOptions(track.id, null, { nbSamples: track.nb_samples });
        mp4.start();
      };
      mp4.onSamples = (_trackId, _user, samples) => {
        collected.push(...samples);
        const expected = trackInfo?.videoTracks[0]?.nb_samples ?? Infinity;
        if (collected.length >= expected) {
          resolve({ info: trackInfo!, rawSamples: collected });
        }
      };
      mp4.appendBuffer(buffer);
      mp4.flush();
    });

    const track = info.videoTracks[0]!;
    const description = extractDescription(mp4, track.id);
    const config: VideoDecoderConfig = {
      codec: track.codec,
      codedWidth: track.video?.width ?? track.track_width,
      codedHeight: track.video?.height ?? track.track_height,
      ...(description ? { description } : {}),
    };

    const support = await VideoDecoder.isConfigSupported(config);
    if (!support.supported) {
      throw new Error(`codec ${track.codec} not decodable here`);
    }

    const samples: SampleRef[] = rawSamples.map((s) => ({
      time: s.cts / s.timescale,
      isKey: s.is_sync,
      chunk: new EncodedVideoChunk({
        type: s.is_sync ? 'key' : 'delta',
        timestamp: Math.round((s.cts / s.timescale) * 1_000_000),
        duration: Math.round((s.duration / s.timescale) * 1_000_000),
        data: s.data,
      }),
    }));
    if (samples.length === 0) throw new Error('container has zero video samples');

    const duration = info.duration / info.timescale;
    return new Mp4FrameSource(
      config,
      samples,
      config.codedWidth!,
      config.codedHeight!,
      duration > 0 ? duration : samples[samples.length - 1]!.time,
    );
  }

  /**
   * The decoded frame covering media time `t` (seconds). The RETURNED
   * FRAME IS OWNED BY THE SOURCE — upload it, don't close it; it's
   * closed when the cache window moves past it. Returns null after
   * dispose or on decode failure.
   */
  getFrame(t: number): Promise<VideoFrame | null> {
    const run = this.opChain.then(() => this.#getFrameInner(t));
    // Keep the chain alive through failures.
    this.opChain = run.catch(() => undefined);
    return run;
  }

  async #getFrameInner(t: number): Promise<VideoFrame | null> {
    if (this.disposed) return null;
    const target = this.#sampleIndexAt(t);
    const backward = this.lastTarget >= 0 && target < this.lastTarget;
    this.lastTarget = target;

    // Move the eviction window and close frames OUTSIDE it — both
    // sides, or reverse playback (descending targets) would keep every
    // frame it ever decoded and leak the whole clip as GPU surfaces.
    // The window keeps a deep tail BEHIND the target when stepping
    // backward (so descending requests amortize one GOP re-decode
    // across REVERSE_CACHE cache hits) and a shallow one going forward.
    const prevWindowLo = this.windowLo;
    this.windowLo = Math.max(0, target - (backward ? REVERSE_CACHE : CACHE_BEHIND));
    this.windowHi = Math.min(this.samples.length - 1, target + FEED_AHEAD);
    for (const [idx, frame] of this.cache) {
      if (idx < this.windowLo || idx > this.windowHi) {
        frame.close();
        this.cache.delete(idx);
      }
    }

    const feedEnd = this.windowHi;

    const cached = this.cache.get(target);
    if (cached) {
      // Keep the pipeline primed for the frames that follow.
      this.#feedThrough(feedEnd, /*hasWaiter*/ false);
      return cached;
    }

    this.#ensureDecoderFor(target, prevWindowLo);

    const result = await new Promise<VideoFrame | null>((resolve) => {
      const list = this.waiters.get(target) ?? [];
      list.push(resolve);
      this.waiters.set(target, list);

      this.#feedThrough(feedEnd, /*hasWaiter*/ true);

      // Safety net: a stuck decoder shouldn't stall produce forever.
      setTimeout(() => {
        const pending = this.waiters.get(target);
        if (pending && pending.includes(resolve)) {
          this.waiters.set(target, pending.filter((w) => w !== resolve));
          resolve(this.cache.get(target) ?? null);
        }
      }, FRAME_TIMEOUT_MS);
    });
    return result;
  }

  /**
   * Make sure the decoder exists and its feed cursor can reach
   * `target`. Reset to the target's preceding keyframe when:
   *   - there's no usable decoder (never started, errored, or flushed
   *     at end-of-stream), or
   *   - the target sits in a region this run already evicted
   *     (`target < prevWindowLo` — backward seek past the cache), or
   *   - the feed cursor is already past the target by more than the
   *     pipeline depth (an uncached target can never emerge from this
   *     run — without a reset the waiter would just hit its timeout), or
   *   - the jump forward is large enough that decoding through is more
   *     work than restarting at the target's keyframe.
   *
   * Crucially NOT a reset: target fed but output still pending in the
   * decoder (the normal in-flight case during playback) — feeding a
   * few samples ahead makes it emit. Produces are serialized, so at
   * most one waiter exists and it always belongs to the current call.
   */
  #ensureDecoderFor(target: number, prevWindowLo: number): void {
    const needsReset =
      !this.decoder ||
      this.decoder.state === 'closed' ||
      this.flushed ||
      this.nextFeedIndex === Number.POSITIVE_INFINITY ||
      target < prevWindowLo ||
      this.nextFeedIndex > target + FEED_AHEAD ||
      target - this.nextFeedIndex > FORWARD_RESET_THRESHOLD;

    if (!needsReset) return;

    if (this.decoder && this.decoder.state !== 'closed') this.decoder.close();
    const decoder = new VideoDecoder({
      output: (frame) => this.#onFrame(frame),
      error: (e) => {
        getLogger().warn('VideoDecoder error:', e.message);
        this.#failPendingWaiters();
      },
    });
    decoder.configure(this.config);
    this.decoder = decoder;
    this.flushed = false;
    this.nextFeedIndex = this.#keyframeBefore(target);
  }

  /** Feed samples up to `end` (decode order). Flush only at end-of-stream. */
  #feedThrough(end: number, hasWaiter: boolean): void {
    const decoder = this.decoder;
    if (!decoder || decoder.state === 'closed' || this.flushed) return;
    while (this.nextFeedIndex <= end && this.nextFeedIndex < this.samples.length) {
      decoder.decode(this.samples[this.nextFeedIndex]!.chunk);
      this.nextFeedIndex += 1;
    }
    // End of stream with someone waiting: flush to drain the decoder's
    // reorder buffer (the last few frames only emit on flush).
    if (hasWaiter && this.nextFeedIndex >= this.samples.length) {
      this.flushed = true;
      decoder.flush().catch(() => {
        /* reset on next request */
      });
    }
  }

  #onFrame(frame: VideoFrame): void {
    if (this.disposed) {
      frame.close();
      return;
    }
    const idx = this.tsToIndex.get(frame.timestamp);
    if (idx === undefined || idx < this.windowLo || idx > this.windowHi) {
      frame.close();
    } else {
      const previous = this.cache.get(idx);
      if (previous) previous.close();
      this.cache.set(idx, frame);
    }
    if (idx !== undefined) {
      const waiting = this.waiters.get(idx);
      if (waiting) {
        this.waiters.delete(idx);
        const resolved = this.cache.get(idx) ?? null;
        for (const w of waiting) w(resolved);
      }
    }
  }

  #failPendingWaiters(): void {
    for (const [, waiting] of this.waiters) {
      for (const w of waiting) w(null);
    }
    this.waiters.clear();
  }

  /** Index of the sample whose composition window covers time t. */
  #sampleIndexAt(t: number): number {
    const clamped = Math.max(0, Math.min(t, this.samples[this.samples.length - 1]!.time));
    // Samples are in decode order; composition order ≈ decode order for
    // streams without B-frame reordering (our common case). Linear-scan
    // fallback keeps B-frame streams correct at small cost.
    let best = 0;
    let bestTime = -Infinity;
    for (let i = 0; i < this.samples.length; i++) {
      const st = this.samples[i]!.time;
      if (st <= clamped && st > bestTime) {
        bestTime = st;
        best = i;
      }
    }
    return best;
  }

  #keyframeBefore(index: number): number {
    let best = this.keyIndices[0]!;
    for (const k of this.keyIndices) {
      if (k <= index) best = k;
      else break;
    }
    return best;
  }

  dispose(): void {
    this.disposed = true;
    this.#failPendingWaiters();
    for (const frame of this.cache.values()) frame.close();
    this.cache.clear();
    if (this.decoder && this.decoder.state !== 'closed') this.decoder.close();
    this.decoder = null;
    this.samples = [];
  }
}

/**
 * Pull the codec-private description (avcC / hvcC / vpcC / av1C box
 * payload) out of the sample-description entry — VideoDecoder needs it
 * for H.264/H.265 in MP4 (the "avcC extradata" convention).
 */
function extractDescription(
  mp4: import('mp4box').MP4File,
  trackId: number,
): Uint8Array | undefined {
  try {
    const trak = mp4.getTrackById(trackId);
    for (const entry of trak.mdia.minf.stbl.stsd.entries) {
      const box = entry.avcC ?? entry.hvcC ?? entry.vpcC ?? entry.av1C;
      if (box) {
        // ⚠ Endianness lives on the `Endianness` export in current
        // mp4box builds — `DataStream.BIG_ENDIAN` is undefined there,
        // and passing undefined silently serializes LITTLE-endian,
        // byte-swapping the avcC and making VideoDecoder reject the
        // config. Cost us a debugging session; don't regress this.
        const stream = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
        box.write(stream);
        // Skip the 8-byte box header (size + fourcc).
        return new Uint8Array(stream.buffer, 8);
      }
    }
  } catch (err) {
    getLogger().debug(
      'extractDescription failed:',
      err instanceof Error ? err.message : String(err),
    );
  }
  return undefined;
}
