// Group — wrap the selected TOP-LEVEL elements into a new group element, the
// inverse of ungroup (lib/ungroup.ts).
//
// The group takes identity spatial transform (children keep their absolute
// coords, so the frame renders identically) and a time offset = the earliest
// child's start, with each child's `time` made relative to it. The group's
// `duration` spans the children when they all have numeric durations. Insertion
// happens at the position of the first selected element.

import type { Element, GroupElement } from '@clipkit/protocol';

const numberOr = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const round3 = (n: number): number => Math.round(n * 1000) / 1000;

export interface GroupResult {
  elements: Element[];
  groupId: string;
}

/**
 * Wrap the top-level elements named by `ids` into a new group with id `newId`.
 * Returns the new top-level elements array + the group's id, or null if fewer
 * than two of the ids are top-level elements.
 */
export function groupElements(elements: readonly Element[], ids: readonly string[], newId: string): GroupResult | null {
  const idSet = new Set(ids);
  const indices: number[] = [];
  elements.forEach((e, i) => {
    if (typeof e.id === 'string' && idSet.has(e.id)) indices.push(i);
  });
  if (indices.length < 2) return null;

  const selected = indices.map((i) => elements[i]!);
  const groupTime = Math.min(...selected.map((e) => numberOr((e as { time?: unknown }).time, 0)));

  let maxEnd = 0;
  let allNumericDuration = true;
  const children: Element[] = selected.map((e) => {
    const rel = numberOr((e as { time?: unknown }).time, 0) - groupTime;
    const dur = (e as { duration?: unknown }).duration;
    if (typeof dur === 'number') maxEnd = Math.max(maxEnd, rel + dur);
    else allNumericDuration = false;
    return { ...e, time: round3(rel) } as Element;
  });

  const group = {
    id: newId,
    name: 'Group',
    type: 'group',
    time: round3(groupTime),
    layer: numberOr((selected[0] as { layer?: unknown }).layer, 1),
    elements: children,
  } as GroupElement & { duration?: number };
  if (allNumericDuration && maxEnd > 0) group.duration = round3(maxEnd);

  const firstIdx = indices[0]!;
  const out: Element[] = [];
  elements.forEach((e, i) => {
    if (typeof e.id === 'string' && idSet.has(e.id)) {
      if (i === firstIdx) out.push(group as Element);
    } else {
      out.push(e);
    }
  });

  return { elements: out, groupId: newId };
}
