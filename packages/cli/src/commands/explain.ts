// `clipkit explain <file>` — a plain-language read-back of a Source so you (or
// an agent) can sanity-check what was authored WITHOUT rendering: dimensions,
// fps, duration, a per-track timeline, an element breakdown, plus protocol-aware
// warnings. The fast inner loop of an author→verify→fix cycle. The summary logic
// lives in @clipkit/lint so the MCP server can reuse it.

import { Command } from 'commander';
import { validate } from '@clipkit/protocol';
import type { Source } from '@clipkit/protocol';
import { describe } from '@clipkit/lint';
import { loadSource } from '../load-source.js';
import { printValidationErrors } from '../util.js';

export function explainCommand(program: Command): void {
  program
    .command('explain <file>')
    .description('Summarize a Source in plain language (timeline, elements, warnings)')
    .action(async (file: string) => {
      const { path, source } = await loadSource(file);
      const result = validate(source);
      if (!result.valid) {
        printValidationErrors(path, result.errors);
        process.stderr.write('\n(`explain` describes valid Sources — fix the errors above first.)\n');
        process.exit(1);
      }
      process.stdout.write(describe(result.data as Source));
    });
}
