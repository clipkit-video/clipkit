// Pure helpers for the Stage / StageOverlay. No React, no DOM beyond
// `DOMRect` for coordinate conversion. Hit-testing, anchor parsing,
// and source ↔ screen transforms.

import type { Element, Source } from '@clipkit/protocol';

const VISUAL_ELEMENT_TYPES = new Set<Element['type']>([
  'text',
  'shape',
  'image',
  'video',
  'caption',
  'particles',
  'group',
]);

export function isVisualElement(el: Element): boolean {
  return VISUAL_ELEMENT_TYPES.has(el.type);
}

/**
 * Parse a Clipkit anchor value (number 0..1, or `"50%"` style string).
 * Returns the fallback if the value isn't parseable. The fallback defaults
 * to 0 (top-left) to match the runtime's anchor default — see resolveAnchor
 * in @clipkit/runtime. Pass an explicit fallback for pivot math (centre).
 */
export function parseAnchor(v: unknown, fallback = 0): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const m = /^(-?\d+(?:\.\d+)?)%$/.exec(v);
    if (m && m[1]) return parseFloat(m[1]) / 100;
  }
  return fallback;
}

export interface SourceBox {
  /** Top-left x in source coordinates. */
  x: number;
  /** Top-left y in source coordinates. */
  y: number;
  /** Width in source pixels. */
  w: number;
  /** Height in source pixels. */
  h: number;
}

/**
 * Resolve a Clipkit length value (number, "Npx", "N%", "Nvw|vh|vmin|vmax")
 * to a numeric pixel value. Returns null when the value is missing,
 * `"auto"`, or otherwise needs rendered context to resolve.
 *
 * Mirrors `resolveLength` in @clipkit/runtime — duplicated here so the
 * editor doesn't have to depend on the renderer package for layout
 * math.
 */
function resolveLength(
  value: unknown,
  ref: number,
  canvasW: number,
  canvasH: number,
): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (s === '' || s === 'auto' || s === 'end') return null;
  const m = s.match(/^(-?\d*\.?\d+)\s*(px|%|vw|vh|vmin|vmax)?$/i);
  if (!m) return null;
  const num = parseFloat(m[1]!);
  if (!Number.isFinite(num)) return null;
  const unit = (m[2] || 'px').toLowerCase();
  switch (unit) {
    case 'px':
      return num;
    case '%':
      return (num / 100) * ref;
    case 'vw':
      return (num / 100) * canvasW;
    case 'vh':
      return (num / 100) * canvasH;
    case 'vmin':
      return (num / 100) * Math.min(canvasW, canvasH);
    case 'vmax':
      return (num / 100) * Math.max(canvasW, canvasH);
    default:
      return null;
  }
}

/**
 * Rough text-bounds estimate via Canvas2D `measureText`. Good enough
 * for a selection box — won't match the renderer's exact metrics (the
 * runtime uses an SDF font atlas with its own kerning), but the box
 * size + position lands close enough to click on. Used when a text or
 * caption element has `width: "auto"` / `height: "auto"`.
 */
function measureTextBounds(el: Element): { w: number; h: number } | null {
  if (typeof document === 'undefined') return null;
  let text = '';
  if (el.type === 'text') {
    text = typeof el.text === 'string' ? el.text : '';
  } else if (el.type === 'caption') {
    const words = (el as { words?: Array<{ text: string }> }).words;
    if (Array.isArray(words)) text = words.map((w) => w.text).join(' ');
  } else {
    return null;
  }
  if (text === '') text = ' ';

  const fontFamily =
    typeof el.font_family === 'string' && el.font_family
      ? el.font_family
      : 'sans-serif';
  const fontSize =
    typeof el.font_size === 'number' && Number.isFinite(el.font_size)
      ? el.font_size
      : 48;
  const fontWeight =
    typeof el.font_weight === 'number' || typeof el.font_weight === 'string'
      ? el.font_weight
      : 400;
  const lineHeight =
    typeof el.line_height === 'number' && el.line_height > 0
      ? el.line_height
      : 1.2;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
  const lines = text.split('\n');
  let maxW = 0;
  for (const line of lines) {
    const m = ctx.measureText(line);
    if (m.width > maxW) maxW = m.width;
  }
  return {
    w: Math.ceil(maxW),
    h: Math.ceil(lines.length * fontSize * lineHeight),
  };
}

