// Every property name anywhere in the protocol schema — the candidate pool for
// "did you mean?" suggestions on unrecognized keys (so a camelCase field at any
// depth, e.g. `blurRadius` inside a glass effect, can be matched to its real
// snake_case name). Built once by walking the generated JSON Schema for all
// `properties` blocks. Best-effort: on any failure it's empty → no suggestions.

import { sourceSchema } from '@clipkit/protocol';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ZodTypeAny } from 'zod';

function collect(node: unknown, out: Set<string>): void {
  if (Array.isArray(node)) {
    for (const x of node) collect(x, out);
    return;
  }
  if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>;
    const props = o.properties;
    if (props && typeof props === 'object' && !Array.isArray(props)) {
      for (const k of Object.keys(props as Record<string, unknown>)) out.add(k);
    }
    for (const v of Object.values(o)) collect(v, out);
  }
}

export const ALL_SCHEMA_KEYS: string[] = (() => {
  const out = new Set<string>();
  try {
    collect(zodToJsonSchema(sourceSchema as ZodTypeAny, { name: 'ClipkitSource', $refStrategy: 'root' }), out);
  } catch {
    /* leave empty — never crash the linter over a suggestion */
  }
  return [...out];
})();
