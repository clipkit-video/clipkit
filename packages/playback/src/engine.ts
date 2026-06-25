// PlaybackEngine — wires the clock, audio scheduler, frame producer
// worker, frame buffer, and RAF presenter into one public API.
//
// Architecture (see SPRINT.md):
//   - TransportClock owns time. AudioContext is its precision substrate.
//   - AudioScheduler subscribes to the clock, schedules each `audio`
//     element via AudioBufferSourceNode.start(when, offset).
//   - Worker renders frames into a private OffscreenCanvas and posts
//     them as VideoFrames (zero-copy transfer).
//   - FrameBuffer holds VideoFrames sorted by composition time; the
//     RAF presenter peeks the matching frame and draws it to the
//     display canvas.
//   - The engine schedules buffer top-ups: keep `bufferTargetSeconds`
//     worth of frames ahead of the playhead, capped by an inflight
//     limit so the worker never gets piled up.
//
// Stale-frame discipline: every seek / setSource bumps the engine's
// sequence ID. The buffer drops mismatched frames at push and at
// `setSequenceId`. The worker doesn't know about cancellation — it
// always finishes the frame it's mid-render on, and main throws it
// away if stale. Simpler protocol; one or two wasted renders per seek.

import type { Source, Element } from '@clipkit/protocol';
import { mapToMediaTime, rateOf, timeRemapOf, trimDurationOf } from '@clipkit/runtime';
import { TransportClock } from './clock.js';
import { stepFrameTime } from './frame-math.js';
import { AudioScheduler, type AudioLevels } from './audio.js';
import { FrameBuffer } from './buffer.js';
import type {
  MainToWorkerMessage,
  WorkerToMainMessage,
} from './worker-protocol.js';
import type {
  BufferStatus,
  EngineStats,
  PlaybackEngineOptions,
  Unsubscribe,
} from './types.js';

// Look-ahead window the engine maintains while NOT interactive
// (i.e., normal playback / idle). Set high enough that heavy
// compositions get a real cushion before the buffer can drain — at
// 0.5s a worker that takes 60ms per frame produces only ~8 frames
// in the lead window, and the presenter starves the first time it
// hits a slow frame. At 3s the same composition gets ~50 frames of
// headroom, so transient slow frames don't cause visible stutter.
const DEFAULT_BUFFER_TARGET_SEC = 3.0;
const DEFAULT_TIME_UPDATE_MS = 100;
const DEFAULT_BACKEND = 'auto' as const;
const DEFAULT_FRAME_RATE = 30;

/**
 * The schema requires frame_rate to be positive, but the engine must
 * survive bad input: frame_rate ≤ 0 / NaN turns the produce cadence
 * into ±Infinity/NaN request times and wedges frame production
 * PERMANENTLY (NaN defeats the catch-up reset; in-flight NaN produces
 * jam the counter). Clamp to a sane positive range instead.
 */
function sanitizeFrameRate(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0
    ? Math.min(v, 240)
    : DEFAULT_FRAME_RATE;
}
const MAX_INFLIGHT_PRODUCE = 4;
/** Buffer capacity = targetSec * frameRate * this. Headroom for over-production + in-flight. */
const BUFFER_CAPACITY_HEADROOM = 1.6;

interface Listeners {
  time: Set<(t: number) => void>;
  playing: Set<(p: boolean) => void>;
  error: Set<(e: Error) => void>;
  buffer: Set<(s: BufferStatus) => void>;
}

export class PlaybackEngine {
  // ── Public state ────────────────────────────────────────────────────

  source: Source;
  duration: number;
  readonly ready: Promise<void>;

  get playing(): boolean {
    return this.#clock?.playing ?? false;
  }
  get time(): number {
    return this.#clock?.now() ?? 0;
  }

  // ── Private state ───────────────────────────────────────────────────

  readonly #displayCanvas: HTMLCanvasElement;
  readonly #displayCtx: CanvasRenderingContext2D;
  readonly #audioContext: AudioContext;
  readonly #ownsAudioContext: boolean;
  readonly #bufferTargetSec: number;
  readonly #timeUpdateIntervalMs: number;
  /**
   * "Interactive" mode: skip look-ahead frame production. The engine
   * still renders the current playhead's frame on every setSource, so
   * the canvas updates live as the user edits — but it doesn't waste
   * cycles pre-rendering frames that the next edit will invalidate.
   * Toggle on at the start of a drag, off when the drag ends.
   */
  #interactive = false;
  #loop = false;

  // ── Perf stats (for the in-app diagnostic HUD) ──────────────────
  // Sliding window of presenter-tick timestamps (ms since origin),
  // capped at ~2s of samples. Used to compute presented-FPS and the
  // ms-gap-between-paints jitter.
  #presentTimes: number[] = [];
  // Per-produce request start timestamps, keyed by the composition
  // time of the requested frame (each pending produce has a unique
  // `time`). Trimmed on receive. Used to compute worker latency.
  #pendingProduceStart = new Map<number, number>();
  /** Pending renderFrameAt() requests, keyed by requestId. */
  #stillRequests = new Map<
    number,
    { resolve: (bitmap: ImageBitmap) => void; reject: (err: Error) => void }
  >();
  #stillRequestId = 0;
  // Sliding window of measured worker latencies (request → receive).
  #workerLatencies: number[] = [];
  // Sliding window of worker-reported runtime.frame() durations.
  #workerFrameMs: number[] = [];
  #workerPrepareMs: number[] = [];
  #workerBlurSamples: number[] = [];
  // Sliding window of worker-reported `new VideoFrame()` durations.
  #workerVideoFrameMs: number[] = [];
  // Sliding window of worker-reported full handleProduce durations.
  #workerTotalMs: number[] = [];
  // Sliding window of time-from-worker-send → main-receive (cross
  // thread). Worker has its own performance.timeOrigin (set at
  // worker creation, NOT at navigation), so subtractions across
  // threads need the offset captured at boot.
  #queueLagMs: number[] = [];
  // ms to add to worker `performance.now()` values to convert into
  // main's clock. Captured from the worker's ready message.
  #workerClockOffset = 0;
  // Sliding window of drawImage durations on the display canvas.
  // Main-thread cost per presented frame; if this is large the
  // presenter is blocking its own rAF loop.
  #drawImageMs: number[] = [];
  // Count of presenter ticks where peekAt() returned null — i.e.
  // the buffer was empty and the canvas couldn't be repainted.
  #starvationCount = 0;

