#!/usr/bin/env node
// Bundle src/harness/harness.ts (including @clipkit/runtime + @clipkit/protocol
// and all their deps) into a single self-contained ESM script via esbuild,
// then emit src/harness/embedded.ts with the bundle inlined as a string
// constant. The worker injects that string into the page via
// page.addScriptTag({ content: HARNESS_JS }).
//
// Done at build time so the package is self-contained — no on-disk
// asset paths to resolve at runtime, works the same from any install
// location.

import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(__dirname, '..');
const entry = join(pkgRoot, 'src', 'harness', 'harness.ts');
const tmpOut = join(pkgRoot, 'dist', '.tmp-harness.js');
const tsOut = join(pkgRoot, 'src', 'harness', 'embedded.ts');

mkdirSync(dirname(tmpOut), { recursive: true });

await build({
  entryPoints: [entry],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  outfile: tmpOut,
  // Minify to keep the embedded constant small. The harness ships inside
  // the worker bundle so every KB counts.
  minify: true,
  sourcemap: false,
  // Suppress warnings about @clipkit/runtime's Node-style logger imports.
  // The harness only runs in Chromium so those code paths are fine.
  logLevel: 'warning',
});

const js = readFileSync(tmpOut, 'utf8');
const escaped = js
  .replace(/\\/g, '\\\\')
  .replace(/`/g, '\\`')
  .replace(/\$\{/g, '\\${');

const out =
  `// AUTO-GENERATED — do not edit by hand.\n` +
  `// Source: scripts/build-harness.mjs (runs via npm run prebuild).\n` +
  `\n` +
  `export const HARNESS_JS = \`${escaped}\`;\n`;

mkdirSync(dirname(tsOut), { recursive: true });
writeFileSync(tsOut, out);
console.error(`[build-harness] wrote ${tsOut} (${(js.length / 1024).toFixed(1)} KB minified)`);
