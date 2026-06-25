#!/usr/bin/env node
// @clipkit/cli — local-first authoring + validation + rendering surface.
//
// Subcommands, each in its own file under ./commands:
//   clipkit init [name]            — scaffold a project
//   clipkit new <template>         — scaffold a Source from the pattern library
//   clipkit validate <file>        — schema-check a Source (--explain for hints)
//   clipkit explain <file>         — plain-language read-back + warnings
//   clipkit preview <file>         — open a Source in the web editor (share link)
//   clipkit render <file> --out X  — render to a video file (local or --cloud)
//   clipkit still <file> --out X   — render one frame to a PNG
//   clipkit transcribe <file>      — audio/video → caption words (local Whisper)
//   clipkit docs [topic]           — print the authoring docs / protocol spec
//   clipkit schema                 — print the protocol JSON Schema
//   clipkit mcp                    — run the MCP server (wire up an AI agent)
//   clipkit login / logout         — store an API key for the cloud commands

import { Command } from 'commander';
import { CLIPKIT_PROTOCOL_VERSION } from '@clipkit/protocol';
import { initCommand } from './commands/init.js';
import { newCommand } from './commands/new.js';
import { validateCommand } from './commands/validate.js';
import { explainCommand } from './commands/explain.js';
import { previewCommand } from './commands/preview.js';
import { renderCommand } from './commands/render.js';
import { stillCommand } from './commands/still.js';
import { transcribeCommand } from './commands/transcribe.js';
import { docsCommand } from './commands/docs.js';
import { schemaCommand } from './commands/schema.js';
import { mcpCommand } from './commands/mcp.js';
import { loginCommand } from './commands/login.js';

const program = new Command();

program
  .name('clipkit')
  .description(
    `The Clipkit CLI — author and render Clipkit Protocol videos locally.\n` +
      `Implements Clipkit Protocol v${CLIPKIT_PROTOCOL_VERSION} (CKP/${CLIPKIT_PROTOCOL_VERSION}).`,
  )
  .version('0.0.0', '-v, --version', 'print the CLI version');

initCommand(program);
newCommand(program);
validateCommand(program);
explainCommand(program);
previewCommand(program);
renderCommand(program);
stillCommand(program);
transcribeCommand(program);
docsCommand(program);
schemaCommand(program);
mcpCommand(program);
loginCommand(program);

program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(
    `\nclipkit: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
