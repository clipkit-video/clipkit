// Source diff — given the previous source and the next source, decide
// whether the change is patchable (only visual/spatial fields on
// existing elements) or whether a full setSource is required
// (structural change, timing change, asset change).
//
// Patchable returns: `Array<{ id, patch }>` — possibly empty when
// nothing meaningful changed.
// Not patchable returns: `null` — Editor falls back to engine.setSource.

import type { Element, Source } from '@clipkit/protocol';

/**
 * Fields that are safe to send as patches to the worker. Everything
 * else triggers a full setSource (audio re-decode, runtime preload,
 * etc.). The list excludes:
 *   - `type` — would require a different element variant
 *   - `time`, `layer`, `duration` — affect buffer alignment / playhead
 *   - `source` — asset URL changes need preload
 *   - `animations`, `keyframe_animations` — animation state changes
 *   - `mask`, `gradient`, `words`, `elements` — structural changes
 *
 * Anything not in this set forces the slow path.
 */
const PATCHABLE_FIELDS = new Set<string>([
  // Transform
  'x',
  'y',
  'width',
  'height',
  'rotation',
  'scale',
  'opacity',
  'x_anchor',
  'y_anchor',
  // Identity (cheap text changes)
  'name',
  // Visual styling
  'fill_color',
  'stroke_color',
  'stroke_width',
  'border_radius',
  'background_color',
  'background_border_radius',
  // Typography
  'text',
  'spans',
  'font_family',
  'font_size',
  'font_weight',
  'font_style',
  'text_align',
  'vertical_align',
  'y_alignment',
  'line_height',
  'letter_spacing',
  // Caption styling
  'highlight_color',
  'highlight_background_color',
  // Image / video filters
  'fit',
  'brightness',
  'contrast',
  'saturation',
  'blur',
  // Audio (volume only — trim/loop affect frame alignment)
  'volume',
  // Shape
  'shape',
  'sides',
  'path',
  // SVG paths array changes are usually structural; skip.
]);

/**
 * Top-level Source fields that must match for a patch to apply.
 * If any of these change, fall back to full setSource.
 */
const TOP_LEVEL_FIELDS: Array<keyof Source> = [
  'output_format',
  'width',
  'height',
  'duration',
  'frame_rate',
  'background_color',
  'clipkit_version',
  // Scene-level render state (CKP/1.0): a camera or motion-blur edit
  // changes no element, so without these it would diff to zero patches
  // and never reach the engine — the live preview would ignore camera
  // perspective / pose / sort and motion-blur changes. Force setSource.
  'camera',
  'motion_blur',
  // §4.8 scene lighting: a lights/environment edit changes no element but
  // must re-shade every lit material — force setSource so the preview
  // picks it up (same reasoning as camera/motion_blur).
  'lights',
  'environment',
  'bloom',
];

export interface ElementPatch {
  id: string;
  patch: Record<string, unknown>;
}

export function computeElementPatches(
  prev: Source,
  next: Source,
): ElementPatch[] | null {
  if (prev === next) return [];

  // Top-level differences kick us to setSource.
  for (const field of TOP_LEVEL_FIELDS) {
    if (prev[field] !== next[field]) return null;
  }

  // Element-count change → structural. setSource.
  if (prev.elements.length !== next.elements.length) return null;

  const patches: ElementPatch[] = [];
  for (let i = 0; i < next.elements.length; i++) {
    const prevEl = prev.elements[i]!;
    const nextEl = next.elements[i]!;
    // Immer structural-sharing fast path: unchanged elements are === .
    if (prevEl === nextEl) continue;
    // Need stable id + type for the worker to apply patches in place.
    if (!prevEl.id || prevEl.id !== nextEl.id) return null;
    if (prevEl.type !== nextEl.type) return null;
    // Composition deep edits: skip patching for v1; setSource is safer.
    if (nextEl.type === 'group') return null;

    const patch: Record<string, unknown> = {};
    const seen = new Set<string>();
    for (const key of Object.keys(nextEl)) {
      seen.add(key);
      const nv = (nextEl as Record<string, unknown>)[key];
      const pv = (prevEl as Record<string, unknown>)[key];
      if (nv === pv) continue;
      if (!PATCHABLE_FIELDS.has(key)) return null;
      patch[key] = nv;
    }
    // A removed field also requires the slow path (we don't track
    // deletions through Object.assign).
    for (const key of Object.keys(prevEl)) {
      if (seen.has(key)) continue;
      if (!PATCHABLE_FIELDS.has(key)) return null;
      patch[key] = undefined;
    }

    if (Object.keys(patch).length > 0) {
      patches.push({ id: prevEl.id, patch });
    }
  }

  return patches;
}

// Re-export for convenience (used by callers tracking the type).
export type { Element };
