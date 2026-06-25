// buildEditorRegistry — runs the derive → override pipeline over the
// protocol's exported zod schemas and returns the resolved registry
// every inspector renders from (EDITORS-PLAN D2).

import {
  animationSchema,
  audioElementSchema,
  captionElementSchema,
  effectSchema,
  groupElementSchema,
  imageElementSchema,
  particlesElementSchema,
  shapeElementSchema,
  sourceSchema,
  textElementSchema,
  videoElementSchema,
} from '@clipkit/protocol';
import { deriveScope, unwrap, type ZodLike } from './derive.js';
import {
  BASE_FIELD_OVERRIDES,
  COMPOSITES,
  FIELD_OVERRIDES,
} from './overrides.js';
import type {
  CompositeSpec,
  EditorRegistry,
  FieldOverride,
  FieldSpec,
  ScopeRegistry,
} from './types.js';

const ELEMENT_SCHEMAS: Record<string, unknown> = {
  video: videoElementSchema,
  image: imageElementSchema,
  text: textElementSchema,
  shape: shapeElementSchema,
  audio: audioElementSchema,
  group: groupElementSchema,
  caption: captionElementSchema,
  particles: particlesElementSchema,
};

function applyOverrides(
  fields: FieldSpec[],
  ...layers: Array<Record<string, FieldOverride> | undefined>
): FieldSpec[] {
  return fields.map((f) => {
    let merged = f;
    for (const layer of layers) {
      const o = layer?.[f.path];
      if (!o) continue;
      merged = { ...merged, ...o, path: f.path, origin: 'override' };
    }
    return merged;
  });
}

function resolveScope(
  scope: string,
  schema: unknown,
  opts: {
    skip?: ReadonlySet<string>;
    overrides?: Array<Record<string, FieldOverride> | undefined>;
    composites?: CompositeSpec[];
  } = {},
): ScopeRegistry {
  const derived = deriveScope(scope, schema as ZodLike, opts.skip);
  const fields = applyOverrides(derived, ...(opts.overrides ?? []));
  const composites = opts.composites ?? [];
  const claimed = new Set(composites.flatMap((c) => c.claims));
  return {
    scope,
    // Composite claims beat field specs — claimed fields leave the
    // flat list (their values are edited through the widget).
    fields: fields.filter((f) => !claimed.has(f.path)),
    composites,
  };
}

/** Effect scopes from the discriminated union: one per `type` literal. */
function effectScopes(): Record<string, ScopeRegistry> {
  const out: Record<string, ScopeRegistry> = {};
  const def = (unwrap(effectSchema as ZodLike) as ZodLike)._def as {
    options?: ZodLike[];
  };
  for (const option of def.options ?? []) {
    const shape = (unwrap(option)._def as { shape?: () => Record<string, ZodLike> }).shape?.();
    const typeLiteral = shape?.type
      ? ((unwrap(shape.type)._def as { value?: unknown }).value as string)
      : undefined;
    if (!typeLiteral) continue;
    const scope = `effects.${typeLiteral}`;
    out[typeLiteral] = resolveScope(scope, option, {
      skip: new Set(['type']),
      overrides: [FIELD_OVERRIDES[scope]],
    });
  }
  return out;
}

export function buildEditorRegistry(): EditorRegistry {
  const elements: Record<string, ScopeRegistry> = {};
  for (const [type, schema] of Object.entries(ELEMENT_SCHEMAS)) {
    elements[type] = resolveScope(type, schema, {
      skip: new Set(['type']),
      overrides: [BASE_FIELD_OVERRIDES, FIELD_OVERRIDES[type]],
      composites: [...(COMPOSITES.__element__ ?? []), ...(COMPOSITES[type] ?? [])],
    });
  }
  return {
    source: resolveScope('source', sourceSchema, {
      skip: new Set(['elements']),
      overrides: [FIELD_OVERRIDES.source],
      composites: COMPOSITES.source ?? [],
    }),
    elements,
    effects: effectScopes(),
    animation: resolveScope('animation', animationSchema, {
      skip: new Set(['type']),
      overrides: [FIELD_OVERRIDES.animation],
    }),
  };
}
