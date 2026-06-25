// The deriver — walks the protocol's zod schemas and produces a
// default FieldSpec for EVERY field, so the inspector grows with the
// protocol automatically (EDITORS-PLAN D2 layer 1). Recognition is
// STRUCTURAL (zod _def duck-typing — no zod dependency, no version
// coupling) plus name heuristics for semantics the schema can't carry
// (colors, urls, angles). Anything unrecognized falls back to 'json'
// and is flagged via origin: 'derived' + note for the polish triage.

import type { FieldSpec } from './types.js';

// ── Minimal structural view of a zod schema ─────────────────────────

interface ZodDefLike {
  typeName?: string;
  innerType?: ZodLike;
  schema?: ZodLike;
  type?: ZodLike; // ZodArray element
  items?: ZodLike[]; // ZodTuple
  options?: ZodLike[] | Map<string, ZodLike>; // unions
  values?: string[]; // ZodEnum
  value?: unknown; // ZodLiteral
  shape?: () => Record<string, ZodLike>;
  checks?: Array<{ kind: string; value?: number }>;
}

export interface ZodLike {
  _def: ZodDefLike;
}

function defOf(t: ZodLike): ZodDefLike {
  return t._def ?? {};
}

/** Unwrap optional/default/nullable/effects/readonly wrappers. */
export function unwrap(t: ZodLike): ZodLike {
  let cur = t;
  for (let i = 0; i < 10; i++) {
    const def = defOf(cur);
    const name = def.typeName;
    if (
      name === 'ZodOptional' ||
      name === 'ZodDefault' ||
      name === 'ZodNullable' ||
      name === 'ZodReadonly' ||
      name === 'ZodBranded'
    ) {
      cur = def.innerType as ZodLike;
    } else if (name === 'ZodEffects') {
      cur = def.schema as ZodLike;
    } else {
      return cur;
    }
  }
  return cur;
}

function typeName(t: ZodLike): string {
  return defOf(unwrap(t)).typeName ?? 'unknown';
}

/** Object shape of a (possibly wrapped) ZodObject, or null. */
export function shapeOf(t: ZodLike): Record<string, ZodLike> | null {
  const u = unwrap(t);
  const def = defOf(u);
  if (def.typeName !== 'ZodObject' || typeof def.shape !== 'function') return null;
  return def.shape();
}

function unionMembers(t: ZodLike): ZodLike[] {
  const def = defOf(unwrap(t));
  if (def.typeName !== 'ZodUnion') return [];
  return (def.options as ZodLike[]) ?? [];
}

/** An array whose element is an object with `time` and `value` keys —
 * structurally, a Keyframe[]. */
function isKeyframeArray(t: ZodLike): boolean {
  const def = defOf(unwrap(t));
  if (def.typeName !== 'ZodArray') return false;
  const el = shapeOf(def.type as ZodLike);
  return el !== null && 'time' in el && 'value' in el;
}

function numberBounds(t: ZodLike): { min?: number; max?: number } {
  const def = defOf(unwrap(t));
  const out: { min?: number; max?: number } = {};
  for (const c of def.checks ?? []) {
    if (c.kind === 'min' && typeof c.value === 'number') out.min = c.value;
    if (c.kind === 'max' && typeof c.value === 'number') out.max = c.value;
  }
  return out;
}

// ── Name heuristics ─────────────────────────────────────────────────

function looksLikeColor(path: string): boolean {
  return path === 'color' || path === 'tint' || path.endsWith('_color');
}
function looksLikeUrl(path: string): boolean {
  return path === 'source' || path === 'src';
}
function looksLikeAngle(path: string): boolean {
  // (`direction` on particles is also degrees but reads better as a
  // plain number — override territory, not a heuristic.)
  return path === 'angle' || path.includes('rotation') || path.endsWith('_skew');
}

// ── Default sections for the shared BaseElement fields ──────────────

const SECTION_BY_FIELD: Record<string, string> = {
  id: 'identity', name: 'identity', layer: 'identity',
  time: 'timing', duration: 'timing',
  // visible gates rendering (opacity's hard on/off cousin), not WHEN
  // the element plays — re-ruled into appearance by Ian 2026-06-11.
  visible: 'appearance',
  x: 'transform', y: 'transform', width: 'transform', height: 'transform',
  aspect_ratio: 'transform', x_anchor: 'transform', y_anchor: 'transform',
  rotation: 'transform', z_rotation: 'transform', x_rotation: 'transform',
  y_rotation: 'transform', z: 'transform', scale: 'transform',
  x_scale: 'transform', y_scale: 'transform', x_skew: 'transform',
  y_skew: 'transform',
  opacity: 'appearance', blend_mode: 'appearance',
  blur_radius: 'filters', brightness: 'filters', contrast: 'filters',
  saturation: 'filters', hue_rotate: 'filters',
  effects: 'effects', animations: 'animations',
  keyframe_animations: 'keyframes',
};

