// Ungroup — lift a top-level group's children back to the top level.
//
// Bakes the group's time offset onto each child (so timing is preserved), plus
// a simple static translate when the group has no scale/rotation (the common
// "organizational" group ungroups cleanly). Groups with scale/rotation/keyframed
// transforms lift without spatial baking — a best-effort that may shift the
// children; full matrix baking is out of scope for v1.

import type { Element, GroupElement } from '@clipkit/protocol';

const numberOr = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const round3 = (n: number): number => Math.round(n * 1000) / 1000;

export interface UngroupResult {
  elements: Element[];
  liftedIds: string[];
}

/**
 * Replace the top-level group `groupId` with its children, in place. Returns the
 * new top-level elements array + the lifted children's ids (for re-selection),
 * or null if `groupId` is not a top-level group.
 */
export function ungroupInElements(elements: readonly Element[], groupId: string): UngroupResult | null {
  const idx = elements.findIndex((e) => e.id === groupId && e.type === 'group');
  if (idx < 0) return null;
  const group = elements[idx] as GroupElement;

  const g = group as GroupElement & { rotation?: unknown; scale?: unknown; x_scale?: unknown; y_scale?: unknown; x?: unknown; y?: unknown };
  const groupTime = numberOr(group.time, 0);
  const warped = g.rotation !== undefined || g.scale !== undefined || g.x_scale !== undefined || g.y_scale !== undefined;
  const gx = !warped && typeof g.x === 'number' ? g.x : 0;
  const gy = !warped && typeof g.y === 'number' ? g.y : 0;

  const liftedIds: string[] = [];
  const lifted: Element[] = group.elements.map((child, i) => {
    const out = { ...child } as Element & { time?: unknown; x?: unknown; y?: unknown; id?: string };
    out.time = round3(groupTime + numberOr((child as { time?: unknown }).time, 0));
    if (gx && typeof out.x === 'number') out.x = out.x + gx;
    if (gy && typeof out.y === 'number') out.y = out.y + gy;
    if (!out.id) out.id = `${group.id ?? 'group'}-${i}`;
    liftedIds.push(out.id);
    return out as Element;
  });

  return { elements: [...elements.slice(0, idx), ...lifted, ...elements.slice(idx + 1)], liftedIds };
}
