// droppedKeys — keys present in the input but missing from the schema-validated
// output, i.e. STRIPPED. The "closed" sub-objects (effects, paths, gradients,
// mask, animations, keyframes) are plain Zod objects that silently drop unknown
// keys on parse, so a wrong key there validates fine and vanishes. This diff
// finds them. Complements unknownKeys, which handles the PASSTHROUGH objects
// (source, elements) where unknown keys instead SURVIVE validation. Together they
// flag unrecognized keys at every depth, whichever way the schema disposes of them.
//
// Best-effort structural diff; arrays are compared by index (the validator never
// reorders or filters), so the paths line up.

import { hint } from './suggest.js';
import { ALL_SCHEMA_KEYS } from './schema-keys.js';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function droppedKeys(input: unknown, validated: unknown, path = ''): string[] {
  const out: string[] = [];

  if (Array.isArray(input) && Array.isArray(validated)) {
    const n = Math.min(input.length, validated.length);
    for (let i = 0; i < n; i++) {
      out.push(...droppedKeys(input[i], validated[i], `${path}[${i}]`));
    }
    return out;
  }

  if (isPlainObject(input) && isPlainObject(validated)) {
    for (const key of Object.keys(input)) {
      const childPath = path ? `${path}.${key}` : key;
      if (!(key in validated)) {
        out.push(childPath + hint(key, ALL_SCHEMA_KEYS));
      } else {
        out.push(...droppedKeys(input[key], validated[key], childPath));
      }
    }
  }

  return out;
}
