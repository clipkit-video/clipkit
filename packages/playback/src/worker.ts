// Frame-producer worker.
//
// Runs ClipkitRuntime against an internally-owned OffscreenCanvas.
// Listens for protocol messages from the engine on the main thread,
// produces VideoFrames, and transfers them back via postMessage's
// transfer list (zero-copy).
//
// The worker is intentionally simple — no scheduling, no buffer logic,
// no cancellation tracking. It's a pure "produce a frame at this time"
// RPC service. All timing intelligence lives in the engine; stale-frame
// filtering lives in the engine. See worker-protocol.ts.
//
// ─── WebGPU/WebGL2 best practices ───────────────────────────────────
// - OffscreenCanvas is created here, never transferred in (the spec
//   compliant way to run WebGPU/WebGL2 in a worker)
// - VideoFrame is the cross-thread primitive; transfer list is zero-copy
// - Backend negotiation (WebGPU → WebGL2 fallback) runs inside this
//   worker, not on the main thread
// - Device-loss handling: punted to Phase 5 (engine wiring) — needs
//   coordination with the engine to re-init silently
// - Visibility-aware production: punted to Phase 5 — the engine pauses
//   produce calls when the document is hidden; the worker doesn't need
//   to know

import { ClipkitRuntime } from '@clipkit/runtime';
import type { Element, Source } from '@clipkit/protocol';
import type {
  MainToWorkerMessage,
  WorkerToMainMessage,
} from './worker-protocol.js';

declare const self: DedicatedWorkerGlobalScope;

let runtime: ClipkitRuntime | null = null;
let canvas: OffscreenCanvas | null = null;
let disposed = false;
/**
 * EMA of one blur sample's TRUE render cost in ms — drives the
 * adaptive sample count for live-playback motion blur. CPU submit
 * times lie (the GPU pipelines the work and a heavy scene can cost
 * 20× what the submit suggests), so this is fed by periodic measured
 * frames that drain the GPU via runtime.gpuFinish(). Seeded
 * pessimistically; corrects within one measured frame.
 */
let liveSampleCostMs = 4;
/** Blurred frames produced since the last true-cost measurement. */
let blurFramesSinceMeasure = Infinity; // ∞ → measure the very first one
/** Per-frame render budget for live blur (ms) — ~realtime at 30fps with headroom. */
const LIVE_BLUR_BUDGET_MS = 22;
/** Drain the pipeline and re-measure true cost every N blurred frames. */
const BLUR_MEASURE_INTERVAL = 10;
/**
 * The source currently loaded into the runtime. Held so we can apply
 * incremental patches (via `patchElements`) without round-tripping the
 * whole source on every drag tick.
 */
let currentSource: Source | null = null;

function send(message: WorkerToMainMessage, transfer: Transferable[] = []): void {
  self.postMessage(message, transfer);
}

function sendError(err: unknown): void {
  const message =
    err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  send({ type: 'error', message });
}

async function handleInit(
  source: import('@clipkit/protocol').Source,
  backend: import('./types.js').Backend,
): Promise<void> {
  const width = source.width ?? 1920;
  const height = source.height ?? 1080;
  canvas = new OffscreenCanvas(width, height);
  runtime = new ClipkitRuntime(canvas);
  const ok = await runtime.init({ backend });
  if (!ok) {
    send({
      type: 'error',
      message: `Runtime init failed for backend="${backend}". WebGPU and WebGL2 both unavailable in this worker.`,
    });
    runtime = null;
    canvas = null;
    return;
  }
  const api = runtime.api;
  if (!api) {
    send({ type: 'error', message: 'Runtime init reported success but api is null.' });
    return;
  }
  currentSource = source;
  runtime.load(source);
  await runtime.preload();
  reportVideoFallbacks(source);
  send({
    type: 'ready',
    activeApi: api,
    width,
    height,
    timeOrigin: performance.timeOrigin,
  });
}

/**
 * Tell the engine which video URLs the runtime could NOT self-decode
 * (WebCodecs path failed) so it can pump frames from the main thread
 * for just those. Empty list = all videos decode in-worker.
 */