/** A Tier-A expression value: `{ expr: "300 + sin(t)" }`. */
function isExprValue(v: unknown): v is { expr: string } {
  return typeof v === 'object' && v !== null
    && typeof (v as { expr?: unknown }).expr === 'string';
}

/**
 * Hook for resolving an element's animated/expression-driven box at the
 * playhead. editor-core stays renderer-free, so the editor package injects
 * `evalExpr` (from `@clipkit/runtime`) and the global playhead `time`; the
 * box then tracks the evaluated expression frame-for-frame, exactly like
 * the render. Without it, expression values fall back to their leading
 * constant (`parseFloat(expr)`) so the box is at least in the right place.
 */
export interface BoxResolveOpts {
  /** Global playhead time in seconds (element-local time is derived from `el.time`). */
  time?: number;
  /** Tier-A expression evaluator, injected from `@clipkit/runtime`. */
  evalExpr?: (
    value: { expr: string },
    scope: { t: number; dur: number; i: number; n: number; value: number },
  ) => number;
}

/** Evaluate an `{ expr }` length to a number, or null if it isn't one. */
function resolveExprLength(
  value: unknown,
  el: Element,
  source: Source,
  opts: BoxResolveOpts | undefined,
): number | null {
  if (!isExprValue(value)) return null;
  if (opts?.evalExpr) {
    const elTime = typeof el.time === 'number' ? el.time : 0;
    const elDur =
      typeof el.duration === 'number'
        ? el.duration
        : (typeof source.duration === 'number' ? source.duration : 0) - elTime;
    const t = (opts.time ?? 0) - elTime;
    const n = opts.evalExpr(value, { t, dur: elDur, i: 0, n: 1, value: 0 });
    if (Number.isFinite(n)) return n;
  }
  // Renderer-free fallback: the expression's leading constant.
  const n = parseFloat(value.expr);
  return Number.isFinite(n) ? n : null;
}

/**
 * Resolve an element's bounding box in source space, accounting for
 * x/y_anchor + percent / vw / vh / vmin / vmax / "auto" sizing, and
 * Tier-A expressions (evaluated at the playhead when `opts.evalExpr` is
 * supplied — see {@link BoxResolveOpts}).
 *
 * For numeric sizes this is exact. For percent-based sizes we resolve
 * against the canvas dimensions. For `"auto"` on text/caption we
 * measure via Canvas2D to estimate; on other element types we fall
 * back to the canvas size so at least *some* clickable box renders
 * (better than `null` → no selection box at all).
 */
export function elementSourceBox(
  el: Element,
  source: Source,
  opts?: BoxResolveOpts,
): SourceBox | null {
  const sw = source.width ?? 1920;
  const sh = source.height ?? 1080;

  let w = resolveLength(el.width, sw, sw, sh) ?? resolveExprLength(el.width, el, source, opts);
  let h = resolveLength(el.height, sh, sw, sh) ?? resolveExprLength(el.height, el, source, opts);

  if (w == null || h == null) {
    const measured =
      el.type === 'text' || el.type === 'caption'
        ? measureTextBounds(el)
        : null;
    if (measured) {
      if (w == null) w = measured.w;
      if (h == null) h = measured.h;
    }
    // Last-resort fallback for elements with no numeric size and no
    // measurable text (image/video with `width: "auto"`, etc.). Use
    // the full canvas so the box is at least selectable.
    if (w == null) w = sw;
    if (h == null) h = sh;
  }

  const x =
    resolveLength(el.x, sw, sw, sh) ??
    resolveExprLength(el.x, el, source, opts) ??
    (typeof el.x === 'number' ? el.x : sw / 2);
  const y =
    resolveLength(el.y, sh, sw, sh) ??
    resolveExprLength(el.y, el, source, opts) ??
    (typeof el.y === 'number' ? el.y : sh / 2);
  const ax = parseAnchor(el.x_anchor);
  const ay = parseAnchor(el.y_anchor);

  return { x: x - w * ax, y: y - h * ay, w, h };
}

