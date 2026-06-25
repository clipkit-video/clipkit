// @clipkit/renderer — render a ClipKit Source to MP4 on your own machine.
//
// Drives Playwright + a bundled in-page harness: launches headless Chrome,
// loads @clipkit/runtime, renders the composition, and returns the runtime's
// own WebCodecs MP4. No server, no ffmpeg, no GPU-container recipe — just
// JSON → MP4, locally. (The hosted/cloud rendering pipeline is separate.)

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser, type LaunchOptions } from 'playwright';
import { HARNESS_JS } from './harness/embedded.js';
import type { RenderOptions, RenderResult } from './types.js';

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const HARNESS_HTML = `<!doctype html><html><body></body></html>`;

// WebCodecs' VideoEncoder (used by the runtime's MP4 exporter) is gated to
// secure contexts. about:blank isn't one; http://127.0.0.1 is. So we serve the
// harness page from a throwaway localhost server for the render's lifetime.
async function startHarnessServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HARNESS_HTML);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// On GPU-less Linux / CI, pin ANGLE's SwiftShader software path so WebGL2 works
// headless. On macOS / Windows, plain headless uses the system GPU. We always
// use *system* Chrome (channel: 'chrome') because Playwright's bundled chromium
// is the headless_shell variant and ships without WebCodecs.
const ON_LINUX = process.platform === 'linux';
const SOFTWARE_GL = ['--enable-unsafe-webgpu', '--use-angle=swiftshader'];
const BASE_FLAGS = ['--no-sandbox', '--disable-dev-shm-usage'];

/**
 * Render a ClipKit `Source` to an MP4 buffer using local headless Chrome.
 *
 * Requires Google Chrome (or Chromium) installed on the machine.
 *
 * ```ts
 * import { render } from '@clipkit/renderer';
 * const { buffer } = await render({ source });
 * await writeFile('out.mp4', buffer);
 * ```
 */
export async function render(options: RenderOptions): Promise<RenderResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const width = options.source.width ?? 1920;
  const height = options.source.height ?? 1080;

  const launchOpts: LaunchOptions = ON_LINUX
    ? {
        // New-headless is the full browser (needed for WebCodecs); pass it
        // explicitly with headless:false so Playwright doesn't add legacy --headless.
        headless: false,
        args: options.showBrowser
          ? [...SOFTWARE_GL, ...BASE_FLAGS]
          : [...SOFTWARE_GL, ...BASE_FLAGS, '--headless=new'],
        channel: 'chrome',
      }
    : {
        headless: !options.showBrowser,
        args: BASE_FLAGS,
        channel: 'chrome',
      };

  let browser: Browser | null = null;
  let harnessServer: { url: string; close: () => Promise<void> } | null = null;
  try {
    harnessServer = await startHarnessServer();
    browser = await chromium.launch(launchOpts);
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();

    if (options.onLog) {
      page.on('console', (m) => options.onLog!(`[page:${m.type()}] ${m.text()}`));
    }

    let resolveResult!: (buf: Buffer) => void;
    let rejectResult!: (err: Error) => void;
    const resultPromise = new Promise<Buffer>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });

    await page.exposeFunction('__clipkitReportProgress', (frame: number, total: number) => {
      options.onProgress?.(frame, total);
    });
    await page.exposeFunction('__clipkitReportError', (message: string) => {
      rejectResult(new Error(`render harness error:\n${message}`));
    });
    await page.exposeFunction('__clipkitReportResult', (base64Mp4: string) => {
      try {
        resolveResult(Buffer.from(base64Mp4, 'base64'));
      } catch (err) {
        rejectResult(err instanceof Error ? err : new Error(String(err)));
      }
    });

    page.on('pageerror', (err) => rejectResult(new Error(`page error: ${err.message}`)));
    page.on('crash', () => rejectResult(new Error('chromium tab crashed during render')));

    // localhost = secure context, so WebCodecs is available.
    await page.goto(harnessServer.url, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ content: HARNESS_JS });

    page
      .evaluate(
        ([sourceJson, backend, resolution, bitrate]) => {
          const src = JSON.parse(sourceJson);
          const w = window as Window & { runHarness: (s: unknown, o: unknown) => Promise<void> };
          const opts: { backend: string; resolution?: string; bitrate?: number } = { backend };
          if (resolution) opts.resolution = resolution;
          if (bitrate) opts.bitrate = bitrate;
          return w.runHarness(src, opts);
        },
        [
          JSON.stringify(options.source),
          options.backend ?? 'auto',
          options.resolution ?? '',
          options.bitrate ?? 0,
        ] as const,
      )
      .catch((err) => {
        // Browser close during a long render races with page.evaluate; the real
        // error is already on resultPromise. Swallow the cascade.
        void err;
      });

    let timer: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`render timed out after ${timeoutMs} ms`)),
        timeoutMs,
      );
    });

    try {
      const buffer = await Promise.race([resultPromise, timeoutPromise]);
      return {
        buffer,
        ext: 'mp4',
        mime: 'video/mp4',
        width,
        height,
        durationSec: typeof options.source.duration === 'number' ? options.source.duration : 0,
        frameRate: options.source.frame_rate ?? 30,
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (harnessServer) await harnessServer.close().catch(() => {});
  }
}