function reportVideoFallbacks(source: Source): void {
  if (!runtime) return;
  const urls = new Set<string>();
  collectVideoUrls(source.elements, urls);
  const fallbacks: string[] = [];
  for (const url of urls) {
    if (!runtime.hasVideoAsset(url)) fallbacks.push(url);
  }
  send({ type: 'videoFallback', urls: fallbacks });
}

function collectVideoUrls(elements: readonly Element[], out: Set<string>): void {
  for (const el of elements) {
    if (el.type === 'video' && typeof el.source === 'string' && el.source) {
      out.add(el.source);
    } else if (el.type === 'group') {
      collectVideoUrls(el.elements as readonly Element[], out);
    }
  }
}

async function handleSetSource(
  source: import('@clipkit/protocol').Source,
): Promise<void> {
  if (!runtime || !canvas) return;
  const w = source.width ?? canvas.width;
  const h = source.height ?? canvas.height;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  currentSource = source;
  runtime.load(source);
  await runtime.preload();
  reportVideoFallbacks(source);
}

/**
 * Apply patches to the current source in place, then re-load (without
 * preload — assets unchanged). Skips the costly preload step that
 * full setSource does. Used for live drag/resize dispatches.
 */
function handlePatchElements(
  patches: ReadonlyArray<{ id: string; patch: Record<string, unknown> }>,
): void {
  if (!runtime || !canvas || !currentSource) return;
  for (const { id, patch } of patches) {
    const el = findById(currentSource.elements, id);
    if (el) Object.assign(el, patch);
  }
  runtime.load(currentSource);
}

function findById(elements: readonly Element[], id: string): Element | null {
  for (const el of elements) {
    if (el.id === id) return el;
    if (el.type === 'group') {
      const nested = findById(el.elements as readonly Element[], id);
      if (nested) return nested;
    }
  }
  return null;
}

async function handleProduce(
  time: number,
  sequenceId: number,
  quality?: 'realtime' | 'final',
): Promise<void> {
  if (!runtime || !canvas) return;
  // Measure each sub-step so the main-thread HUD can show where the
  // budget goes. `performance.mark` calls are wrapped in try/catch
  // because not all browsers accept the `detail` argument; the
  // numeric timings (sent in the frame message) work everywhere.
  const t0 = performance.now();
  try {
    performance.mark('ck.worker.frame.start', { detail: { time } });
  } catch {
    /* noop */
  }

  // Decode + upload the exact video frames this composition time needs
  // (WebCodecs path). No-op for sources without frameSource-backed
  // videos. Produce calls are serialized via produceChain below, so an
  // await here can't interleave uploads between two frames.
  await runtime.prepareVideoFrames(time);
  const tPrep = performance.now();

  let blurSamplesUsed = 0;
  const mb = currentSource?.motion_blur;
  const mbSamples = mb
    ? Math.max(1, Math.min(32, Math.round(typeof mb.samples === 'number' ? mb.samples : 8)))
    : 1;
  if (quality === 'final') {
    // Export-accurate frame: full supersampling. Falls back to a plain
    // frame when the source has no motion_blur.
    runtime.renderFinalFrame(time);
  } else if (mbSamples > 1) {
    // Live playback: blurred with as many samples as the frame budget
    // affords on this machine, so the effect the export will have is
    // visible while playing — lighter on heavy scenes / slow hardware,
    // near-full elsewhere, never at the cost of realtime.
    const affordable = Math.max(
      2,
      Math.min(mbSamples, Math.floor(LIVE_BLUR_BUDGET_MS / Math.max(0.25, liveSampleCostMs))),
    );
    blurSamplesUsed = affordable;
    if (blurFramesSinceMeasure >= BLUR_MEASURE_INTERVAL) {
      // Measured frame: drain the GPU so the timing covers the real
      // shader cost, not just the CPU submit. ~2/sec — the drain stall
      // is the price of a budget that tracks scene weight (fractal
      // noise ×16 samples saturated the GPU while submit times looked
      // idle).
      const t = performance.now();
      runtime.renderFinalFrame(time, affordable);
      await runtime.gpuFinish();
      const costPerSample = (performance.now() - t) / affordable;
      liveSampleCostMs = liveSampleCostMs * 0.5 + costPerSample * 0.5;
      blurFramesSinceMeasure = 0;
    } else {
      runtime.renderFinalFrame(time, affordable);
      blurFramesSinceMeasure += 1;
    }
  } else {
    runtime.frame(time);
  }

  const t1 = performance.now();
  try {
    performance.mark('ck.worker.frame.end', { detail: { time } });
    performance.mark('ck.worker.videoframe.start', { detail: { time } });
  } catch {
    /* noop */
  }

  // Construct a VideoFrame from the OffscreenCanvas's current pixels.
  // `timestamp` is in microseconds per the spec; we encode composition
  // time so consumers can match frames to playhead positions.
  const frame = new VideoFrame(canvas, {
    timestamp: Math.round(time * 1_000_000),
  });

  const t2 = performance.now();
  try {
    performance.mark('ck.worker.videoframe.end', { detail: { time } });
  } catch {
    /* noop */
  }

  const sentAt = performance.now();
  send(
    {
      type: 'frame',
      time,
      sequenceId,
      frame,
      timings: {
        frameMs: t1 - tPrep,
        prepareMs: tPrep - t0,
        blurSamples: blurSamplesUsed,
        videoFrameMs: t2 - t1,
        workerTotalMs: performance.now() - t0,
        sentAt,
      },
    },
    [frame],
  );
}