/** Check whether `time` falls inside an element's [time, time+duration). */
export function isElementActive(
  el: Element,
  time: number,
  sourceDuration: number,
): boolean {
  const elTime = typeof el.time === 'number' ? el.time : 0;
  const elDur =
    typeof el.duration === 'number'
      ? el.duration
      : sourceDuration - elTime;
  return time >= elTime && time < elTime + elDur;
}

/** Element rotation in degrees, defaulting to 0. */
export function elementRotation(el: Element): number {
  return typeof el.rotation === 'number' ? el.rotation : 0;
}

/**
 * Find the topmost element under a source-space point. Walks elements
 * in ascending layer order (layer 1 = rendered last = on top). Filters
 * to active + visual elements. For rotated elements, the hit point is
 * inverse-rotated into the element's local frame before the bounds
 * test. Composition recursion deferred to a later phase.
 */
export function hitTest(
  elements: readonly Element[],
  source: Source,
  point: { x: number; y: number },
  playhead: number,
  sourceDuration: number,
): Element | null {
  const candidates = elements
    .filter(isVisualElement)
    .filter((el) => isElementActive(el, playhead, sourceDuration))
    .slice()
    .sort((a, b) => {
      const la = typeof a.layer === 'number' ? a.layer : 1;
      const lb = typeof b.layer === 'number' ? b.layer : 1;
      return la - lb;
    });

  for (const el of candidates) {
    const box = elementSourceBox(el, source);
    if (!box) continue;
    const rotation = elementRotation(el);
    if (rotation === 0) {
      if (
        point.x >= box.x &&
        point.x <= box.x + box.w &&
        point.y >= box.y &&
        point.y <= box.y + box.h
      ) {
        return el;
      }
      continue;
    }
    // Rotated: inverse-rotate the hit point around the box CENTRE. The
    // runtime pivots rotation/scale at the geometric centre regardless of
    // anchor (see resolveAnchor → anchorToCenter), so hit-testing must too.
    const cx = box.x + box.w * 0.5;
    const cy = box.y + box.h * 0.5;
    const local = inverseRotate(
      { x: point.x - cx, y: point.y - cy },
      rotation,
    );
    const localLeft = -box.w * 0.5;
    const localRight = box.w * 0.5;
    const localTop = -box.h * 0.5;
    const localBottom = box.h * 0.5;
    if (
      local.x >= localLeft &&
      local.x <= localRight &&
      local.y >= localTop &&
      local.y <= localBottom
    ) {
      return el;
    }
  }
  return null;
}

/**
 * Marquee box-select: ids of every visual, active element whose source-space
 * bounding box intersects the given source-space rectangle. Rotation is ignored
 * for the test (the un-rotated AABB is a good-enough selection bound).
 */
export function boxSelect(
  elements: readonly Element[],
  source: Source,
  rect: { x0: number; y0: number; x1: number; y1: number },
  playhead: number,
  sourceDuration: number,
): string[] {
  const ml = Math.min(rect.x0, rect.x1), mr = Math.max(rect.x0, rect.x1);
  const mt = Math.min(rect.y0, rect.y1), mb = Math.max(rect.y0, rect.y1);
  const out: string[] = [];
  for (const el of elements) {
    if (!isVisualElement(el) || !isElementActive(el, playhead, sourceDuration)) continue;
    if (typeof el.id !== 'string') continue;
    const box = elementSourceBox(el, source);
    if (!box) continue;
    if (box.x < mr && box.x + box.w > ml && box.y < mb && box.y + box.h > mt) out.push(el.id);
  }
  return out;
}

/**
 * Walk a group drill-down path. Returns the scoped child elements (the deepest
 * entered group's `elements`, or the root when the path is empty) plus the group
 * elements crossed (for breadcrumbs). A stale id stops the walk early.
 */
