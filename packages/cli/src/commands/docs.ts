// `clipkit docs [topic]` — print the canonical authoring docs to stdout, so an
// agent can pull the spec into context in one command:
//   clipkit docs protocol > .context.md
// Docs are embedded at build time (see scripts/embed-agents.mjs) — no network,
// no dependence on the repo layout.

import { Command } from 'commander';
import {
  AGENTS_MD_CONTENT,
  CARD_MD_CONTENT,
  PROTOCOL_MD_CONTENT,
  PATTERN_DATA_VIZ_CONTENT,
  PATTERN_CINEMATIC_UI_CONTENT,
  PATTERN_UI_SCREENCAST_CONTENT,
} from '../templates/agents-content.js';

const TOPICS: Record<string, string> = {
  agents: AGENTS_MD_CONTENT,
  protocol: PROTOCOL_MD_CONTENT,
  card: CARD_MD_CONTENT,
  'pattern-data-viz': PATTERN_DATA_VIZ_CONTENT,
  'pattern-cinematic-ui': PATTERN_CINEMATIC_UI_CONTENT,
  'pattern-ui-screencast': PATTERN_UI_SCREENCAST_CONTENT,
};

export function docsCommand(program: Command): void {
  program
    .command('docs [topic]')
    .description(
      'Print authoring docs (card = compact agent context, pattern-<name> = archetype pattern cards, agents, protocol; default: agents)',
    )
    .action((topic?: string) => {
      const key = (topic ?? 'agents').toLowerCase();
      if (key === 'list') {
        process.stdout.write(
          'Available docs:\n' +
            '  card                   — the ~8KB compact authoring card (recommended agent context)\n' +
            '  pattern-data-viz       — pattern card: count-ups, bar/progress rows\n' +
            '  pattern-cinematic-ui   — pattern card: product hero shots, camera rigs\n' +
            '  pattern-ui-screencast  — pattern card: faked app UI, typing, cursor, clicks\n' +
            '  agents                 — the full authoring guide (how to compose Sources)\n' +
            '  protocol               — formal field semantics (PROTOCOL.md)\n',
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