  #clock!: TransportClock;
  #scheduler!: AudioScheduler;
  #buffer!: FrameBuffer;
  #worker!: Worker;
  /**
   * FALLBACK main-thread video decoders, keyed by absolute source URL.
   * The worker self-decodes MP4 video deterministically via WebCodecs;
   * for URLs it reports it CANNOT decode (`videoFallback` message —
   * non-MP4 container, unsupported codec), the engine owns a muted
   * `<video>` per URL, keeps it in sync with the transport clock
   * (#syncVideos), and pumps decoded ImageBitmaps to the worker.
   * Pump preview is live-sync grade; the WebCodecs path is exact.
   */
  #videoPump = new Map<string, VideoPumpEntry>();
  /** Last absolutized source — pump specs are rebuilt from this when the worker reports fallbacks. */
  #lastResolvedSource: Source | null = null;
  #frameRate: number = DEFAULT_FRAME_RATE;
  #sequenceId = 1;
  #highestRequestedTime = 0;
  #inflight = 0;
  #workerReady = false;
  #disposed = false;
  #rafHandle = 0;
  #lastTimeEmit = 0;
  /**
   * Debounce timer for the paused-playhead "final quality" refine —
   * one motion-blurred produce once scrubbing settles (see
   * #scheduleFinalRefine).
   */
  #finalRefineTimer: ReturnType<typeof setTimeout> | null = null;
  #lastBufferStarved: boolean | null = null;
  /**
   * Resolves the first time a frame matching the current sequenceId
   * arrives. Reset on every seek / setSource so the engine can gate
   * "have we got something to show yet?" without a polling loop.
   */
  #firstFrameResolve: (() => void) | null = null;