/**
 * One export-quality still → ImageBitmap. Runs behind produceChain
 * (the caller chains it) so video-frame uploads never interleave.
 */
async function handleStill(
  time: number,
  requestId: number,
  width?: number,
): Promise<void> {
  if (!runtime || !canvas) {
    send({ type: 'stillError', requestId, message: 'worker not initialized' });
    return;
  }
  try {
    await runtime.prepareVideoFrames(time);
    // Export-accurate: full motion-blur supersampling when configured.
    runtime.renderFinalFrame(time);
    const opts: ImageBitmapOptions = {};
    if (width && width > 0 && width < canvas.width) {
      opts.resizeWidth = Math.round(width);
      opts.resizeHeight = Math.round((canvas.height / canvas.width) * width);
      opts.resizeQuality = 'high';
    }
    const bitmap = await createImageBitmap(canvas, opts);
    send({ type: 'stillResult', requestId, time, bitmap }, [bitmap]);
  } catch (err) {
    send({
      type: 'stillError',
      requestId,
      message: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
  }
}

function handleDispose(): void {
  if (disposed) return;
  disposed = true;
  runtime?.dispose();
  runtime = null;
  canvas = null;
  currentSource = null;
}

/**
 * Serializes produce work. handleProduce awaits video decode, and
 * `self.onmessage` fires per message regardless of pending awaits — two
 * unserialized produces would interleave texture uploads and render
 * frame A with frame B's video pixels.
 */
let produceChain: Promise<void> = Promise.resolve();

self.onmessage = async (event: MessageEvent<MainToWorkerMessage>): Promise<void> => {
  if (disposed) return;
  const msg = event.data;
  try {
    switch (msg.type) {
      case 'init':
        await handleInit(msg.source, msg.backend);
        return;
      case 'setSource':
        await handleSetSource(msg.source);
        return;
      case 'patchElements':
        handlePatchElements(msg.patches);
        return;
      case 'produce':
        produceChain = produceChain
          .then(() => handleProduce(msg.time, msg.sequenceId, msg.quality))
          .catch(sendError);
        return;
      case 'still':
        produceChain = produceChain
          .then(() => handleStill(msg.time, msg.requestId, msg.width))
          .catch(sendError);
        return;
      case 'videoFrame':
        // Main-thread pump fallback (non-MP4 / no WebCodecs): upload
        // into the texture the video renderer samples.
        runtime?.pushExternalVideoFrame(msg.url, msg.bitmap);
        return;
      case 'dispose':
        handleDispose();
        return;
    }
  } catch (err) {
    sendError(err);
  }
};
