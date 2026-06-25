// Generation-time layer assignment for builder children.
//
// Under the layer model every element in a container owns a UNIQUE
// `layer` (1..1000) and LOWER numbers draw in FRONT (layer 1 on top) —
// the After Effects convention. Builders author their children in
// BACK-TO-FRONT array order (the natural "paint in order" reading), so
// the helper stamps the LAST (front-most) child layer 1 and the FIRST
// (back-most) child layer N. This preserves the authored stacking and
// satisfies the per-container uniqueness invariant by construction.

import type { Element } from '@clipkit/protocol';

/** Distribute Omit across the Element union so each member keeps its own fields. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** An element as authored by a builder, before its `layer` is stamped. */
export type UnlayeredElement = DistributiveOmit<Element, 'layer'>;

/**
 * Stamp dense, unique `layer` values onto an ordered (back-to-front)
 * child list: index 0 (drawn first / behind) → layer N, the last entry
 * (drawn last / in front) → layer 1. Returns fully-typed `Element`s.
 */
export function assignLayers(elements: readonly UnlayeredElement[]): Element[] {
  const n = elements.length;
  return elements.map((el, i) => ({ ...el, layer: n - i }) as Element);
}
