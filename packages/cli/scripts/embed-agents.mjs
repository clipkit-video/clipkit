#!/usr/bin/env node
// Embed AGENTS.md + PROTOCOL.md from the repo root into
// src/templates/agents-content.ts so `clipkit init` can drop AGENTS.md into a
// project and `clipkit docs` can print the spec — both with no runtime FS
// lookup (the compiled CLI runs from arbitrary npm/npx install dirs).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..', '..');
const outFile = join(__dirname, '..', 'src', 'templates', 'agents-content.ts');

const docs = [
  { name: 'AGENTS_MD_CONTENT', path: 'AGENTS.md' },
  { name: 'PROTOCOL_MD_CONTENT', path: 'PROTOCOL.md' },
];

const escape = (s) =>
  s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

let out =
  `// AUTO-GENERATED — do not edit by hand.\n` +
  `// Source: scripts/embed-agents.mjs (run via npm run prebuild).\n\n`;

for (const doc of docs) {
  let content;
  try {
    content = readFileSync(join(repoRoot, doc.path), 'utf8');
  } catch (err) {
    console.error(`[embed-agents] could not read ${doc.path}: ${err.message}`);
    process.exit(1);
  }
  out += `export const ${doc.name} = \`${escape(content)}\`;\n\n`;
}

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, out);
console.error(`[embed-agents] wrote ${outFile} (${docs.length} docs)`);
