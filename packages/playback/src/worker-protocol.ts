// Shared message types between the engine (main thread) and the
// frame-producer worker. Both ends import this file so the protocol
// is a single source of truth.
//
// Protocol shape:
//
//   Main → Worker
//     init        — boot the runtime, load the first source
//     setSource   — swap to a new source mid-flight (caller bumps sequenceId)
//     produce     — render one frame at composition time `time`
//     dispose     — release resources, terminate
//
//   Worker → Main
//     ready       — runtime is initialized; reports active backend + dims
//     frame       — one rendered VideoFrame, tagged with its sequenceId
//     error       — anything that went wrong post-init
//
// Stale-frame handling: the main thread bumps `sequenceId` on every
// seek / setSource. Worker doesn't track cancellation — it always
// finishes the frame it's working on and posts it back. Main discards
// frames whose `sequenceId` doesn't match the current one. Simpler than
// in-worker queue cancellation; the cost is one or two wasted renders.

import type { Source } from '@clipkit/protocol';
import type { Backend } from './types.js';

// ── Main → Worker ────────────────────────────────────────────────────

export interface InitMessage {
  type: 'init';
  source: Source;
  backend: Backend;
}

export interface SetSourceMessage {
  type: 'setSource';
  source: Source;
  sequenceId: number;
}

/**
 * Apply a partial patch to one or more elements in the worker's
 * already-loaded source. Significantly cheaper than re-sending the
 * full source on every drag tick — no asset preload, no audio
 * scheduling, no big postMessage payload. Used by the editor's live
 * drag/resize/rotate dispatches.
 *
 * Patches are applied via Object.assign to the existing elements.
 * Elements not present in the patch list are left untouched. Patches
 * are intended for visual/spatial fields only — time, track, duration,
 * asset URL changes should still go through `setSource`.
 */
export interface PatchElementsMessage {
  type: 'patchElements';
  patches: ReadonlyArray<{ id: string; patch: Record<string, unknown> }>;
  sequenceId: number;
}

export interface ProduceMessage {
  type: 'produce';
  /** Composition time, in seconds. */
  time: number;
  /** Bumped by main on every seek / setSource. Echoed back in the frame. */
  sequenceId: number;
  /**
   * 'realtime' (default) renders a single sample — the playback path.
   * 'final' additionally applies source-level motion blur (§2.1
   * supersampling); the engine requests it once the playhead has
   * settled while paused, so scrubbing shows export-accurate frames.
   */
  quality?: 'realtime' | 'final';
}

/**
 * One decoded video frame for a `video` element's source URL, pushed
 * from the main thread. Workers can't create HTMLVideoElement, so the
 * engine owns the decoding `<video>` elements and pumps ImageBitmaps
 * here (transferred, zero-copy). The worker hands each bitmap to
 * `runtime.pushExternalVideoFrame()`, which uploads it into the texture
 * the video renderer samples.
 *
 * Preview-grade sync: frames are pumped live against the transport
 * clock, not seeked per composition frame — a buffered look-ahead frame
 * renders with the most recently pumped bitmap. Export uses the
 * deterministic per-frame seek path instead.
 */
export interface VideoFrameMessage {
  type: 'videoFrame';
  url: string;
  bitmap: ImageBitmap;
}

/**
 * Render ONE export-quality still at `time` and return it as an
 * ImageBitmap (editor thumbnails, filmstrips, scrub-hover previews).
 * Serialized behind produce work; `width` downscales preserving the
 * aspect ratio so thumbnail transfers stay cheap.
 */
export interface StillMessage {
  type: 'still';
  time: number;
  requestId: number;
  width?: number;
}

export interface DisposeMessage {
  type: 'dispose';
}

export type MainToWorkerMessage =
  | InitMessage
  | SetSourceMessage
  | PatchElementsMessage
  | ProduceMessage
  | StillMessage
  | VideoFrameMessage
  | DisposeMessage;

// ── Worker → Main ────────────────────────────────────────────────────

export type ActiveBackend = 'webgpu' | 'webgl2';

export interface ReadyMessage {
  type: 'ready';
  activeApi: ActiveBackend;
  width: number;
  height: number;
  /**
   * Worker's `performance.timeOrigin` — Unix-ish ms since epoch.
   * Main subtracts this from its own `performance.timeOrigin` to
   * compute the offset needed to convert worker `performance.now()`
   * values into main's clock. Workers don't share a time origin
   * with their parent — each gets its own at creation time.
   */
  timeOrigin: number;
}

export interface FrameMessage {
  type: 'frame';
  time: number;
  sequenceId: number;
  /** Transferred — neutered on the worker side after postMessage. */
  frame: VideoFrame;
  /**
   * Optional worker-side timing breakdown (ms). Used by the in-app
   * diagnostic HUD to attribute the render budget to runtime.frame
   * vs the VideoFrame readback vs everything else. Worker-only; the
   * engine aggregates these in sliding windows.
   */
  timings?: {
    /** ms spent in runtime.frame(time). */
    frameMs: number;
    /** ms spent decoding/uploading video frames (prepareVideoFrames). */
    prepareMs: number;
    /** Motion-blur samples used for this frame (0 = unblurred path). */
    blurSamples: number;
    /** ms spent constructing the VideoFrame from the OffscreenCanvas. */
    videoFrameMs: number;
    /**
     * Full handleProduce duration including the postMessage call.
     * If this is much larger than (frameMs + videoFrameMs), the
     * postMessage / structured-clone-transfer step is the cost.
     */
    workerTotalMs: number;
    /**
     * performance.now() inside the worker right before postMessage.
     * The main thread compares against its receive time to compute
     * cross-thread queue lag — DOMHighResTimeStamp shares its time
     * origin with the parent, so the subtraction is valid.
     */
    sentAt: number;
  };
}

export interface ErrorMessage {
  type: 'error';
  message: string;
}

export interface StillResultMessage {
  type: 'stillResult';
  requestId: number;
  time: number;
  /** Transferred — neutered on the worker side after postMessage. */
  bitmap: ImageBitmap;
}

export interface StillErrorMessage {
  type: 'stillError';
  requestId: number;
  message: string;
}

/**
 * Video URLs the worker could NOT set up for self-decoding (non-MP4
 * container, unsupported codec, or no WebCodecs). Sent after every
 * init / setSource preload. The engine builds its main-thread frame
 * pump for exactly these URLs; an empty list tears the pump down.
 */
export interface VideoFallbackMessage {
  type: 'videoFallback';
  urls: string[];
}

export type WorkerToMainMessage =
  | ReadyMessage
  | FrameMessage
  | StillResultMessage
  | StillErrorMessage
  | ErrorMessage
  | VideoFallbackMessage;
