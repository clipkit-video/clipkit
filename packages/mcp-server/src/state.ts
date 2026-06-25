// Source-manipulation helpers shared by the MCP tools.
//
// A "project" is just a Clipkit `Source`. Tools never own a Source directly;
// they go through a ProjectStore (see project-store.ts) so the same tool code
// works two ways: a single in-memory project over local stdio, or many
// concurrent projects in a shared DB behind a hosted, sessionless HTTP server.

import type { Source } from '@clipkit/protocol';

/** A fresh, empty project. */
export function blankSource(): Source {
  return {
    output_format: 'mp4',
    width: 1920,
    height: 1080,
    duration: 10,
    frame_rate: 30,
    elements: [],
  };
}

/** Deep-clone a Source so a tool can mutate a trial copy before validating. */
export function cloneSource(source: Source): Source {
  return JSON.parse(JSON.stringify(source)) as Source;
}

export interface ElementLocation {
  /** The matched element, as a mutable record. */
  element: Record<string, unknown>;
  /** The array that holds it — top-level, a group's `elements`, or a mask's. */
  container: unknown[];
  /** Its index within `container`. */
  index: number;
}

/**
 * Find an element by id ANYWHERE in the tree — top-level, nested `group`
 * children, or `group.mask` children — returning the array that holds it and
 * the index, so callers can edit or splice it in place. Returns null if absent.
 */
export function locateElement(elements: unknown[], id: string): ElementLocation | null {
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (!el || typeof el !== 'object') continue;
    const rec = el as Record<string, unknown>;
    if (rec.id === id) return { element: rec, container: elements, index: i };
    if (Array.isArray(rec.elements)) {
      const hit = locateElement(rec.elements, id);
      if (hit) return hit;
    }
    const mask = rec.mask as { elements?: unknown } | undefined;
    if (mask && Array.isArray(mask.elements)) {
      const hit = locateElement(mask.elements, id);
      if (hit) return hit;
    }
  }
  return null;
}