function labelOf(path: string): string {
  const words = path.split('_');
  return words
    .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

// ── The deriver ─────────────────────────────────────────────────────

interface Classified {
  control: FieldSpec['control'];
  animatable: boolean;
  min?: number;
  max?: number;
  options?: readonly string[];
  note?: string;
}

function classify(path: string, t: ZodLike): Classified {
  const u = unwrap(t);
  const name = typeName(u);

  if (name === 'ZodNumber') {
    const bounds = numberBounds(u);
    if (looksLikeAngle(path)) return { control: 'angle', animatable: false, ...bounds };
    return { control: 'number', animatable: false, ...bounds };
  }
  if (name === 'ZodString') {
    if (looksLikeColor(path)) return { control: 'color', animatable: false };
    if (looksLikeUrl(path)) return { control: 'url', animatable: false };
    return { control: 'text', animatable: false };
  }
  if (name === 'ZodBoolean') return { control: 'toggle', animatable: false };
  if (name === 'ZodEnum') {
    const values = defOf(u).values ?? [];
    return { control: 'select', animatable: false, options: [...values] };
  }
  if (name === 'ZodArray') {
    if (isKeyframeArray(u)) return { control: 'keyframes', animatable: true };
    return { control: 'list', animatable: false, note: 'derived list fallback' };
  }

  if (name === 'ZodUnion') {
    const members = unionMembers(u);
    const kinds = new Set(members.map((m) => typeName(m)));
    const hasKeyframes = members.some((m) => isKeyframeArray(m));
    const numberMember = members.find((m) => typeName(m) === 'ZodNumber');
    const bounds = numberMember ? numberBounds(numberMember) : {};

    // number | Keyframe[]  (effect params, volume, …)
    if (kinds.has('ZodNumber') && hasKeyframes && !kinds.has('ZodString')) {
      const base = looksLikeAngle(path)
        ? { control: 'angle' as const }
        : { control: 'number' as const };
      return { ...base, animatable: true, ...bounds };
    }
    // number | string (| Keyframe[])  — length units
    if (kinds.has('ZodNumber') && kinds.has('ZodString')) {
      return { control: 'length', animatable: hasKeyframes, ...bounds };
    }
    // string | string[]  (particles color palette)
    if (kinds.has('ZodString') && kinds.has('ZodArray') && !hasKeyframes) {
      if (looksLikeColor(path)) {
        return { control: 'color', animatable: false, note: 'accepts an array (palette)' };
      }
    }
    // boolean | literal(s)  (loop: boolean | 'ping-pong')
    if (kinds.has('ZodBoolean') && kinds.has('ZodLiteral')) {
      const literals = members
        .filter((m) => typeName(m) === 'ZodLiteral')
        .map((m) => String(defOf(unwrap(m)).value));
      return { control: 'select', animatable: false, options: ['off', 'on', ...literals] };
    }
    // number | literal('auto'/'end') (duration)
    if (kinds.has('ZodNumber') && kinds.has('ZodLiteral')) {
      return { control: 'length', animatable: false, note: 'accepts keyword values' };
    }
    return { control: 'json', animatable: hasKeyframes, note: 'union fallback' };
  }

  if (name === 'ZodObject') return { control: 'json', animatable: false, note: 'object fallback' };
  if (name === 'ZodTuple') return { control: 'json', animatable: false, note: 'tuple fallback' };
  if (name === 'ZodDiscriminatedUnion') {
    return { control: 'json', animatable: false, note: 'discriminated-union fallback' };
  }
  if (name === 'ZodRecord') return { control: 'json', animatable: false, note: 'record fallback' };
  if (name === 'ZodLiteral') return { control: 'text', animatable: false, note: 'literal' };
  return { control: 'json', animatable: false, note: `unrecognized (${name})` };
}

/**
 * Derive the default knob set for one object schema. `skip` drops
 * structural keys a scope handles elsewhere (e.g. element `type`).
 */
export function deriveScope(
  scope: string,
  schema: ZodLike,
  skip: ReadonlySet<string> = new Set(),
): FieldSpec[] {
  const shape = shapeOf(schema);
  if (!shape) return [];
  const out: FieldSpec[] = [];
  for (const [path, fieldSchema] of Object.entries(shape)) {
    if (skip.has(path)) continue;
    const c = classify(path, fieldSchema);
    out.push({
      path,
      control: c.control,
      label: labelOf(path),
      section: SECTION_BY_FIELD[path] ?? scope,
      order: 1000,
      min: c.min,
      max: c.max,
      options: c.options,
      animatable: c.animatable,
      origin: 'derived',
      note: c.note,
    });
  }
  return out;
}
