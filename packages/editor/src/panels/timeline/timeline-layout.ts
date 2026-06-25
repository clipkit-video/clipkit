// Timeline layout model (EDITORS D9) — the single source of truth for
// BOTH the canvas painter and the DOM hit-test overlay in the hybrid
// canvas timeline. Pure: given the source + zoom + expansion set it
// returns content-space rectangles (y grows downward from 0 at the
// first layer row, x = seconds * pxPerSec). The canvas draws these
// offset by scroll; the overlay places hit-rects at the same coords.

import type { Element, Keyframe } from '@clipkit/protocol';
import {
  elementDuration,
  elementTime,
  elementLayer,
} from '@clipkit/editor-core';

// Row/layer height. Matches the basic editor's compact 32px track — the
// representation Ian preferred. With CLIP_INSET=3 each side the clip bar is 26px.
export const ROW_H = 32;
export const LANE_H = 24;
export const RULER_H = 24;
export const HEADER_W = 116;
// px top/bottom inside the row. 3 (not 2) so the bar clears the now-visible row
// separators: the clip's centered border stroke overhangs ~0.75px, which ate
// most of a 2px gap and made the bar look like it touched the line.
export const CLIP_INSET = 3;

export interface ClipRect {
  id: string;
  element: Element;
  layer: number;
  /** Seconds. */
  time: number;
  dur: number;
  /** Content-space px. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LaneKeyframe {
  animIndex: number;
  kfIndex: number;
  time: number; // element-local seconds
  x: number; // content-space px (absolute on the timeline)
  y: number; // diamond center y
}

export interface Lane {
  elementId: string;
  property: string;
  animIndex: number;
  y: number; // lane top
  h: number;
  keyframes: LaneKeyframe[];
}

export interface LayerRow {
  layer: number;
  y: number; // row top (content space, 0 = first row, ruler excluded)
  h: number; // full height incl. expanded lanes
  /** The element whose keyframe lanes are expanded on this row, if any. */
  expandedId: string | null;
  /** First element on the row carrying keyframe_animations (for the chevron). */
  animId: string | null;
}

export interface TimelineLayout {
  layers: LayerRow[];
  clips: ClipRect[];
  lanes: Lane[];
  contentW: number;
  contentH: number;
  duration: number;
  pxPerSec: number;
}

/** Layers present, ascending — layer 1 (front/on top) is the first/top row. */
export function listLayers(source: { elements: readonly Element[] }): number[] {
  const set = new Set<number>();
  for (const el of source.elements) set.add(elementLayer(el));
  return [...set].sort((a, b) => a - b);
}

const kfTime = (k: Keyframe): number =>
  typeof k.time === 'number' ? k.time : parseFloat(String(k.time)) || 0;

export function buildLayout(
  source: { elements: readonly Element[] },
  duration: number,
  pxPerSec: number,
  expanded: ReadonlySet<string>,
): TimelineLayout {
  const layerNums = listLayers(source);
  const layers: LayerRow[] = [];
  const clips: ClipRect[] = [];
  const lanes: Lane[] = [];

  let y = 0;
  for (const layer of layerNums) {
    const rowEls = source.elements.filter((el) => elementLayer(el) === layer);
    const expandedEl = rowEls.find((el) => el.id && expanded.has(el.id)) ?? null;
    const animEl =
      rowEls.find((el) => el.id && (el.keyframe_animations?.length ?? 0) > 0) ?? null;
    const laneAnims = expandedEl?.keyframe_animations ?? [];
    const rowH = ROW_H + laneAnims.length * LANE_H;

    layers.push({
      layer,
      y,
      h: rowH,
      expandedId: expandedEl?.id ?? null,
      animId: animEl?.id ?? null,
    });

    for (const el of rowEls) {
      if (!el.id) continue;
      const t = elementTime(el);
      const d = elementDuration(el, duration);
      clips.push({
        id: el.id,
        element: el,
        layer,
        time: t,
        dur: d,
        x: t * pxPerSec,
        y: y + CLIP_INSET,
        w: Math.max(20, d * pxPerSec),
        h: ROW_H - CLIP_INSET * 2,
      });
    }

    if (expandedEl) {
      const start = elementTime(expandedEl);
      laneAnims.forEach((anim, ai) => {
        const laneY = y + ROW_H + ai * LANE_H;
        lanes.push({
          elementId: expandedEl.id!,
          property: anim.property,
          animIndex: ai,
          y: laneY,
          h: LANE_H,
          keyframes: anim.keyframes.map((k, ki) => {
            const kt = kfTime(k);
            return {
              animIndex: ai,
              kfIndex: ki,
              time: kt,
              x: (start + kt) * pxPerSec,
              y: laneY + LANE_H / 2,
            };
          }),
        });
      });
    }

    y += rowH;
  }

  return {
    layers,
    clips,
    lanes,
    contentW: Math.max(1, Math.ceil(duration * pxPerSec)) + 240,
    contentH: y,
    duration,
    pxPerSec,
  };
}

/** Inclusive index range of layers intersecting [scrollTop, scrollTop+viewH]. */
export function visibleLayerRange(
  layers: readonly LayerRow[],
  scrollTop: number,
  viewH: number,
): { start: number; end: number } {
  if (layers.length === 0) return { start: 0, end: 0 };
  const top = scrollTop;
  const bottom = scrollTop + viewH;
  let start = layers.length;
  let end = 0;
  for (let i = 0; i < layers.length; i++) {
    const r = layers[i]!;
    if (r.y + r.h >= top && r.y <= bottom) {
      if (i < start) start = i;
      if (i + 1 > end) end = i + 1;
    }
  }
  if (start > end) return { start: 0, end: 0 };
  return { start, end };
}
