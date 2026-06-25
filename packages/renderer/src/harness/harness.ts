// Browser-side harness — runs inside the headless Chrome that Playwright
// drives. Bundled into a single self-contained script at build time
// (scripts/build-harness.mjs) and embedded as a string in ./embedded.ts,
// which the renderer injects into the page via addScriptTag.
//
// It talks to Node through Playwright-exposed functions (wired in ../render.ts
// and ../still.ts):
//   __clipkitReportProgress(frame, total) — optional, per-frame
//   __clipkitReportError(message)         — fatal
//   __clipkitReportResult(base64Mp4)      — runHarness success
//   __clipkitStillReady()                 — renderStill: canvas is ready to screenshot
//
// All it does is instantiate @clipkit/runtime and render the Source. The engine
// is the runtime; this is glue.

import { ClipkitRuntime, type RenderResolution } from '@clipkit/runtime';
import type { Source } from '@clipkit/protocol';

interface HarnessOptions {
  backend?: 'auto' | 'webgpu' | 'webgl2';
  resolution?: RenderResolution;
  bitrate?: number;
}

interface StillOptions {
  time?: number;
  backend?: 'auto' | 'webgpu' | 'webgl2';
}

declare global {
  interface Window {
    __clipkitReportProgress?: (frame: number, total: number) => Promise<void>;
    __clipkitReportError?: (message: string) => Promise<void>;
    __clipkitReportResult?: (base64Mp4: string) => Promise<void>;
    __clipkitStillReady?: () => Promise<void>;
    runHarness: (source: Source, options?: HarnessOptions) => Promise<void>;
    renderStill: (source: Source, options?: StillOptions) => Promise<void>;
  }
}

// Render the full composition to an MP4 via the runtime's WebCodecs exporter.
window.runHarness = async function runHarness(
  source: Source,
  options: HarnessOptions = {},
): Promise<void> {
  try {
    const width = source.width ?? 1920;
    const height = source.height ?? 1080;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.style.cssText = 'position:fixed; top:0; left:0;';
    document.body.appendChild(canvas);

    const runtime = new ClipkitRuntime(canvas);
    const ok = await runtime.init({ backend: options.backend ?? 'auto' });
    if (!ok) {
      throw new Error(
        `runtime.init() failed (backend preference: ${options.backend ?? 'auto'}). ` +
          `Try forcing backend 'webgl2'.`,
      );
    }

    runtime.load(source);
    await runtime.preload();

    const fps = source.frame_rate ?? 30;
    const duration = typeof source.duration === 'number' ? source.duration : 10;
    const totalFrames = Math.max(1, Math.ceil(duration * fps));

    const blob = await runtime.export({
      framerate: fps,
      renderResolution: options.resolution,
      ...(options.bitrate ? { bitrate: options.bitrate } : {}),
      onProgress: (progress01) => {
        const frame = Math.round(progress01 * totalFrames);
        window.__clipkitReportProgress?.(frame, totalFrames).catch(() => {});
      },
    });

    const base64 = arrayBufferToBase64(await blob.arrayBuffer());
    await window.__clipkitReportResult?.(base64);
  } catch (err) {
    const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
    await window.__clipkitReportError?.(message);
  }
};

// Render one frame at `time` and leave it on a full-size canvas, then signal
// readiness so Node can screenshot it (works regardless of preserveDrawingBuffer).
window.renderStill = async function renderStill(
  source: Source,
  options: StillOptions = {},
): Promise<void> {
  try {
    const width = source.width ?? 1920;
    const height = source.height ?? 1080;

    const canvas = document.createElement('canvas');
    canvas.id = '__clipkit_still';
    canvas.width = width;
    canvas.height = height;
    canvas.style.cssText = `position:fixed; top:0; left:0; width:${width}px; height:${height}px;`;
    document.body.appendChild(canvas);

    const runtime = new ClipkitRuntime(canvas);
    const ok = await runtime.init({ backend: options.backend ?? 'auto' });
    if (!ok) {
      throw new Error(`runtime.init() failed (backend preference: ${options.backend ?? 'auto'}).`);
    }

    runtime.load(source);
    await runtime.preload();
    await runtime.renderAsync(source, options.time ?? 0);
    await runtime.gpuFinish();

    await window.__clipkitStillReady?.();
  } catch (err) {
    const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
    await window.__clipkitReportError?.(message);
  }
};

// btoa overflows on multi-MB buffers; chunk it.
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x8000; // 32 KB
  let out = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const chunk = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    out += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(out);
}
