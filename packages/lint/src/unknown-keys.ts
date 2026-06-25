// unknownKeys — element/source keys the Clipkit schema doesn't define.
//
// The protocol validator PASSES unknown keys through (it does not strip them),
// and the runtime simply ignores fields it doesn't implement — so a misspelled
// or unsupported field (e.g. `fillColour`, or the unimplemented `text_template`)
// validates fine and then renders wrong, with no signal. This compares the
// authored keys against the schema's KNOWN keys (introspected from the Zod
// source of truth) so an authoring tool can say "that key isn't recognized."
//
// Scope: top-level Source keys and each element's own keys (recursing into group
// children). It does NOT descend into nested sub-objects (effects, paths,
// keyframes) — those would need per-schema introspection; this catches the
// common top-level mistakes, including the whole text_template class.

import { elementSchema, sourceSchema } from '@clipkit/protocol';
import { droppedKeys } from './dropped-keys.js';
import { hint } from './suggest.js';
import { ALL_SCHEMA_KEYS } from './schema-keys.js';

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Unwrap ZodEffects/optional/default/etc. to the underlying object's shape keys.
function shapeKeys(schema: unknown): string[] {
  let s = schema as { shape?: Record<string, unknown>; _def?: Record<string, unknown> } | undefined;
  for (let i = 0; i < 6 && s; i++) {
    if (s.shape) return Object.keys(s.shape);
    const d = s._def as { schema?: unknown; innerType?: unknown; type?: unknown } | undefined;
    if (!d) break;
    s = (d.schema ?? d.innerType ?? d.type) as typeof s;
  }
  const shape = s && (s as { shape?: Record<string, unknown> }).shape;
  return shape ? Object.keys(shape) : [];
}

const SOURCE_KEYS = new Set(shapeKeys(sourceSchema));

const ELEMENT_KEYS_BY_TYPE: Record<string, Set<string>> = {};
{
  const u = elementSchema as { _def?: { options?: unknown[] }; options?: unknown[] };
  const opts = u._def?.options ?? u.options ?? [];
  for (const opt of opts) {
    const shape = (opt as { shape?: Record<string, { _def?: { value?: unknown }; value?: unknown }> }).shape;
    if (!shape) continue;
    const typeLit = shape.type?._def?.value ?? shape.type?.value;
    if (typeof typeLit === 'string') ELEMENT_KEYS_BY_TYPE[typeLit] = new Set(Object.keys(shape));
  }
}

function collectUnknown(el: Record<string, unknown>, prefix: string, out: string[]): void {
  const type = typeof el.type === 'string' ? el.type : '';
  const known = ELEMENT_KEYS_BY_TYPE[type];
  if (known) {
    for (const k of Object.keys(el)) if (!known.has(k)) out.push(prefix + k + hint(k, ALL_SCHEMA_KEYS));
  }
  if (type === 'group' && Array.isArray(el.elements)) {
    el.elements.forEach((c, i) => {
      if (isObj(c)) collectUnknown(c, `${prefix}elements[${i}].`, out);
    });
  }
}

/** Unrecognized keys anywhere in a Source: top-level + every element. */
export function unknownKeys(source: unknown): string[] {
  const out: string[] = [];
  if (!isObj(source)) return out;
  if (SOURCE_KEYS.size) {
    for (const k of Object.keys(source)) if (!SOURCE_KEYS.has(k)) out.push(k + hint(k, ALL_SCHEMA_KEYS));
  }
  if (Array.isArray(source.elements)) {
    source.elements.forEach((el, i) => {
      if (isObj(el)) collectUnknown(el, `elements[${i}].`, out);
    });
  }
  return out;
}

/** Unrecognized keys on a single element (recursing into group children). */
export function unknownElementKeys(element: unknown): string[] {
  const out: string[] = [];
  if (isObj(element)) collectUnknown(element, '', out);
  return out;
}

function union(a: string[], b: string[]): string[] {
  return [...new Set([...a, ...b])];
}

// ── Combined detectors ──────────────────────────────────────────────────────
// The schema disposes of unrecognized keys two ways: passthrough objects (source,
// elements) KEEP them (→ unknownKeys, via schema introspection); closed objects
// (effects, paths, gradients, mask, animations) STRIP them (→ droppedKeys, via a
// diff against the validated output). Union both for complete coverage at any depth.

/** All unrecognized keys in a Source (pass `validated` = the validate() output). */
export function unrecognizedKeys(input: unknown, validated: unknown): string[] {
  return union(unknownKeys(input), droppedKeys(input, validated));
}

/** All unrecognized keys on one element (pass `validated` = its validated form). */
export function unrecognizedElementKeys(element: unknown, validated: unknown): string[] {
  return union(unknownElementKeys(element), droppedKeys(element, validated));
}
