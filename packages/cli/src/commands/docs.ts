// `clipkit docs [topic]` — print the canonical authoring docs to stdout, so an
// agent can pull the spec into context in one command:
//   clipkit docs protocol > .context.md
// Docs are embedded at build time (see scripts/embed-agents.mjs) — no network,
// no dependence on the repo layout.

import { Command } from 'commander';
import { AGENTS_MD_CONTENT, PROTOCOL_MD_CONTENT } from '../templates/agents-content.js';

const TOPICS: Record<string, string> = {
  agents: AGENTS_MD_CONTENT,
  protocol: PROTOCOL_MD_CONTENT,
};

export function docsCommand(program: Command): void {
  program
    .command('docs [topic]')
    .description('Print authoring docs (topics: agents, protocol; default: agents)')
    .action((topic?: string) => {
      const key = (topic ?? 'agents').toLowerCase();
      if (key === 'list') {
        process.stdout.write(
          'Available docs:\n' +
            '  agents    — the authoring guide (how to compose Sources)\n' +
            '  protocol  — formal field semantics (PROTOCOL.md)\n',
        );
        return;
      }
      const doc = TOPICS[key];
      if (!doc) {
        process.stderr.write(
          `✗ unknown topic "${topic}". Try: ${Object.keys(TOPICS).join(', ')} (or "list").\n`,
        );
        process.exit(1);
      }
      process.stdout.write(doc.endsWith('\n') ? doc : `${doc}\n`);
    });
}
