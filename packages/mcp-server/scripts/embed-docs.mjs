#!/usr/bin/env node
// Read AGENTS.md and PROTOCOL.md from the repo root and emit
// src/embedded-docs.ts with their contents inlined as string constants.
//
// Why embed instead of read at runtime: the compiled server runs from
// arbitrary install locations (npm install ~/.npm, npx tmp dirs, etc.)
// where the original repo layout is gone. Inlining at build time means
// the server is self-contained — no FS access required to serve docs.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..', '..');
const outFile = join(__dirname, '..', 'src', 'embedded-docs.ts');

const docs = [
  { name: 'AGENTS_MD', path: 'AGENTS.md' },
  { name: 'PROTOCOL_MD', path: 'PROTOCOL.md' },
  { name: 'BRAND_MD', path: 'BRAND.md' },
];

const out = [];
out.push('// AUTO-GENERATED — do not edit by hand.');
out.push('// Source: scripts/embed-docs.mjs (run via npm run prebuild).');
out.push('// Re-run `npm run build` to regenerate after editing the source docs.');
out.push('');

for (const doc of docs) {
  const full = join(repoRoot, doc.path);
  let content;
  try {
    content = readFileSync(full, 'utf8');
  } catch (err) {
    console.error(`[embed-docs] could not read ${doc.path}: ${err.message}`);
    process.exit(1);
  }
  // Use a template literal with backtick escaping. Markdown doesn't usually
  // contain backticks at the file level, but code blocks do — escape them.
  const escaped = content
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${');
  out.push(`export const ${doc.name} = \`${escaped}\`;`);
  out.push('');
}

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, out.join('\n'));
console.error(`[embed-docs] wrote ${outFile} (${docs.length} docs)`);
