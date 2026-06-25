// `clipkit validate <file>` — check a Source against the Clipkit Protocol.
//
// Loads the file (JSON or TS), runs @clipkit/protocol's validator, and reports
// any errors with their JSON path. Exits 0 on success, 1 on failure. With
// `--explain` it also surfaces protocol-aware warnings on success (things that
// validate but the runtime will silently drop/clip) and adds guidance on
// failure.

import { Command } from 'commander';
import { validate, CLIPKIT_PROTOCOL_VERSION } from '@clipkit/protocol';
import type { Source } from '@clipkit/protocol';
import { lintSource } from '@clipkit/lint';
import { loadSource } from '../load-source.js';
import { printValidationErrors } from '../util.js';

export function validateCommand(program: Command): void {
  program
    .command('validate <file>')
    .description('Validate a Clipkit Source against the protocol')
    .option('--explain', 'add protocol-aware warnings (success) and guidance (failure)')
    .action(async (file: string, opts: { explain?: boolean }) => {
      const { path, source } = await loadSource(file);
      const result = validate(source);

      if (result.valid) {
        process.stdout.write(
          `✓ ${path} is a valid Clipkit Protocol v${CLIPKIT_PROTOCOL_VERSION} document.\n`,
        );
        if (opts.explain) {
          const warnings = lintSource(result.data as Source);
          if (warnings.length === 0) {
            process.stdout.write("✓ No warnings — nothing the runtime will silently drop or clip.\n");
          } else {
            process.stdout.write(
              `\n⚠ ${warnings.length} warning${warnings.length === 1 ? '' : 's'} (valid, but worth a look):\n`,
            );
            for (const w of warnings) process.stdout.write(`  - ${w.where}: ${w.message}\n`);
          }
        }
        return;
      }

      printValidationErrors(path, result.errors);
      if (opts.explain) {
        process.stderr.write(
          '\nHints:\n' +
            '  - An error path like `elements.2.type` points at the 3rd element\'s `type` field.\n' +
            '  - "Invalid discriminator value" means a bad `type` — allowed: video, image, text,\n' +
            '    shape, audio, caption, group, particles.\n' +
            '  - Read the field rules:  clipkit docs protocol\n',
        );
      }
      process.exit(1);
    });
}
