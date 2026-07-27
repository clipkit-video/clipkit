// Generation-time layer assignment for builder children.
//
// Under the layer model every element in a container owns a UNIQUE
// `layer` (1..1000) and HIGHER numbers draw in FRONT (highest on top,
// backgrounds at layer 1) — the CSS z-index convention, agreeing with
// `z`. Builders author their children in BACK-TO-FRONT array order (the
// natural "paint in order" reading), so the helper stamps the FIRST
// (back-most) child layer 1 and the LAST (front-most) child layer N.
// This preserves the authored stacking and satisfies the per-container
// uniqueness invariant by construction.

import type { Element } from '@clipkit/protocol';

/** Distribute Omit across the Element union so each member keeps its own fields. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** An element as authored by a builder, before its `layer` is stamped. */
export type UnlayeredElement = DistributiveOmit<Element, 'layer'>;

/**
 * Stamp dense, unique `layer` values onto an ordered (back-to-front)
 * child list: index 0 (drawn first / behind) → layer 1, the last entry
 * (drawn last / in front) → layer N. Returns fully-typed `Element`s.
 */
export function assignLayers(elements: readonly UnlayeredElement[]): Element[] {
  return elements.map((el, i) => ({ ...el, layer: i + 1 }) as Element);
}
