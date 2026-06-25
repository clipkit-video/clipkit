// Public types for @clipkit/playback. Anything imported through
// `@clipkit/playback` from outside the package goes through this file.
//
// ClockState lives in `clock.ts` — internal to the package.

import type { Source } from '@clipkit/protocol';

// ────────────────────────────────────────────────────────────────────────────
// PlaybackEngine
// ────────────────────────────────────────────────────────────────────────────

/** Renderer backend selection. Matches the runtime's options. */
export type Backend = 'auto' | 'webgpu' | 'webgl2';

export interface PlaybackEngineOptions {
  /** Canvas the engine draws presented frames into. */
  displayCanvas: HTMLCanvasElement;

  /** The composition to play. Can be swapped later via `setSource`. */
  source: Source;

  /** Renderer backend preference. Default `'auto'`. */
  backend?: Backend;

  /**
   * How much time, in seconds, to render ahead of the playhead. Caps the
   * VideoFrame ring buffer's memory footprint. Default `0.5`.
   *
   * Smaller = less memory, faster invalidation on edits, more starvation
   * risk on heavy scenes. Larger = smoother playback on heavy scenes,
   * costlier edit invalidation.
   */
  bufferTargetSeconds?: number;

  /**
   * Minimum interval between `onTime` callbacks, in milliseconds.
   * Default `100` (≈10 Hz). The engine always tracks time precisely;
   * this only throttles the user-facing event so consumers don't pay
   * for 60 fps re-renders just to update a scrubber.
   */
  timeUpdateIntervalMs?: number;

  /**
   * Optional pre-existing `AudioContext` to use as the clock's precision
   * source. If omitted, the engine creates and owns one. Pass an existing
   * context when integrating into an app that already has an audio graph.
   */
  audioContext?: AudioContext;
}

/**
 * Diagnostic snapshot of the frame buffer's state. Surfaced through
 * `onBufferStatus` for UI affordances like a buffering spinner.
 */
export interface BufferStatus {
  /** Seconds of frames currently ready ahead of the playhead. */
  ahead: number;

  /**
   * `true` when the playhead has overrun the produced frames and
   * the renderer is catching up. UIs should show a "buffering" state.
   */
  starved: boolean;
}

/**
 * Unsubscribe function returned by every `engine.on*` subscription.
 * Calling it removes the listener; idempotent.
 */
export type Unsubscribe = () => void;

/**
 * Snapshot of presenter / worker / buffer health used by the
 * in-app diagnostic HUD. Cheap to compute — derived from sliding
 * windows the engine already keeps for instrumentation. Intended
 * to be polled at ~4Hz.
 */
export interface EngineStats {
  /** Presenter ticks (drawImage calls) in the last 1s. */
  fps: number;
  /** Target rate from source.frame_rate. */
  targetFps: number;
  /** Seconds of frames buffered ahead of the playhead. */
  bufferAheadSec: number;
  /** Average ms between consecutive presenter ticks over the last 1s. */
  frameGapMs: number;
  /** Worst gap in the same window. High max with low avg = jitter. */
  frameGapMaxMs: number;
  /** Avg ms from `produce` post to `frame` receive, sliding window. */
  workerLatencyMs: number;
  /**
   * Avg ms the worker spent inside `runtime.frame(time)` — the actual
   * scene-render time per frame. This is the runtime/GPU cost.
   */
  renderMs: number;
  /** Avg ms decoding/uploading video frames per produce (prepareVideoFrames). */
  prepareMs: number;
  /** Avg motion-blur samples used per live frame (0 = unblurred path). */
  blurSamples: number;
  /**
   * Avg ms the worker spent constructing a VideoFrame from its
   * OffscreenCanvas (GPU readback). This is the transfer cost.
   */
  videoFrameMs: number;
  /**
   * Avg full handleProduce duration on the worker. (renderMs +
   * videoFrameMs ≈ workerTotalMs if our breakdown is complete.)
   */
  workerTotalMs: number;
  /**
   * Avg ms from worker `postMessage(frame)` to main `onmessage`
   * firing. High values = main thread is busy and can't drain the
   * worker's outgoing message queue.
   */
  queueLagMs: number;
  /**
   * Avg ms spent in `displayCtx.drawImage(frame, ...)` on the
   * presenter's rAF tick. Main-thread per-paint cost; if this is
   * tens of ms, the 2D canvas's VideoFrame → display upload is
   * the per-frame bottleneck.
   */
  drawImageMs: number;
  /** Total times peekAt returned null while clock was playing. */
  starvationCount: number;
  /** Currently-pending produce requests in the worker queue. */
  inflight: number;
}