  readonly #listeners: Listeners = {
    time: new Set(),
    playing: new Set(),
    error: new Set(),
    buffer: new Set(),
  };

  // ── Construction ────────────────────────────────────────────────────

  constructor(options: PlaybackEngineOptions) {
    this.source = options.source;
    this.duration = computeDuration(options.source);
    this.#frameRate = sanitizeFrameRate(options.source.frame_rate);
    // Seed below the playhead so the first #topUpBuffer call schedules
    // a produce AT t=0 (next = -1/fps + 1/fps = 0). The default of 0
    // caused the first produce to land at t=1/fps, leaving the buffer
    // empty at t=0 and the canvas blank until the user seeks or plays.
    this.#highestRequestedTime = -1 / this.#frameRate;
    this.#displayCanvas = options.displayCanvas;
    const ctx = options.displayCanvas.getContext('2d');
    if (!ctx) {
      throw new Error('PlaybackEngine: failed to acquire 2d context on displayCanvas');
    }
    this.#displayCtx = ctx;
    this.#displayCanvas.width = options.source.width ?? 1920;
    this.#displayCanvas.height = options.source.height ?? 1080;

    this.#bufferTargetSec = options.bufferTargetSeconds ?? DEFAULT_BUFFER_TARGET_SEC;
    this.#timeUpdateIntervalMs = options.timeUpdateIntervalMs ?? DEFAULT_TIME_UPDATE_MS;

    if (options.audioContext) {
      this.#audioContext = options.audioContext;
      this.#ownsAudioContext = false;
    } else {
      this.#audioContext = new AudioContext();
      this.#ownsAudioContext = true;
    }

    // Set up the ready Promise, then kick off async init. We can't await
    // inside the constructor, so the work happens in #init() and resolves
    // / rejects this Promise.
    let resolveReady!: () => void;
    let rejectReady!: (err: Error) => void;
    this.ready = new Promise<void>((res, rej) => {
      resolveReady = res;
      rejectReady = rej;
    });

    this.#init(options.backend ?? DEFAULT_BACKEND)
      .then(resolveReady)
      .catch((err: unknown) => {
        const error = err instanceof Error ? err : new Error(String(err));
        rejectReady(error);
        this.#emitError(error);
      });
  }

  // ── Public control ──────────────────────────────────────────────────

  async play(): Promise<void> {
    if (this.#disposed) throw new Error('PlaybackEngine is disposed');
    await this.ready;
    // If we're at (or very near) the end, restart from the beginning
    // — pressing play after the source ended should replay, not be a
    // no-op. Use a 1-frame tolerance so a hand-paused-near-end seek
    // (e.g. playhead at duration - 0.5ms) also rewinds cleanly.
    if (this.#clock.now() >= this.duration - 1 / this.#frameRate) {
      this.seek(0);
    }
    await this.#clock.play();
    this.#emitPlayingChange(true);
  }

  pause(): void {
    if (this.#disposed) return;
    if (!this.#clock) return;
    const wasPlaying = this.#clock.playing;
    this.#clock.pause();
    if (wasPlaying) this.#emitPlayingChange(false);
    this.#scheduleFinalRefine();
  }

  seek(time: number): void {
    if (this.#disposed) return;
    if (!this.#clock) return;
    const clamped = Math.max(0, Math.min(time, this.duration));
    this.#clock.seek(clamped);
    this.#invalidateAfterSeek(clamped);
  }

  /**
   * Frame-quantized transport step (the editor's prev/next-frame
   * buttons). Pauses playback and seeks to the frame `frames` away
   * from the current one (negative steps back), clamped to the
   * composition. Quantization math is shared via frame-math.ts.
   */
  stepFrame(frames = 1): void {
    if (this.#disposed) return;
    this.pause();
    const fps = this.source.frame_rate ?? 30;
    this.seek(stepFrameTime(this.currentTime, fps, frames, this.duration));
  }

  /**
   * Render ONE export-quality still at `time` (motion blur included
   * when the source configures it) off the playback path, returned as
   * an ImageBitmap. `width` downscales preserving aspect — thumbnail
   * strips and scrub-hover previews stay cheap to transfer. Requests
   * serialize behind frame production in the worker.
   */
  async renderFrameAt(
    time: number,
    options: { width?: number } = {},
  ): Promise<ImageBitmap> {
    if (this.#disposed) throw new Error('PlaybackEngine is disposed');
    await this.ready;
    const requestId = ++this.#stillRequestId;
    const clamped = Math.max(0, Math.min(time, this.duration));
    return new Promise<ImageBitmap>((resolve, reject) => {
      this.#stillRequests.set(requestId, { resolve, reject });
      this.#postToWorker({
        type: 'still',
        time: clamped,
        requestId,
        width: options.width,
      });
    });
  }

  async setSource(source: Source): Promise<void> {
    if (this.#disposed) throw new Error('PlaybackEngine is disposed');
    await this.ready;

    const previousTime = this.#clock.now();
    this.source = source;
    this.duration = computeDuration(source);
    this.#frameRate = sanitizeFrameRate(source.frame_rate);
    // ⚠ Assigning to canvas.width / .height — even with the same value —
    // resets the canvas bitmap (HTML spec). Only assign on real changes
    // so the canvas keeps its last drawn frame visible during the brief
    // window between setSource and the next frame arriving from the
    // worker. Without this guard, every drag dispatch flickers to black.
    const nextW = source.width ?? this.#displayCanvas.width;
    const nextH = source.height ?? this.#displayCanvas.height;
    if (this.#displayCanvas.width !== nextW) this.#displayCanvas.width = nextW;
    if (this.#displayCanvas.height !== nextH) this.#displayCanvas.height = nextH;

    const clamped = Math.min(previousTime, this.duration);
    this.#clock.seek(clamped);
    // Same ordering rule as patchElements: invalidate (no top-up) →
    // post setSource → THEN top up. If we top up before posting,
    // produces land in the worker queue ahead of setSource and the
    // worker renders them with the previous currentSource.
    this.#invalidate(clamped);

    const resolved = absolutizeAssetUrls(source);
    this.#lastResolvedSource = resolved;
    // Interactive mode (during a drag/resize): skip re-scheduling audio
    // on every dispatch. The user isn't hearing playback while editing,
    // and the scheduler does enough main-thread work per call to add
    // perceptible lag at 60Hz. `setInteractive(false)` runs one final
    // scheduler.setSource so audio re-syncs to the canonical source.
    if (this.#interactive) {
      this.#postToWorker({
        type: 'setSource',
        source: stripAudioForWorker(resolved),
        sequenceId: this.#sequenceId,
      });
      this.#topUpBuffer();
      return;
    }
    // Re-decode audio + tell worker about new source in parallel.
    const audioPromise = this.#scheduler.setSource(resolved);
    this.#postToWorker({
      type: 'setSource',
      source: stripAudioForWorker(resolved),
      sequenceId: this.#sequenceId,
    });
    this.#topUpBuffer();
    await audioPromise;
  }

  /**
   * Toggle interactive (edit) mode. While `true`, the engine produces
   * only one frame at the current playhead on each `setSource` —
   * no look-ahead buffering. Use during drag/resize/rotate operations
   * so live mutation dispatches don't queue dozens of doomed frames.
   * Set back to `false` to resume normal buffered playback.
   */
  /**
   * Apply partial updates to existing elements without re-sending the
   * full source. The fast path for live drag / resize / rotate
   * dispatches:
   *
   *   - Worker applies patches via Object.assign to its in-memory source
   *   - No `runtime.preload()` (assets unchanged)
   *   - No audio scheduling
   *   - Tiny message payload (~50 bytes vs full source's KBs)
   *
   * Caller passes both the new source (so this.source stays in sync as
   * the diff baseline for the next tick) and the patches to send to
   * the worker. We never mutate — the source from the store is
   * Immer-frozen and that's fine; we just swap the reference.
   *
   * Patches should be for visual/spatial fields only — time/track/
   * duration changes affect frame-buffer alignment and should go
   * through `setSource`. The Editor's source-diff function decides
   * which path to use.
   */
  patchElements(
    nextSource: Source,
    patches: ReadonlyArray<{ id: string; patch: Record<string, unknown> }>,
  ): void {
    if (this.#disposed) return;
    if (patches.length === 0) return;
    // Replace the reference — no in-place mutation. The new source is
    // already the post-patch state from the store.
    this.source = nextSource;

    // Critical ordering: invalidate (bump seq + clear buffer) →
    // post the patch → THEN top up. Worker processes messages in
    // arrival order; if produces are posted before the patch, they
    // render with the stale currentSource and we get a frame with
    // pre-patch values for the first cycle after every patch. Most
    // visible on undo — see `#invalidate` for the longer note.
    this.#invalidate(this.#clock.now());
    this.#postToWorker({
      type: 'patchElements',
      patches,
      sequenceId: this.#sequenceId,
    });
    this.#topUpBuffer();
  }

  /** When true, playback wraps to 0 at the end instead of pausing. */
  /**
   * PREVIEW-ONLY per-element audio gains (the mixer's mute/solo).
   * Multiplies on top of authored volume; never written into the
   * Source — the lens rule's engine half. Unlisted ids reset to 1.
   */
  setPreviewGains(gains: Readonly<Record<string, number>>): void {
    if (this.#disposed) return;
    this.#scheduler?.setPreviewGains(gains);
  }

  /** Mixer meter levels (0..1 peaks); zeros before audio init. */
  getAudioLevels(): AudioLevels {
    return this.#scheduler?.getLevels() ?? { master: { l: 0, r: 0 }, elements: {} };
  }

  setLoop(value: boolean): void {
    this.#loop = value;
  }

  /**
   * Current transport time, in seconds. Reads the clock directly —
   * advances continuously during playback regardless of how often
   * onTime emits. UI elements that need 60Hz-smooth motion (the
   * timeline playhead) read this on every rAF tick instead of
   * subscribing to the store's playback.time (which is throttled
   * to 100ms).
   */
  get currentTime(): number {
    if (this.#disposed || !this.#clock) return 0;
    return this.#clock.now();
  }

  /**
   * Snapshot of presenter / worker / buffer health for the in-app
   * diagnostic HUD. All values are derived from sliding windows the
   * engine already maintains for instrumentation; this is a cheap
   * read intended to be polled at ~4Hz by a UI overlay.
   */
  getStats(): EngineStats {
    const now = typeof performance !== 'undefined' ? performance.now() : 0;

    // Presented FPS — count present timestamps in the last second.
    let fps = 0;
    for (let i = this.#presentTimes.length - 1; i >= 0; i--) {
      if (now - this.#presentTimes[i]! > 1000) break;
      fps++;
    }

    // Gap stats over the same ~1s window.
    let gapSum = 0;
    let gapCount = 0;
    let gapMax = 0;
    for (let i = this.#presentTimes.length - 1; i > 0; i--) {
      const a = this.#presentTimes[i - 1]!;
      const b = this.#presentTimes[i]!;
      if (now - b > 1000) break;
      const gap = b - a;
      gapSum += gap;
      gapCount += 1;
      if (gap > gapMax) gapMax = gap;
    }
    const frameGapMs = gapCount > 0 ? gapSum / gapCount : 0;

    // Worker latency — average over our ring buffer.
    const avg = (xs: number[]): number => {
      if (xs.length === 0) return 0;
      let s = 0;
      for (const x of xs) s += x;
      return s / xs.length;
    };

    return {
      fps,
      targetFps: this.#frameRate,
      bufferAheadSec: this.#disposed
        ? 0
        : this.#buffer.aheadSec(this.#clock.now()),
      frameGapMs,
      frameGapMaxMs: gapMax,
      workerLatencyMs: avg(this.#workerLatencies),
      renderMs: avg(this.#workerFrameMs),
      prepareMs: avg(this.#workerPrepareMs),
      blurSamples: avg(this.#workerBlurSamples),
      videoFrameMs: avg(this.#workerVideoFrameMs),
      workerTotalMs: avg(this.#workerTotalMs),
      queueLagMs: avg(this.#queueLagMs),
      drawImageMs: avg(this.#drawImageMs),
      starvationCount: this.#starvationCount,
      inflight: this.#inflight,
    };
  }

  /** Zero out starvation count + latency windows. Useful at play start. */
  resetStats(): void {
    this.#starvationCount = 0;
    this.#workerLatencies.length = 0;
    this.#presentTimes.length = 0;
    this.#workerFrameMs.length = 0;
    this.#workerPrepareMs.length = 0;
    this.#workerBlurSamples.length = 0;
    this.#workerVideoFrameMs.length = 0;
    this.#workerTotalMs.length = 0;
    this.#queueLagMs.length = 0;
    this.#drawImageMs.length = 0;
  }

  setInteractive(value: boolean): void {
    if (this.#interactive === value) return;
    this.#interactive = value;
    if (!value) {
      // Resync the audio scheduler with the canonical source — we
      // skipped its updates during interactive mode.
      void this.#scheduler.setSource(absolutizeAssetUrls(this.source));
      // Resume look-ahead buffering.
      this.#topUpBuffer();
    }
  }

  // ── Subscriptions ───────────────────────────────────────────────────

  onTime(listener: (time: number) => void): Unsubscribe {
    this.#listeners.time.add(listener);
    return () => {
      this.#listeners.time.delete(listener);
    };
  }

  onPlayingChange(listener: (playing: boolean) => void): Unsubscribe {
    this.#listeners.playing.add(listener);
    return () => {
      this.#listeners.playing.delete(listener);
    };
  }

  onError(listener: (error: Error) => void): Unsubscribe {
    this.#listeners.error.add(listener);
    return () => {
      this.#listeners.error.delete(listener);
    };
  }

  onBufferStatus(listener: (status: BufferStatus) => void): Unsubscribe {
    this.#listeners.buffer.add(listener);
    return () => {
      this.#listeners.buffer.delete(listener);
    };
  }

  // ── Cleanup ─────────────────────────────────────────────────────────

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#finalRefineTimer !== null) clearTimeout(this.#finalRefineTimer);
    if (this.#rafHandle) cancelAnimationFrame(this.#rafHandle);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.#onVisibilityChange);
    }
    this.#worker?.removeEventListener('message', this.#onWorkerMessage);
    this.#worker?.removeEventListener('error', this.#onWorkerError);
    this.#disposeVideoPump();
    this.#postToWorker({ type: 'dispose' });
    this.#worker?.terminate();
    this.#scheduler?.dispose();
    this.#clock?.dispose();
    this.#buffer?.dispose();
    if (this.#ownsAudioContext) {
      void this.#audioContext.close();
    }
    for (const pending of this.#stillRequests.values()) {
      pending.reject(new Error('PlaybackEngine disposed'));
    }
    this.#stillRequests.clear();
    for (const set of Object.values(this.#listeners)) set.clear();
  }

  // ── Internal: init + main loop ──────────────────────────────────────

  async #init(backend: 'auto' | 'webgpu' | 'webgl2'): Promise<void> {
    this.#clock = new TransportClock(this.#audioContext, 0);
    this.#scheduler = new AudioScheduler(this.#audioContext, this.#clock);

    const targetFrames = Math.ceil(this.#bufferTargetSec * this.#frameRate);
    const capacity = Math.max(4, Math.ceil(targetFrames * BUFFER_CAPACITY_HEADROOM));
    this.#buffer = new FrameBuffer(capacity);
    this.#buffer.setSequenceId(this.#sequenceId);

    this.#worker = new Worker(new URL('./worker.js', import.meta.url), {
      type: 'module',
    });
    this.#worker.addEventListener('message', this.#onWorkerMessage);
    this.#worker.addEventListener('error', this.#onWorkerError);

    const workerReady = new Promise<void>((resolve, reject) => {
      const off = (): void => {
        this.#worker.removeEventListener('message', onReady);
        this.#worker.removeEventListener('error', onWorkerInitError);
      };
      const onReady = (event: MessageEvent<WorkerToMainMessage>): void => {
        const data = event.data;
        if (data.type === 'ready') {
          off();
          this.#workerReady = true;
          // Workers don't share performance.timeOrigin with their
          // parent. Capture the offset now so cross-thread time
          // comparisons (queue lag) are valid.
          this.#workerClockOffset = data.timeOrigin - performance.timeOrigin;
          resolve();
        } else if (data.type === 'error') {
          off();
          reject(new Error(`Worker init failed: ${data.message}`));
        }
      };
      const onWorkerInitError = (event: ErrorEvent): void => {
        off();
        reject(new Error(`Worker init error: ${event.message}`));
      };
      this.#worker.addEventListener('message', onReady);
      this.#worker.addEventListener('error', onWorkerInitError);
    });

    const resolved = absolutizeAssetUrls(this.source);
    this.#lastResolvedSource = resolved;
    this.#postToWorker({
      type: 'init',
      source: stripAudioForWorker(resolved),
      backend,
    });

    // Wait for worker to come online + start audio decode in parallel.
    const audioPromise = this.#scheduler.setSource(resolved);
    await Promise.all([workerReady, audioPromise]);

    // Prime the buffer + start the presenter loop. Wait for the first
    // frame to land before resolving so play() can assume there's
    // something on screen.
    const firstFrame = new Promise<void>((resolve) => {
      this.#firstFrameResolve = resolve;
    });
    this.#startPresenter();
    this.#topUpBuffer();
    document.addEventListener('visibilitychange', this.#onVisibilityChange);
    await firstFrame;
  }

  /**
   * When the tab is hidden, stop topping up the buffer (no point
   * rendering frames the user can't see). When it comes back, resume.
   * RAF naturally throttles to ~1Hz when hidden; the presenter loop
   * is harmless to leave running.
   */
  #onVisibilityChange = (): void => {
    if (!document.hidden) this.#topUpBuffer();
  };

  #startPresenter(): void {
    const tick = (): void => {
      if (this.#disposed) return;
      let now = this.#clock.now();

      // End-of-source: loop or pause depending on #loop.
      // - loop on:  seek to 0 and keep playing (use #invalidate +
      //   #topUpBuffer so the buffer doesn't drop the wrap-around
      //   frames as stale, and audio re-syncs to t=0).
      // - loop off: pause and clamp to duration. Without this the
      //   clock kept advancing forever, the playhead drifted past
      //   the last frame, and topUpBuffer refused to produce
      //   anything beyond `duration` — so the canvas froze on the
      //   last frame while the timeline kept incrementing.
      if (this.#clock.playing && now >= this.duration) {
        if (this.#loop && this.duration > 0) {
          this.#clock.seek(0);
          this.#invalidate(0);
          this.#topUpBuffer();
          now = 0;
          this.#lastTimeEmit = performance.now();
          this.#emitTime(now);
        } else {
          this.#clock.pause();
          this.#clock.seek(this.duration);
          now = this.duration;
          this.#emitPlayingChange(false);
          this.#lastTimeEmit = performance.now();
          this.#emitTime(now);
        }
      }

      // Present the latest frame at or before `now`.
      const frame = this.#buffer.peekAt(now);
      if (frame) {
        const drawStart =
          typeof performance !== 'undefined' ? performance.now() : 0;
        this.#displayCtx.drawImage(
          frame,
          0,
          0,
          this.#displayCanvas.width,
          this.#displayCanvas.height,
        );
        if (typeof performance !== 'undefined') {
          this.#drawImageMs.push(performance.now() - drawStart);
          if (this.#drawImageMs.length > 60) this.#drawImageMs.shift();
        }
        if (typeof performance !== 'undefined') {
          // Record presenter-tick timestamp for FPS + jitter stats.
          // Trim to a ~2s window (covers our worst-case sample rate).
          const ts = performance.now();
          this.#presentTimes.push(ts);
          while (
            this.#presentTimes.length > 0 &&
            ts - this.#presentTimes[0]! > 2000
          ) {
            this.#presentTimes.shift();
          }
          try {
            performance.mark('ck.present', { detail: { time: now } });
          } catch {
            /* see ck.produce */
          }
        }
      } else if (this.#clock.playing) {
        // Buffer was empty while we were trying to play — visible
        // stutter. Bumps the starvation counter so the HUD can show it.
        this.#starvationCount += 1;
      }

      // Prune frames the playhead has already passed.
      this.#buffer.prune(now);

      // Keep the main-thread video decoders aligned with the clock.
      this.#syncVideos(now);

      // Top up production.
      this.#topUpBuffer();

      // Throttled UI events.
      const nowMs = performance.now();
      if (nowMs - this.#lastTimeEmit >= this.#timeUpdateIntervalMs) {
        this.#lastTimeEmit = nowMs;
        this.#emitTime(now);
      }
      this.#emitBufferStatusIfChanged(now);

      this.#rafHandle = requestAnimationFrame(tick);
    };
    this.#rafHandle = requestAnimationFrame(tick);
  }

  #topUpBuffer(): void {
    if (!this.#workerReady || this.#disposed) return;
    // Don't render frames the user can't see.
    if (typeof document !== 'undefined' && document.hidden) return;

    const frameInterval = 1 / this.#frameRate;
    const playhead = this.#clock.now();

    // Defense against a poisoned cadence (frame_rate ≤ 0 ever slipped
    // in → ±Infinity/NaN request times wedge production permanently;
    // NaN also defeats the `<` reset below). Sanitized #frameRate
    // should make this unreachable, but a NaN here is unrecoverable
    // without it.
    if (!Number.isFinite(frameInterval) || frameInterval <= 0) return;
    if (!Number.isFinite(this.#highestRequestedTime)) {
      this.#highestRequestedTime = playhead - frameInterval;
    }

    // Don't request frames the playhead has already moved past.
    if (this.#highestRequestedTime < playhead) {
      this.#highestRequestedTime = playhead - frameInterval;
    }

    // Interactive mode is restrictive on two axes:
    //   - effectiveBufferSec = 0 → no look-ahead (the next edit invalidates
    //     anyway)
    //   - effectiveMaxInflight = 1 → at most one produce in flight at a
    //     time. With cap > 1 the worker queue piles up during fast drags;
    //     each pending produce wastes ~10-30ms of render time on stale
    //     state. With cap = 1 the worker always renders the latest
    //     accumulated patches when it gets to the next produce, and the
    //     "final frame after mouseup" lands on the very next render
    //     cycle (~33ms), not after 4 stale renders (~130ms).
    // Never request more look-ahead than the buffer can HOLD. The
    // buffer is sized at init from the INITIAL frame rate; raising
    // frame_rate past that sizing (>48fps with the 3s/30fps default)
    // made every push evict the frame the presenter needed next —
    // playback froze while the clock ran (Ian's 50/60fps caption bug).
    const capacityAheadSec =
      (this.#buffer.capacity - MAX_INFLIGHT_PRODUCE) * frameInterval;
    const effectiveBufferSec = this.#interactive
      ? 0
      : Math.min(this.#bufferTargetSec, capacityAheadSec);
    const effectiveMaxInflight = this.#interactive ? 1 : MAX_INFLIGHT_PRODUCE;

    while (this.#inflight < effectiveMaxInflight) {
      const nextTime = this.#highestRequestedTime + frameInterval;
      if (nextTime > this.duration) return;
      if (nextTime - playhead > effectiveBufferSec) return;

      // Stats + DevTools mark — record when the produce was posted
      // so we can compute round-trip latency when the frame comes
      // back. The mark gives DevTools Performance a labeled event.
      if (typeof performance !== 'undefined') {
        this.#pendingProduceStart.set(nextTime, performance.now());
        try {
          performance.mark('ck.produce', {
            detail: { time: nextTime, seq: this.#sequenceId },
          });
        } catch {
          /* older browsers may not accept the detail arg */
        }
      }
      this.#postToWorker({
        type: 'produce',
        time: nextTime,
        sequenceId: this.#sequenceId,
      });
      this.#highestRequestedTime = nextTime;
      this.#inflight += 1;
    }
  }

  #invalidateAfterSeek(newTime: number): void {
    this.#invalidate(newTime);
    this.#topUpBuffer();
    this.#scheduleFinalRefine();
  }

  /**
   * While paused, once the playhead has settled for a beat, request
   * ONE export-quality frame (motion-blurred supersampling) at the
   * playhead. The realtime frame shows instantly during scrubbing;
   * the refined frame lands ~120ms after the drag stops and replaces
   * it (the buffer keeps the later same-time frame). No-op when
   * playing or when the source has no motion_blur.
   */
  #scheduleFinalRefine(): void {
    if (this.#finalRefineTimer !== null) {
      clearTimeout(this.#finalRefineTimer);
      this.#finalRefineTimer = null;
    }
    const mb = this.source?.motion_blur;
    const samples = mb && typeof mb.samples === 'number' ? mb.samples : mb ? 8 : 0;
    if (!mb || samples <= 1) return;
    if (this.#clock?.playing) return;
    this.#finalRefineTimer = setTimeout(() => {
      this.#finalRefineTimer = null;
      if (this.#disposed || !this.#workerReady) return;
      if (this.#clock?.playing) return;
      this.#postToWorker({
        type: 'produce',
        time: this.#clock?.now() ?? 0,
        sequenceId: this.#sequenceId,
        quality: 'final',
      });
      this.#inflight += 1;
    }, 120);
  }

  /**
   * Bump the sequenceId + clear the buffer + reset `highestRequestedTime`,
   * WITHOUT topping up. Use when you need to post a `setSource` or
   * `patchElements` message to the worker BEFORE the produce messages
   * that follow — otherwise the worker processes the produces first
   * (synchronous, using its pre-update source) and we get a frame
   * rendered with stale data sitting in the buffer.
   *
   * This bit users on undo: bounding box (read from the React store)
   * showed the reverted position, but the canvas (rendered by the
   * worker) showed the pre-undo position, because the first produce
   * after the patch ran before the patch was applied.
   */
  #invalidate(newTime: number): void {
    this.#sequenceId += 1;
    this.#buffer.setSequenceId(this.#sequenceId);
    this.#highestRequestedTime = newTime - 1 / this.#frameRate;
    // inflight is NOT reset — pending responses arrive with old IDs and
    // get closed by the buffer's sequenceId check.
  }

  // ── Worker message handlers ─────────────────────────────────────────

  #onWorkerMessage = (event: MessageEvent<WorkerToMainMessage>): void => {
    const msg = event.data;
    switch (msg.type) {
      case 'ready':
        // Handled by the one-shot listener in #init().
        return;
      case 'frame': {
        this.#inflight = Math.max(0, this.#inflight - 1);
        // Latency tracking — match against the pending request keyed
        // by the frame's composition time. Keep up to 60 samples
        // (~2s of frames at 30fps); older entries roll off.
        if (typeof performance !== 'undefined') {
          const start = this.#pendingProduceStart.get(msg.time);
          if (start !== undefined) {
            this.#pendingProduceStart.delete(msg.time);
            const lat = performance.now() - start;
            this.#workerLatencies.push(lat);
            if (this.#workerLatencies.length > 60) this.#workerLatencies.shift();
          }
          // Worker-reported per-step durations for the HUD.
          if (msg.timings) {
            this.#workerFrameMs.push(msg.timings.frameMs);
            if (this.#workerFrameMs.length > 60) this.#workerFrameMs.shift();
            this.#workerPrepareMs.push(msg.timings.prepareMs ?? 0);
            if (this.#workerPrepareMs.length > 60) this.#workerPrepareMs.shift();
            this.#workerBlurSamples.push(msg.timings.blurSamples ?? 0);
            if (this.#workerBlurSamples.length > 60) this.#workerBlurSamples.shift();
            this.#workerVideoFrameMs.push(msg.timings.videoFrameMs);
            if (this.#workerVideoFrameMs.length > 60)
              this.#workerVideoFrameMs.shift();
            this.#workerTotalMs.push(msg.timings.workerTotalMs);
            if (this.#workerTotalMs.length > 60) this.#workerTotalMs.shift();
            // sentAt is in worker's clock; convert into main's clock
            // before subtracting. Without the offset this value
            // shows the delta between navigation start and worker
            // creation (often tens of seconds), not actual lag.
            const sentAtMain = msg.timings.sentAt + this.#workerClockOffset;
            const lag = performance.now() - sentAtMain;
            this.#queueLagMs.push(lag);
            if (this.#queueLagMs.length > 60) this.#queueLagMs.shift();
          }
          try {
            performance.mark('ck.frame', {
              detail: { time: msg.time, seq: msg.sequenceId },
            });
          } catch {
            /* see ck.produce */
          }
        }
        // Buffer's setSequenceId check handles stale frames — close + drop.
        this.#buffer.push(msg.time, msg.frame, msg.sequenceId);
        if (msg.sequenceId === this.#sequenceId && this.#firstFrameResolve) {
          this.#firstFrameResolve();
          this.#firstFrameResolve = null;
        }
        return;
      }
      case 'videoFallback': {
        // Build (or tear down) the main-thread pump for exactly the
        // URLs the worker couldn't self-decode.
        if (msg.urls.length > 0) {
          // eslint-disable-next-line no-console
          console.info(
            '[clipkit] worker could not self-decode these videos; using main-thread pump (live-sync preview):',
            msg.urls,
          );
        }
        if (this.#lastResolvedSource) {
          this.#buildVideoPump(this.#lastResolvedSource, new Set(msg.urls));
        }
        return;
      }
      case 'stillResult': {
        const pending = this.#stillRequests.get(msg.requestId);
        if (pending) {
          this.#stillRequests.delete(msg.requestId);
          pending.resolve(msg.bitmap);
        } else {
          msg.bitmap.close();
        }
        return;
      }
      case 'stillError': {
        const pending = this.#stillRequests.get(msg.requestId);
        if (pending) {
          this.#stillRequests.delete(msg.requestId);
          pending.reject(new Error(`renderFrameAt: ${msg.message}`));
        }
        return;
      }
      case 'error':
        this.#emitError(new Error(`Worker: ${msg.message}`));
        return;
    }
  };

  #onWorkerError = (event: ErrorEvent): void => {
    this.#emitError(new Error(`Worker error: ${event.message}`));
  };

  #postToWorker(message: MainToWorkerMessage, transfer: Transferable[] = []): void {
    if (this.#disposed && message.type !== 'dispose') return;
    this.#worker?.postMessage(message, transfer);
  }

  // ── Main-thread video pump ──────────────────────────────────────────

  /**
   * (Re)create the fallback decoding `<video>` elements for the given
   * subset of video URLs (those the worker can't self-decode). Each one
   * pumps decoded ImageBitmaps into the worker via
   * requestVideoFrameCallback (33ms polling fallback). While paused, a
   * pumped frame triggers a one-shot re-render so scrubbing shows the
   * right video frame.
   */
  #buildVideoPump(source: Source, only: ReadonlySet<string>): void {
    this.#disposeVideoPump();
    if (typeof document === 'undefined') return;
    if (only.size === 0) return;

    const specs = new Map<string, VideoPumpSpec>();
    collectVideoSpecs(source.elements, 0, computeDuration(source), specs);
    for (const url of specs.keys()) {
      if (!only.has(url)) specs.delete(url);
    }

    for (const [url, spec] of specs) {
      const video = document.createElement('video');
      video.crossOrigin = 'anonymous';
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      video.loop = spec.loop;
      video.src = url;

      let cancelled = false;
      const schedule = (): void => {
        if (cancelled || this.#disposed) return;
        const rvfc = (
          video as HTMLVideoElement & {
            requestVideoFrameCallback?: (cb: () => void) => number;
          }
        ).requestVideoFrameCallback;
        if (typeof rvfc === 'function') {
          rvfc.call(video, pushFrame);
        } else {
          setTimeout(pushFrame, 33);
        }
      };
      const pushFrame = (): void => {
        if (cancelled || this.#disposed) return;
        if (this.#workerReady && video.readyState >= 2) {
          void createImageBitmap(video)
            .then((bitmap) => {
              if (cancelled || this.#disposed) {
                bitmap.close();
                return;
              }
              this.#postToWorker({ type: 'videoFrame', url, bitmap }, [bitmap]);
              // Paused scrub: any frame already in the buffer was
              // rendered with the previous bitmap. Re-render once at
              // the playhead so the canvas shows the seeked frame.
              // (rVFC only fires on real new frames, so no feedback
              // loop while idle.)
              if (this.#clock && !this.#clock.playing) {
                this.#invalidate(this.#clock.now());
                this.#topUpBuffer();
              }
            })
            .catch(() => {
              /* decode hiccup — next callback retries */
            });
        }
        schedule();
      };
      video.addEventListener('loadeddata', pushFrame, { once: true });

      this.#videoPump.set(url, {
        ...spec,
        url,
        video,
        cancel: () => {
          cancelled = true;
          video.pause();
          video.removeAttribute('src');
          video.load();
        },
      });
    }
  }

  /**
   * Align each decoder with the transport clock: play/pause to match,
   * map composition time → media time through the element's start +
   * trim + playback_rate (shared mapToMediaTime), and correct drift
   * beyond 0.3s (playing) / 0.05s (scrubbing).
   */
  #syncVideos(now: number): void {
    if (this.#videoPump.size === 0) return;
    for (const entry of this.#videoPump.values()) {
      const { video } = entry;
      if (video.readyState < 1 /* HAVE_METADATA */) continue;

      const active = now >= entry.elStart && now <= entry.elStart + entry.elDuration;
      const mediaDur = Number.isFinite(video.duration) ? video.duration : 0;
      const desired = mapToMediaTime(
        now,
        {
          elementStart: entry.elStart,
          trimStart: entry.trimStart,
          trimDuration: entry.trimDuration,
          rate: entry.rate,
          loop: entry.loop,
          timeRemap: entry.timeRemap,
        },
        mediaDur,
      );

      if (this.#clock.playing && active) {
        video.playbackRate = entry.rate;
        if (video.paused) {
          void video.play().catch(() => {
            /* autoplay rejection — muted videos shouldn't hit this */
          });
        }
        if (Math.abs(video.currentTime - desired) > 0.3) {
          video.currentTime = desired;
        }
      } else {
        if (!video.paused) video.pause();
        if (Math.abs(video.currentTime - desired) > 0.05) {
          video.currentTime = desired;
        }
      }
    }
  }

  #disposeVideoPump(): void {
    for (const entry of this.#videoPump.values()) entry.cancel();
    this.#videoPump.clear();
  }

  // ── Emit helpers ────────────────────────────────────────────────────

  #emitTime(t: number): void {
    for (const listener of this.#listeners.time) {
      try {
        listener(t);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[PlaybackEngine] onTime listener threw:', err);
      }
    }
  }

  #emitPlayingChange(playing: boolean): void {
    for (const listener of this.#listeners.playing) {
      try {
        listener(playing);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[PlaybackEngine] onPlayingChange listener threw:', err);
      }
    }
  }

  #emitError(error: Error): void {
    for (const listener of this.#listeners.error) {
      try {
        listener(error);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[PlaybackEngine] onError listener threw:', err);
      }
    }
  }

  #emitBufferStatusIfChanged(now: number): void {
    const ahead = this.#buffer.aheadSec(now);
    const starved = this.#buffer.peekAt(now) === null;
    if (starved === this.#lastBufferStarved) return;
    this.#lastBufferStarved = starved;
    const status: BufferStatus = { ahead, starved };
    for (const listener of this.#listeners.buffer) {
      try {
        listener(status);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[PlaybackEngine] onBufferStatus listener threw:', err);
      }
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

interface VideoPumpSpec {
  /** Composition time the element becomes active, in seconds. */
  elStart: number;
  /** Media-time offset at element start (trim_start), in seconds. */
  trimStart: number;
  /** trim_duration cap on the media window, or null. */
  trimDuration: number | null;
  /** Element's visible duration, in seconds. */
  elDuration: number;
  /** playback_rate (media seconds per timeline second). */
  rate: number;
  loop: boolean;
  /** time_remap keyframes (replaces trim/rate/loop when present). */
  timeRemap: ReturnType<typeof timeRemapOf>;
}

interface VideoPumpEntry extends VideoPumpSpec {
  url: string;
  video: HTMLVideoElement;
  cancel: () => void;
}

/**
 * Collect one pump spec per unique video URL. Groups offset their
 * children's times. When the same URL appears in several elements, the
 * first occurrence's timing wins — a v1 simplification (one decoder per
 * URL; per-element media-time divergence needs per-element decoders).
 */
function collectVideoSpecs(
  elements: readonly Element[],
  timeOffset: number,
  parentDuration: number,
  out: Map<string, VideoPumpSpec>,
): void {
  for (const el of elements) {
    const localStart = toNum(el.time, 0);
    const start = timeOffset + localStart;
    const duration = toNum(el.duration, Math.max(0, parentDuration - localStart));

    if (el.type === 'video' && typeof el.source === 'string' && el.source) {
      if (!out.has(el.source)) {
        out.set(el.source, {
          elStart: start,
          trimStart: toNum((el as { trim_start?: unknown }).trim_start, 0),
          trimDuration: trimDurationOf((el as { trim_duration?: unknown }).trim_duration),
          elDuration: duration,
          rate: rateOf((el as { playback_rate?: unknown }).playback_rate),
          loop: el.loop === true,
          timeRemap: timeRemapOf((el as { time_remap?: unknown }).time_remap),
        });
      }
    } else if (el.type === 'group') {
      collectVideoSpecs(el.elements, start, duration, out);
    }
  }
}

function toNum(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function computeDuration(source: Source): number {
  if (typeof source.duration === 'number') return source.duration;
  let max = 0;
  for (const el of source.elements) {
    const elTime = typeof el.time === 'number' ? el.time : 0;
    const elDuration = typeof el.duration === 'number' ? el.duration : 0;
    if (elTime + elDuration > max) max = elTime + elDuration;
  }
  return max;
}

/**
 * Worker contexts can't resolve relative URLs (`/mux-audio.mp3`,
 * `./logo.png`, `images/foo.jpg`) — `self.location` doesn't carry a
 * useful base for asset paths. Main-thread code resolves against
 * `window.location` automatically; the worker doesn't get that for free.
 *
 * Before handing a Source to the worker (or to the main-thread audio
 * scheduler, for symmetry), resolve every `source: string` field to an
 * absolute URL. Recurses into compositions. Returns a fresh Source so
 * the consumer's input isn't mutated; `engine.source` keeps the
 * original reference for round-trip integrity.
 */
function absolutizeAssetUrls(source: Source): Source {
  if (typeof window === 'undefined') return source;
  const origin = window.location.origin;
  const next: Source = {
    ...source,
    elements: absolutizeElements(source.elements, origin),
  };
  // Source.fonts srcs are typically root-relative (`/snapshot-fonts/...`).
  // The worker's own location is the Next.js chunk URL, not the page —
  // so its relative-URL resolution can drift and FontFace.load() then
  // fails with a network error. Resolving against the page origin here
  // means the worker only ever sees absolute URLs.
  if (source.fonts && source.fonts.length > 0) {
    next.fonts = source.fonts.map((f) => {
      if (/^[a-z][a-z0-9+.-]*:/i.test(f.src)) return f;
      try {
        return { ...f, src: new URL(f.src, origin).href };
      } catch {
        return f;
      }
    });
  }
  return next;
}

function absolutizeElements(
  elements: readonly Element[],
  origin: string,
): Element[] {
  return elements.map((el): Element => {
    let next: Element = el;

    if (
      (el.type === 'video' || el.type === 'image' || el.type === 'audio') &&
      typeof el.source === 'string' &&
      !/^[a-z][a-z0-9+.-]*:/i.test(el.source)
    ) {
      // No scheme — relative or root-relative. Resolve against origin.
      try {
        const absolute = new URL(el.source, origin).href;
        next = { ...el, source: absolute };
      } catch {
        // Unparseable — leave as-is and let the runtime / scheduler
        // surface the error normally.
      }
    }

    if (next.type === 'group') {
      next = { ...next, elements: absolutizeElements(next.elements, origin) };
    }

    return next;
  });
}

/**
 * The runtime's `preload()` decodes audio via `new AudioContext()` —
 * but `AudioContext` doesn't exist in workers. Audio elements have no
 * visual representation, so the worker doesn't need them at all; the
 * main-thread AudioScheduler handles playback independently.
 *
 * Strip `audio` elements (and recurse into compositions) before sending
 * the Source into the worker. Returns a fresh Source so the version
 * the AudioScheduler sees is unchanged.
 */
function stripAudioForWorker(source: Source): Source {
  return { ...source, elements: stripAudioFromElements(source.elements) };
}

function stripAudioFromElements(elements: readonly Element[]): Element[] {
  const out: Element[] = [];
  for (const el of elements) {
    if (el.type === 'audio') continue;
    if (el.type === 'group') {
      out.push({ ...el, elements: stripAudioFromElements(el.elements) });
    } else {
      out.push(el);
    }
  }
  return out;
}