export function resolveGroupPath(
  rootElements: readonly Element[],
  groupPath: readonly string[],
): { elements: readonly Element[]; crumbs: Element[]; offset: { x: number; y: number }; timeOffset: number } {
  let els = rootElements;
  const crumbs: Element[] = [];
  // Cumulative child transform of the entered groups. A group translates its
  // children by its center, and its children's time is local to its start — so
  // child boxes/hit-tests/playhead map through `offset` + `timeOffset`. Pure
  // translate composition (scale/rotation on a group aren't baked here yet).
  let ox = 0, oy = 0, timeOffset = 0;
  for (const id of groupPath) {
    const g = els.find((e) => e.id === id && e.type === 'group') as (Element & { elements?: Element[] }) | undefined;
    if (!g || !Array.isArray(g.elements)) break;
    crumbs.push(g);
    const gx = typeof g.x === 'number' ? g.x : 0;
    const gy = typeof g.y === 'number' ? g.y : 0;
    const gw = typeof g.width === 'number' ? g.width : 0;
    const gh = typeof g.height === 'number' ? g.height : 0;
    // A group's children sit relative to its TOP-LEFT corner (verified against
    // the runtime), i.e. anchor-point minus the anchored fraction of the box.
    ox += gx - parseAnchor(g.x_anchor) * gw;
    oy += gy - parseAnchor(g.y_anchor) * gh;
    timeOffset += typeof g.time === 'number' ? g.time : 0;
    els = g.elements;
  }
  return { elements: els, crumbs, offset: { x: ox, y: oy }, timeOffset };
}

