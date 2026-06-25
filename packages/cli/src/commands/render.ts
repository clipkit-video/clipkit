// `clipkit render <file> -o out.mp4` — render a Source to a video file.
//
// Two engines:
//   • local (default): headless Chrome via @clipkit/renderer — free, runs
//     on your machine, needs Google Chrome installed. The package is an optional
//     peer; if it (or Playwright) isn't present we say so and point at --cloud.
//   • --cloud: the hosted GPU path. POSTs to /api/v1/renders, polls the job to
//     completion, downloads the signed output. Needs an API key (clipkit login)
//     and consumes render credits.

import { Command } from 'commander';
import { writeFile } from 'node:fs/promises';
import { validate } from '@clipkit/protocol';
import type { Source } from '@clipkit/protocol';
import { loadSource } from '../load-source.js';
import { resolveApiKey, resolveApiUrl } from '../config.js';
import { printValidationErrors, fmtBytes, sleep } from '../util.js';

type Resolution = 'source' | '720p' | '1080p' | '1440p' | '4k';
const RESOLUTIONS: Resolution[] = ['source', '720p', '1080p', '1440p', '4k'];
type Backend = 'auto' | 'webgpu' | 'webgl2';

interface RenderOpts {
  out: string;
  cloud?: boolean;
  local?: boolean;
  resolution: string;
  format?: string;
  bitrate?: string;
  backend: string;
  apiKey?: string;
  apiUrl?: string;
}

// Minimal structural view of @clipkit/renderer so this file typechecks
// and publishes without the (optional, heavy) engine being resolvable.
interface RendererModule {
  render(opts: {
    source: Source;
    backend?: Backend;
    resolution?: Resolution;
    bitrate?: number;
    onProgress?: (frame: number, total: number) => void;
  }): Promise<{
    buffer: Buffer;
    width: number;
    height: number;
    durationSec: number;
  }>;
}

const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;

export function renderCommand(program: Command): void {
  program
    .command('render <file>')
    .description('Render a Source to a video file (local Chrome by default; --cloud for hosted)')
    .option('-o, --out <path>', 'output file path', 'output.mp4')
    .option('--cloud', 'render on Clipkit’s servers (needs login; uses credits)', false)
    .option('--local', 'render locally with headless Chrome (the default)', false)
    .option('-r, --resolution <res>', 'source | 720p | 1080p | 1440p | 4k', 'source')
    .option('-f, --format <fmt>', 'output format (mp4 default; pro formats are cloud-only)')
    .option('--bitrate <bps>', 'override video bitrate in bits/second')
    .option('-b, --backend <backend>', 'local engine backend: auto | webgpu | webgl2', 'auto')
    .option('--api-key <key>', 'API key for --cloud (defaults to login / CLIPKIT_API_KEY)')
    .option('--api-url <url>', 'override the API host')
    .action(async (file: string, opts: RenderOpts) => {
      const { path, source } = await loadSource(file);
      const result = validate(source);
      if (!result.valid) {
        printValidationErrors(path, result.errors);
        process.exit(1);
      }
      if (!RESOLUTIONS.includes(opts.resolution as Resolution)) {
        process.stderr.write(
          `✗ invalid --resolution "${opts.resolution}" (expected ${RESOLUTIONS.join(' | ')}).\n`,
        );
        process.exit(1);
      }
      let bitrate: number | undefined;
      if (opts.bitrate) {
        bitrate = Number(opts.bitrate);
        if (!Number.isFinite(bitrate) || bitrate <= 0) {
          process.stderr.write(`✗ invalid --bitrate "${opts.bitrate}".\n`);
          process.exit(1);
        }
      }

      const validated = result.data as Source;
      if (opts.cloud) await renderCloud(validated, opts, bitrate);
      else await renderLocal(validated, opts, bitrate);
    });
}

async function renderLocal(source: Source, opts: RenderOpts, bitrate?: number): Promise<void> {
  if (!isBackend(opts.backend)) {
    process.stderr.write(
      `✗ invalid --backend "${opts.backend}" (expected auto | webgpu | webgl2).\n`,
    );
    process.exit(1);
  }

  if (opts.format && opts.format !== 'mp4') {
    process.stderr.write(
      `✗ "${opts.format}" is a cloud-only format — local rendering outputs mp4.\n` +
        `  Render it on the cloud:  clipkit render <file> --cloud --format ${opts.format}\n`,
    );
    process.exit(1);
  }

  let mod: RendererModule;
  try {
    mod = (await import('@clipkit/renderer')) as unknown as RendererModule;
  } catch {
    process.stderr.write(
      'Local rendering needs the @clipkit/renderer engine (and Google Chrome).\n\n' +
        '  npm i -g @clipkit/renderer playwright\n\n' +
        'Then re-run, or render in the cloud instead:\n' +
        '  clipkit render <file> --cloud\n',
    );
    process.exit(1);
  }

  process.stderr.write('Rendering locally (headless Chrome)…\n');
  let res: Awaited<ReturnType<RendererModule['render']>>;
  try {
    res = await mod.render({
      source,
      backend: opts.backend,
      resolution: opts.resolution as Resolution,
      ...(bitrate ? { bitrate } : {}),
      onProgress: (frame, total) => drawProgress(frame, total),
    });
  } catch (e) {
    clearProgress();
    process.stderr.write(`✗ Local render failed: ${e instanceof Error ? e.message : String(e)}\n`);
    process.stderr.write(
      '  (Local rendering uses your installed Google Chrome. Install it, or use --cloud.)\n',
    );
    process.exit(1);
  }

  clearProgress();
  await writeFile(opts.out, res.buffer);
  process.stdout.write(
    `✓ Rendered ${res.width}×${res.height}, ${res.durationSec.toFixed(1)}s → ${opts.out} (${fmtBytes(res.buffer.length)})\n`,
  );
}

