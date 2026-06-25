// `clipkit schema` — emit the Clipkit Protocol as a JSON Schema, derived from
// the canonical Zod schema (the single source of truth). Useful for constrained
// / structured LLM generation, editor autocomplete, and external validators:
//
//   clipkit schema > clipkit.schema.json

import { Command } from 'commander';
import { sourceSchema } from '@clipkit/protocol';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ZodTypeAny } from 'zod';

export function schemaCommand(program: Command): void {
  program
    .command('schema')
    .description('Print the protocol JSON Schema (generated from the Zod source of truth)')
    .action(() => {
      const json = zodToJsonSchema(sourceSchema as ZodTypeAny, {
        name: 'ClipkitSource',
        $refStrategy: 'root',
      });
      process.stdout.write(`${JSON.stringify(json, null, 2)}\n`);
    });
}
