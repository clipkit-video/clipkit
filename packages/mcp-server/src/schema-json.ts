// JSON Schema for the Clipkit Source, generated from the protocol's Zod source
// of truth (same as `clipkit schema`). Exposed to agents via the get_schema TOOL
// — MCP *resources* aren't model-readable in clients like Claude Desktop (they're
// user-attached), so a tool is the only reliable way to hand the agent the schema.
//
// Both the full Source schema and per-element-type schemas are precomputed once.

import { sourceSchema, elementSchema } from '@clipkit/protocol';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ZodTypeAny } from 'zod';

// Compact (no indentation): at this nesting depth ~60% of a pretty-printed schema is
// leading whitespace, and the agent parses compact JSON fine. The human-facing
// `clipkit schema` CLI can pretty-print separately if a person needs to read it.
export const SOURCE_SCHEMA_JSON = JSON.stringify(
  zodToJsonSchema(sourceSchema as ZodTypeAny, { name: 'ClipkitSource', $refStrategy: 'relative' }),
);

// Per-type element schemas (much smaller than the full Source), keyed by type.
const ELEMENT_SCHEMAS: Record<string, string> = {};
{
  const union = elementSchema as { _def?: { options?: unknown[] }; options?: unknown[] };
  const opts = union._def?.options ?? union.options ?? [];
  for (const opt of opts) {
    const shape = (opt as { shape?: Record<string, { _def?: { value?: unknown }; value?: unknown }> }).shape;
    const typeLit = shape?.type?._def?.value ?? shape?.type?.value;
    if (typeof typeLit === 'string') {
      ELEMENT_SCHEMAS[typeLit] = JSON.stringify(
        zodToJsonSchema(opt as ZodTypeAny, { name: `${typeLit}Element`, $refStrategy: 'relative' }),
      );
    }
  }
}

export function elementSchemaJson(type: string): string | null {
  return ELEMENT_SCHEMAS[type] ?? null;
}