async function renderCloud(source: Source, opts: RenderOpts, bitrate?: number): Promise<void> {
  const apiUrl = await resolveApiUrl(opts.apiUrl);
  const apiKey = await resolveApiKey(opts.apiKey);
  if (!apiKey) {
    process.stderr.write(
      'Cloud rendering needs an API key.\n\n  clipkit login\n\n' +
        'or set CLIPKIT_API_KEY / pass --api-key. (Local rendering is free — just drop --cloud.)\n',
    );
    process.exit(1);
  }

  const body: Record<string, unknown> = { source };
  if (opts.resolution && opts.resolution !== 'source') body.resolution = opts.resolution;
  if (opts.format) body.format = opts.format;
  if (bitrate) body.bitrate = bitrate;

  // ── Submit (enqueue). The route returns immediately with a job id.
  let submit: Response;
  try {
    submit = await fetch(`${apiUrl}/api/v1/renders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
  } catch (e) {
    process.stderr.write(
      `✗ Could not reach ${apiUrl}: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    process.exit(1);
  }

  if (submit.status === 401) {
    process.stderr.write('✗ Unauthorized — your key was rejected. Run `clipkit login` again.\n');
    process.exit(1);
  }
  if (submit.status === 402) {
    const data = (await submit.json().catch(() => ({}))) as {
      message?: string;
      upgrade_url?: string;
    };
    process.stderr.write(`✗ ${data.message ?? 'Out of render credits.'}\n`);
    if (data.upgrade_url) process.stderr.write(`  Upgrade: ${apiUrl}${data.upgrade_url}\n`);
    process.exit(1);
  }
  if (submit.status === 413) {
    process.stderr.write('✗ Source too large (2 MB max).\n');
    process.exit(1);
  }
  if (!submit.ok) {
    const t = await submit.text().catch(() => '');
    process.stderr.write(`✗ Render submission failed (${submit.status}). ${t.slice(0, 300)}\n`);
    process.exit(1);
  }

  const queued = (await submit.json()) as { id: string; credits_reserved?: number };
  process.stderr.write(
    `Queued render ${queued.id}${queued.credits_reserved ? ` (${queued.credits_reserved} credits reserved)` : ''}. Waiting…\n`,
  );

  // ── Poll until done/failed.
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let outputUrl: string | null = null;
  for (;;) {
    if (Date.now() > deadline) {
      clearProgress();
      process.stderr.write('\n✗ Timed out waiting for the render (10 min). Check the dashboard.\n');
      process.exit(1);
    }
    await sleep(POLL_INTERVAL_MS);
    let poll: Response;
    try {
      poll = await fetch(`${apiUrl}/api/v1/renders/${queued.id}`, {
        headers: { authorization: `Bearer ${apiKey}` },
      });
    } catch {
      continue; // transient — keep trying until the deadline
    }
    if (!poll.ok) continue;
    const s = (await poll.json()) as {
      status: string;
      progress?: number;
      error?: string | null;
      output_url?: string | null;
    };
    if (s.status === 'done') {
      clearProgress();
      outputUrl = s.output_url ?? null;
      break;
    }
    if (s.status === 'failed') {
      clearProgress();
      process.stderr.write(`\n✗ Render failed: ${s.error ?? 'unknown error'}\n`);
      process.exit(1);
    }
    drawProgress(Math.round((s.progress ?? 0) * 100), 100);
  }

  if (!outputUrl) {
    process.stderr.write('✗ Render finished but returned no download URL.\n');
    process.exit(1);
  }

  // ── Download the signed output.
  process.stderr.write('Downloading…\n');
  const dl = await fetch(outputUrl);
  if (!dl.ok) {
    process.stderr.write(`✗ Download failed (${dl.status}).\n`);
    process.exit(1);
  }
  const buf = Buffer.from(await dl.arrayBuffer());
  await writeFile(opts.out, buf);
  process.stdout.write(`✓ Rendered in the cloud → ${opts.out} (${fmtBytes(buf.length)})\n`);
}

function isBackend(v: string): v is Backend {
  return v === 'auto' || v === 'webgpu' || v === 'webgl2';
}

function drawProgress(frame: number, total: number): void {
  if (!process.stderr.isTTY) return;
  const pct = total > 0 ? Math.min(100, Math.round((frame / total) * 100)) : 0;
  const width = 24;
  const filled = Math.round((pct / 100) * width);
  process.stderr.write(
    `\r  [${'█'.repeat(filled)}${'░'.repeat(width - filled)}] ${pct}%${total === 100 ? '' : ` (${frame}/${total})`}`,
  );
}

function clearProgress(): void {
  if (process.stderr.isTTY) process.stderr.write(`\r${' '.repeat(60)}\r`);
}