/** Apply a rotation (degrees) around (0,0). */
export function rotateVec(
  v: { x: number; y: number },
  degrees: number,
): { x: number; y: number } {
  const rad = (degrees * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

/** Apply the inverse rotation (degrees) around (0,0). */
export function inverseRotate(
  v: { x: number; y: number },
  degrees: number,
): { x: number; y: number } {
  return rotateVec(v, -degrees);
}

/**
 * Convert client (screen) coordinates to source-space coordinates,
 * using the viewport's bounding rect and the current zoom + pan.
 */
export function screenToSource(
  clientX: number,
  clientY: number,
  viewportRect: DOMRect,
  zoom: number,
  pan: { x: number; y: number },
): { x: number; y: number } {
  return {
    x: (clientX - viewportRect.left - pan.x) / zoom,
    y: (clientY - viewportRect.top - pan.y) / zoom,
  };
}

// ── Resize handles ────────────────────────────────────────────────────

/** The 8 resize handles around the bounding box. */
export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export const RESIZE_HANDLES: readonly ResizeHandle[] = [
  'nw',
  'n',
  'ne',
  'e',
  'se',
  's',
  'sw',
  'w',
] as const;

/** Which edges of the bounding box each handle controls. */
const HANDLE_EDGES: Record<
  ResizeHandle,
  { left?: boolean; right?: boolean; top?: boolean; bottom?: boolean }
> = {
  nw: { left: true, top: true },
  n: { top: true },
  ne: { right: true, top: true },
  e: { right: true },
  se: { right: true, bottom: true },
  s: { bottom: true },
  sw: { left: true, bottom: true },
  w: { left: true },
};

export const HANDLE_CURSOR: Record<ResizeHandle, string> = {
  nw: 'nwse-resize',
  n: 'ns-resize',
  ne: 'nesw-resize',
  e: 'ew-resize',
  se: 'nwse-resize',
  s: 'ns-resize',
  sw: 'nesw-resize',
  w: 'ew-resize',
};

/** Position (as % of bounding box) where each handle sits. */
export const HANDLE_POSITION: Record<
  ResizeHandle,
  { left: string; top: string }
> = {
  nw: { left: '0%', top: '0%' },
  n: { left: '50%', top: '0%' },
  ne: { left: '100%', top: '0%' },
  e: { left: '100%', top: '50%' },
  se: { left: '100%', top: '100%' },
  s: { left: '50%', top: '100%' },
  sw: { left: '0%', top: '100%' },
  w: { left: '0%', top: '50%' },
};

/** Initial element state captured at the start of a resize drag. */
export interface ResizeInitial {
  x: number;
  y: number;
  width: number;
  height: number;
  xAnchor: number;
  yAnchor: number;
}

const MIN_DIMENSION = 8;

/**
 * Given an element's initial bounds + the cursor's current source
 * position, compute the new element fields after a resize drag.
 * Honors x/y_anchor (so the "fixed" edge stays put in source space)
 * and a Shift-key aspect-ratio lock on corner handles.
 */
export function computeResize(
  init: ResizeInitial,
  handle: ResizeHandle,
  cursorSourceX: number,
  cursorSourceY: number,
  shiftKey: boolean,
): { x: number; y: number; width: number; height: number } {
  const edges = HANDLE_EDGES[handle];

  // Initial bounding box in source space (top-left + bottom-right).
  const initLeft = init.x - init.width * init.xAnchor;
  const initTop = init.y - init.height * init.yAnchor;
  const initRight = initLeft + init.width;
  const initBottom = initTop + init.height;

  let newLeft = initLeft;
  let newTop = initTop;
  let newRight = initRight;
  let newBottom = initBottom;

  if (edges.left) newLeft = cursorSourceX;
  if (edges.right) newRight = cursorSourceX;
  if (edges.top) newTop = cursorSourceY;
  if (edges.bottom) newBottom = cursorSourceY;

  // Enforce minimum size — clamp the moving edge so the box never
  // collapses to zero (or flips inside-out).
  if (newRight - newLeft < MIN_DIMENSION) {
    if (edges.left) newLeft = newRight - MIN_DIMENSION;
    else newRight = newLeft + MIN_DIMENSION;
  }
  if (newBottom - newTop < MIN_DIMENSION) {
    if (edges.top) newTop = newBottom - MIN_DIMENSION;
    else newBottom = newTop + MIN_DIMENSION;
  }

  // Aspect-ratio lock on corner handles when Shift is held.
  const isCorner =
    (edges.left || edges.right) && (edges.top || edges.bottom);
  if (shiftKey && isCorner) {
    const aspect = init.width / init.height;
    const proposedW = newRight - newLeft;
    const proposedH = newBottom - newTop;
    // Pick the axis that moved further (relative to original).
    const ratioW = proposedW / init.width;
    const ratioH = proposedH / init.height;
    if (ratioW > ratioH) {
      const targetH = proposedW / aspect;
      if (edges.top) newTop = newBottom - targetH;
      else newBottom = newTop + targetH;
    } else {
      const targetW = proposedH * aspect;
      if (edges.left) newLeft = newRight - targetW;
      else newRight = newLeft + targetW;
    }
  }

  const newWidth = newRight - newLeft;
  const newHeight = newBottom - newTop;
  const newX = newLeft + newWidth * init.xAnchor;
  const newY = newTop + newHeight * init.yAnchor;

  return { x: newX, y: newY, width: newWidth, height: newHeight };
}

// ── Rotation handle ────────────────────────────────────────────────

const ROTATION_SNAP_DEG = 15;

/**
 * Compute the cursor angle relative to the element's anchor, measured
 * clockwise from "up" (12 o'clock), in degrees.
 *
 *   straight up    →   0°
 *   straight right →  90°
 *   straight down  → 180°
 *   straight left  → 270°
 *
 * Matches the convention used by `rotation` in the Clipkit schema.
 */
export function angleFromAnchor(
  anchorX: number,
  anchorY: number,
  cursorX: number,
  cursorY: number,
): number {
  const dx = cursorX - anchorX;
  const dy = cursorY - anchorY;
  // atan2(dx, -dy): the negation on dy flips Y so "up" is 0 and the
  // angle increases clockwise (canvas Y is down).
  return (Math.atan2(dx, -dy) * 180) / Math.PI;
}

/**
 * Given the initial element rotation + initial cursor angle + current
 * cursor angle, compute the new rotation. Shift snaps to 15°
 * increments (standard editor convention).
 */
export function computeRotation(
  initialRotation: number,
  initialCursorAngle: number,
  cursorAngle: number,
  shiftKey: boolean,
): number {
  const delta = cursorAngle - initialCursorAngle;
  const raw = initialRotation + delta;
  if (!shiftKey) return raw;
  return Math.round(raw / ROTATION_SNAP_DEG) * ROTATION_SNAP_DEG;
}
