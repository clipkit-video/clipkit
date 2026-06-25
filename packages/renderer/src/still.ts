// Single-frame render — returns a PNG Buffer of the composition at one time.
// Uses a Playwright element screenshot of the harness canvas (no WebCodecs, so
// it works regardless of preserveDrawingBuffer).

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { chromium, type Browser, type LaunchOptions } from 'playwright';
import type { Source } from '@clipkit/protocol';
import { HARNESS_JS } from './harness/embedded.js';

const DEFAULT_TIMEOUT_MS = 60 * 1000;
const HARNESS_HTML = `<!doctype html><html><body></body></html>`;

const ON_LINUX = process.platform === 'linux';
const SOFTWARE_GL = ['--enable-unsafe-webgpu', '--use-angle=swiftshader'];
const BASE_FLAGS = ['--no-sandbox', '--disable-dev-shm-usage'];
const CHROMIUM_FLAGS = ON_LINUX ? [...SOFTWARE_GL, ...BASE_FLAGS] : BASE_FLAGS;

const MIME: Record<string, string> = {
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

export interface StillOptions {
  /** The Source to render. */
  source: Source;
  /** Composition time in seconds to capture. Default 0. */
  time?: number;
  /** Runtime backend preference. Default 'auto'. */
  backend?: 'auto' | 'webgpu' | 'webgl2';
  /**
   * Directory served at the harness origin's root, so the Source can reference
   * sidecar assets (e.g. local fonts) by absolute path. Path traversal 404s.
   */
  staticRoot?: string;
  /** Hard timeout in milliseconds. Default 60s. */
  timeoutMs?: number;
  /** Show the Chrome window instead of headless (debugging). */
  showBrowser?: boolean;
}

async function startStillServer(
  staticRoot?: string,
): Promise<{ url: string; close: () => Promise<void> }> {
  const root = staticRoot ? resolve(staticRoot) : null;
  const server: Server = createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]!);
    if (urlPath === '/' || !root) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(HARNESS_HTML);
      return;
    }
    const filePath = normalize(join(root, urlPath));
    if (!filePath.startsWith(root + sep) || !existsSync(filePath) || !statSync(filePath).isFile()) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
    });
    createReadStream(filePath).pipe(res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Render one frame of `source` at `time` seconds; resolves to PNG bytes. */
export async function renderStill(options: StillOptions): Promise<Buffer> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const launchOpts: LaunchOptions = {
    headless: !options.showBrowser,
    args: CHROMIUM_FLAGS,
    channel: 'chrome',
  };

  let browser: Browser | null = null;
  let server: { url: string; close: () => Promise<void> } | null = null;
  try {
    server = await startStillServer(options.staticRoot);
    browser = await chromium.launch(launchOpts);
    const context = await browser.newContext({
      viewport: {
        width: options.source.width ?? 1920,
        height: options.source.height ?? 1080,
      },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();

    let resolveReady!: () => void;
    let rejectReady!: (err: Error) => void;
    const readyPromise = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });

    await page.exposeFunction('__clipkitStillReady', () => resolveReady());
    await page.exposeFunction('__clipkitReportError', (message: string) => {
      rejectReady(new Error(`render harness error:\n${message}`));
    });
    page.on('pageerror', (err) => rejectReady(new Error(`page error: ${err.message}`)));
    page.on('crash', () => rejectReady(new Error('chromium tab crashed during still render')));

    await page.goto(server.url, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ content: HARNESS_JS });

    page
      .evaluate(
        ([sourceJson, time, backend]) => {
          const src = JSON.parse(sourceJson as string);
          return (
            window as Window & { renderStill: (s: unknown, o: unknown) => Promise<void> }
          ).renderStill(src, { time, backend });
        },
        [JSON.stringify(options.source), options.time ?? 0, options.backend ?? 'auto'] as const,
      )
      .catch(() => {
        // Errors surface via __clipkitReportError / pageerror; the evaluate
        // rejection here is the browser-close race.
      });

    let timer: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`still render timed out after ${timeoutMs} ms`)),
        timeoutMs,
      );
    });
    try {
      await Promise.race([readyPromise, timeoutPromise]);
    } finally {
      if (timer) clearTimeout(timer);
    }

    return await page.locator('#__clipkit_still').screenshot({ type: 'png' });
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) await server.close().catch(() => {});
  }
}
