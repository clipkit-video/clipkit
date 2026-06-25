// `clipkit new <template>` — scaffold a known-good, render-tested Source from
// the @clipkit/patterns library. An idiomatic starting point beats authoring
// from a blank file: fewer schema errors, better-looking output. Writes JSON to
// stdout (pipeable) or to --out. This is the CLI twin of the MCP create_promo
// composer.

import { Command } from 'commander';
import { writeFile } from 'node:fs/promises';
import {
  promo,
  heroReveal,
  kineticHeadline,
  introCard,
  ctaOutro,
  type Scene,
  type SceneCtx,
  type ColorName,
  type ThemeName,
} from '@clipkit/patterns';

const COLOR: ColorName = 'green';
const THEMES: ThemeName[] = ['cinematic', 'mux', 'minimal'];

function base(ctx: SceneCtx) {
  return {
    id: ctx.id,
    theme: ctx.theme,
    time: ctx.time,
    duration: ctx.duration,
    layer: ctx.layer,
    color: COLOR,
    canvasWidth: ctx.canvasWidth,
    canvasHeight: ctx.canvasHeight,
  };
}

function heroScene(wordmark: string, tagline?: string): Scene {
  return { duration: 2.6, build: (ctx) => heroReveal({ ...base(ctx), wordmark, tagline }) };
}
function kineticScene(text: string, subtitle?: string): Scene {
  return { duration: 2.2, build: (ctx) => kineticHeadline({ ...base(ctx), text, subtitle }) };
}
function titleScene(headline: string, kicker?: string, subtitle?: string): Scene {
  return { duration: 2.4, build: (ctx) => introCard({ ...base(ctx), headline, kicker, subtitle }) };
}
function ctaScene(wordmark: string, tagline: string, cta: string): Scene {
  return { duration: 2.0, build: (ctx) => ctaOutro({ ...base(ctx), wordmark, tagline, cta }) };
}

const TEMPLATES: Record<string, () => Scene[]> = {
  promo: () => [heroScene('ACME', 'Your tagline here'), ctaScene('ACME', 'Your tagline here', 'Get started')],
  hero: () => [heroScene('ACME', 'Your tagline here')],
  kinetic: () => [kineticScene('Make it move', 'with Clipkit')],
  title: () => [titleScene('Your headline', 'KICKER', 'A supporting subtitle')],
  cta: () => [ctaScene('ACME', 'Your tagline here', 'Get started')],
};

export function newCommand(program: Command): void {
  program
    .command('new <template>')
    .description(`Scaffold a Source from the pattern library (${Object.keys(TEMPLATES).join(' | ')})`)
    .option('-o, --out <path>', 'write to a file (default: print to stdout)')
    .option('--theme <theme>', `${THEMES.join(' | ')}`, 'cinematic')
    .option('--width <px>', 'composition width', '1280')
    .option('--height <px>', 'composition height', '720')
    .action(
      async (
        template: string,
        opts: { out?: string; theme: string; width: string; height: string },
      ) => {
        const make = TEMPLATES[template];
        if (!make) {
          process.stderr.write(
            `✗ unknown template "${template}". Try one of: ${Object.keys(TEMPLATES).join(', ')}.\n`,
          );
          process.exit(1);
        }
        if (!THEMES.includes(opts.theme as ThemeName)) {
          process.stderr.write(`✗ invalid --theme "${opts.theme}" (expected ${THEMES.join(' | ')}).\n`);
          process.exit(1);
        }
        const width = Number(opts.width);
        const height = Number(opts.height);
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
          process.stderr.write('✗ --width / --height must be positive numbers.\n');
          process.exit(1);
        }

        const source = promo({ theme: opts.theme as ThemeName, scenes: make(), width, height });
        const json = JSON.stringify(source, null, 2);

        if (opts.out) {
          await writeFile(opts.out, `${json}\n`);
          process.stderr.write(
            `✓ Wrote ${template} template → ${opts.out} (${source.elements.length} elements, ${source.duration}s).\n` +
              `  Edit the placeholder text, then preview it:  clipkit preview ${opts.out}\n`,
          );
        } else {
          process.stdout.write(`${json}\n`);
        }
      },
    );
}
