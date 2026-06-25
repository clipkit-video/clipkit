// `clipkit still <file> -o poster.png` — render ONE frame of a Source to a PNG,
// locally (headless Chrome via @clipkit/renderer). A fast visual sanity
// check / thumbnail without a full encode. Same engine + setup as
// `render --local` (the package is an optional peer; needs Google Chrome).

import { Command } from 'commander';
import { writeFile } from 'node:fs/promises';
import { validate } from '@clipkit/protocol';
import type { Source } from '@clipkit/protocol';
import { loadSource } from '../load-source.js';
import { printValidationErrors, fmtBytes } from '../util.js';

type Backend = 'auto' | 'webgpu' | 'webgl2';

// Minimal structural view of @clipkit/renderer's renderStill, so this
// file typechecks and publishes without the optional engine being resolvable.
interface StillModule {
  renderStill(opts: {
    source: Source;
    time?: number;
    backend?: Backend;
    timeoutMs?: number;
  }): Promise<Buffer>;
}

export function stillCommand(program: Command): void {
  program
    .command('still <file>')
    .description('Render one frame of a Source to a PNG (local headless Chrome)')
    .option('-o, --out <path>', 'output PNG path', 'still.png')
    .option('-t, --time <seconds>', 'composition time to capture', '0')
    .option('-b, --backend <backend>', 'auto | webgpu | webgl2', 'auto')
    .action(async (file: string, opts: { out: string; time: string; backend: string }) => {
      const { path, source } = await loadSource(file);
      const result = validate(source);
      if (!result.valid) {
        printValidationErrors(path, result.errors);
        process.exit(1);
      }
      const time = Number(opts.time);
      if (!Number.isFinite(time) || time < 0) {
        process.stderr.write(`✗ invalid --time "${opts.time}".\n`);
        process.exit(1);
      }
      if (!isBackend(opts.backend)) {
        process.stderr.write(`✗ invalid --backend "${opts.backend}" (expected auto | webgpu | webgl2).\n`);
        process.exit(1);
      }

      let mod: StillModule;
      try {
        mod = (await import('@clipkit/renderer')) as unknown as StillModule;
      } catch {
        process.stderr.write(
          'Stills need the @clipkit/renderer engine (and Google Chrome).\n\n' +
            '  npm i -g @clipkit/renderer playwright\n',
        );
        process.exit(1);
      }

      process.stderr.write(`Capturing frame at ${time}s…\n`);
      let png: Buffer;
      try {
        png = await mod.renderStill({ source: result.data as Source, time, backend: opts.backend });
      } catch (e) {
        process.stderr.write(
          `✗ Still failed: ${e instanceof Error ? e.message : String(e)}\n` +
            '  (Local stills use your installed Google Chrome.)\n',
        );
        process.exit(1);
      }

      await writeFile(opts.out, png);
      process.stdout.write(`✓ Wrote ${opts.out} (${fmtBytes(png.length)})\n`);
    });
}

function isBackend(v: string): v is Backend {
  return v === 'auto' || v === 'webgpu' || v === 'webgl2';
}
