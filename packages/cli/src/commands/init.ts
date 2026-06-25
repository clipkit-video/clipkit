// `clipkit init [name]` — scaffold a new Clipkit project.
//
// Creates a directory with package.json + tsconfig.json + video.ts +
// README.md + AGENTS.md (copied so AI agents working in this project
// auto-load it as context). The video.ts starts as a minimal but
// brand-correct dark composition the user can immediately render.

import { mkdir, writeFile, access } from 'node:fs/promises';
import { join, resolve as resolvePath } from 'node:path';
import { Command } from 'commander';
import { CLIPKIT_PROTOCOL_VERSION } from '@clipkit/protocol';
import { AGENTS_MD_CONTENT } from '../templates/agents-content.js';

export function initCommand(program: Command): void {
  program
    .command('init [name]')
    .description('Scaffold a new Clipkit project in a fresh directory')
    .option('-f, --force', 'overwrite the directory if it already exists', false)
    .action(async (name: string | undefined, opts: { force?: boolean }) => {
      const projectName = name ?? 'my-video';
      const projectDir = resolvePath(process.cwd(), projectName);

      // Refuse to clobber unless --force.
      const exists = await pathExists(projectDir);
      if (exists && !opts.force) {
        throw new Error(
          `${projectDir} already exists. Re-run with --force to overwrite, or pick a different name.`,
        );
      }

      await mkdir(projectDir, { recursive: true });

      await writeFile(join(projectDir, 'package.json'), packageJson(projectName));
      await writeFile(join(projectDir, 'tsconfig.json'), tsconfigJson());
      await writeFile(join(projectDir, 'video.ts'), videoTs());
      await writeFile(join(projectDir, 'README.md'), readmeMd(projectName));
      await writeFile(join(projectDir, 'AGENTS.md'), AGENTS_MD_CONTENT);
      await writeFile(join(projectDir, '.gitignore'), gitignore());

      process.stdout.write(
        `Created ${projectName}/\n\n` +
          `  cd ${projectName}\n` +
          `  npm install\n` +
          `  npx clipkit preview video.ts     # browser preview\n` +
          `  npx clipkit render  video.ts     # render to MP4\n\n` +
          `Conforms to Clipkit Protocol v${CLIPKIT_PROTOCOL_VERSION}.\n`,
      );
    });
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function packageJson(name: string): string {
  return (
    JSON.stringify(
      {
        name,
        version: '0.0.0',
        private: true,
        type: 'module',
        scripts: {
          validate: 'clipkit validate video.ts',
          preview: 'clipkit preview video.ts',
          render: 'clipkit render video.ts -o output.mp4',
        },
        dependencies: {
          '@clipkit/protocol': '*',
          '@clipkit/patterns': '*',
        },
        devDependencies: {
          '@clipkit/cli': '*',
          typescript: '^5.7.0',
        },
      },
      null,
      2,
    ) + '\n'
  );
}

function tsconfigJson(): string {
  return (
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          strict: true,
          skipLibCheck: true,
          resolveJsonModule: true,
          noEmit: true,
        },
        include: ['*.ts'],
      },
      null,
      2,
    ) + '\n'
  );
}

function videoTs(): string {
  return `import type { Source } from '@clipkit/protocol';
import { CLIPKIT_PROTOCOL_VERSION } from '@clipkit/protocol';

// A minimal Clipkit Source. Edit freely — the schema is JSON-shaped at
// runtime; the TypeScript types are just authoring assistance.
//
// See AGENTS.md for the schema cheat sheet, pattern catalog, and recipes.

const source: Source = {
  clipkit_version: CLIPKIT_PROTOCOL_VERSION,
  width: 1920,
  height: 1080,
  duration: 6,
  frame_rate: 30,
  elements: [
    // Dark background.
    {
      id: 'bg',
      type: 'shape',
      layer: 2,
      time: 0,
      duration: 6,
      shape: 'rectangle',
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      fill_color: '#0A0A0A',
    },

    // Hero text — Geist 600, spring scale-in.
    {
      id: 'title',
      type: 'text',
      layer: 1,
      time: 0.4,
      duration: 5.6,
      text: 'Hello, Clipkit',
      x: 960,
      y: 540,
      x_anchor: 0.5,
      y_anchor: 0.5,
      font_family: 'Geist, Helvetica Neue, Arial, sans-serif',
      font_size: 160,
      font_weight: '600',
      letter_spacing: -5,
      fill_color: '#FAFAFA',
      animations: [
        { type: 'fade-in', duration: 0.5 },
        { type: 'scale-in', duration: 1.0, easing: 'spring' },
      ],
    },
  ],
};

export default source;
`;
}

function readmeMd(name: string): string {
  return `# ${name}

A Clipkit video project.

## Scripts

\`\`\`bash
npm run validate    # schema-check video.ts
npm run preview     # open the browser preview
npm run render      # render to output.mp4
\`\`\`

## Authoring

\`video.ts\` exports a Clipkit \`Source\` — a JSON-shaped object describing
the composition. The TypeScript types come from \`@clipkit/protocol\`; the
[Clipkit Protocol](https://clipkit.dev/spec) defines the format.

See [\`AGENTS.md\`](./AGENTS.md) for the authoring reference. It's also
auto-loaded by AI agents (Claude Code, Cursor, etc.) when they work in
this directory.
`;
}

function gitignore(): string {
  return `node_modules
dist
output.mp4
*.tsbuildinfo
.DS_Store
`;
}
