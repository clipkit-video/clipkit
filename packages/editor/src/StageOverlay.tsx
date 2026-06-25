// Stage overlay — sits inside the Stage viewport on top of the canvas.
// Draws the selection bounding box, resize handles (for single
// selection), and captures pointer events to move + resize selected
// elements. The renderer never knows the user is editing — this
// overlay computes new transform fields in source space and dispatches
// `moveElements` patches. Same data direction as everything else.
//
// Drag modes (discriminated):
//   - 'move'   — drag the box body, translate all selected by a delta
//   - 'resize' — drag a corner / edge handle, change width/height/x/y
//                of a single element with the opposite edge fixed
//
// Single-element-only resize for now; multi-select still moves as a
// group. Rotated hit-testing + rotation handles are follow-up phases.

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from 'react';
import type { Element } from '@clipkit/protocol';
import { useEditor } from '@clipkit/editor-core';
import { useEditorContext } from '@clipkit/editor-core';
import { useEditorStore } from '@clipkit/editor-core';
import {
  angleFromAnchor,
  computeResize,
  computeRotation,
  elementRotation,
  elementSourceBox,
  hitTest,
  resolveGroupPath,
  parseAnchor,
  screenToSource,
  HANDLE_CURSOR,
  HANDLE_POSITION,
  RESIZE_HANDLES,
  type ResizeHandle,
  type ResizeInitial,
} from '@clipkit/editor-core';
import {
  cameraGizmosActive,
  cameraHitTest,
  projectElementQuad,
  unprojectToPlane,
  elementDepthZ,
  type Pt,
} from './lib/camera-gizmo.js';
import { evalExpr } from '@clipkit/runtime';

interface Props {
  viewportRef: RefObject<HTMLDivElement | null>;
}

// All drag modes carry the cursor's CLIENT position at drag-start +
// the zoom captured at drag-start. Per-frame math is then a pure
// delta: dClientX/Y → dSourceX/Y via `/ ctx.zoom`. Crucially we never
// re-read the viewport's bounding rect during the drag, so layout
// shifts (e.g. the Edit panel sliding in when selection changes,
// shrinking the viewport from the left) can't desync the math and
// make the element appear to jump by the panel width.
type DragCtx =
  | {
      type: 'move';
      ids: string[];
      initial: Map<string, { x: number; y: number }>;
      startClientX: number;
      startClientY: number;
      zoom: number;
      // Camera-view move: map the drag through the camera at the
      // element's own depth plane instead of a flat screen-delta / zoom.
      camera?: {
        time: number;
        rectLeft: number;
        rectTop: number;
        panX: number;
        panY: number;
        planeZ: Map<string, number>;
      };
    }
  | {
      type: 'resize';
      id: string;
      handle: ResizeHandle;
      init: ResizeInitial;
      startCursorSourceX: number;
      startCursorSourceY: number;
      startClientX: number;
      startClientY: number;
      zoom: number;
    }
  | {
      type: 'rotate';
      id: string;
      anchorX: number;
      anchorY: number;
      initialRotation: number;
      initialCursorAngle: number;
      startCursorSourceX: number;
      startCursorSourceY: number;
      startClientX: number;
      startClientY: number;
      zoom: number;
    };

export function StageOverlay({ viewportRef }: Props) {
  // Note on playback.time: NOT subscribed. The hover hit-test reads
  // the latest value via store.getState() in the mousemove handler;
  // subscribing would re-render this component ~10×/sec during
  // playback for no visual benefit (the overlay returns null while
  // playing anyway).
  const { store } = useEditorContext();
  const source = useEditorStore((s) => s.source);
  const selection = useEditorStore((s) => s.selection);
  const groupPath = useEditorStore((s) => s.ui.groupPath);
  const _scope = resolveGroupPath(source.elements, groupPath);
  const scopedElements = _scope.elements;
  const groupOffset = _scope.timeOffset;
  const groupPos = _scope.offset;
  const zoom = useEditorStore((s) => s.ui.stageZoom);
  const tool = useEditorStore((s) => s.ui.tool);
  // Hand tool: disable the overlay's interactive hit-targets so a drag falls
  // through to the Stage and pans (over elements too), instead of moving them.
  const pe = tool === 'hand' ? 'pointer-events-none' : 'pointer-events-auto';
  const pan = useEditorStore((s) => s.ui.stagePan);
  const stageView = useEditorStore((s) => s.ui.stageView);
  const cameraActive = cameraGizmosActive(source, stageView);
  // Camera gizmos depend on the playhead (keyframed camera / animated
  // element). Subscribed only so a paused scrub re-projects; the overlay
  // early-returns null while playing, so playback churn is a no-op render.
  const playheadTime = useEditorStore((s) => s.playback.time);
  const playbackDuration = useEditorStore((s) => s.playback.duration);
  // During playback the overlay goes inert — no hover, no boxes, no
  // hit-testing — so React isn't spending main-thread time on stuff
  // the user can't interact with anyway, and the presenter loop's
  // drawImage stays unblocked.
  const playing = useEditorStore((s) => s.playback.playing);
  const {
    moveElements,
    pushHistory,
    setInteractive,
    flushPendingSource,
    selectOne,
  } = useEditor();

  const dragRef = useRef<DragCtx | null>(null);
  const [dragging, setDragging] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // ── Selected element boxes — read directly from source ────────────
  const selectedBoxes = useMemo(() => {
    if (selection.length === 0) return [];
    const out: Array<{
      el: Element;
      sx: number;
      sy: number;
      sw: number;
      sh: number;
      rotation: number;
      xAnchor: number;
      yAnchor: number;
    }> = [];
    for (const el of scopedElements) {
      if (!el.id || !selection.includes(el.id)) continue;
      const box = elementSourceBox(el, source, { time: playheadTime - groupOffset, evalExpr });
      if (!box) continue;
      out.push({
        el,
        sx: box.x + groupPos.x,
        sy: box.y + groupPos.y,
        sw: box.w,
        sh: box.h,
        rotation: elementRotation(el),
        // Rotation pivots the box CENTRE (the runtime rotates around the
        // geometric centre regardless of anchor) — drives transformOrigin.
        xAnchor: 0.5,
        yAnchor: 0.5,
      });
    }
    return out;
  }, [source, selection, playheadTime, groupPath]);

  // ── Drag starters ────────────────────────────────────────────────
  const beginDrag = (ctx: DragCtx): void => {
    dragRef.current = ctx;
    setDragging(true);
    pushHistory();
    setInteractive(true);
  };

  const startMoveDrag = (
    e: ReactMouseEvent<HTMLDivElement>,
    target: Element,
  ): void => {
    if (e.button !== 0) return;
    if (!target.id) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    e.stopPropagation();
    e.preventDefault();

    const ids = selection.includes(target.id) ? selection : [target.id];
    const initial = new Map<string, { x: number; y: number }>();
    for (const id of ids) {
      const el = findById(source.elements, id);
      if (!el) continue;
      const sw = source.width ?? 1920;
      const sh = source.height ?? 1080;
      initial.set(id, {
        x: typeof el.x === 'number' ? el.x : sw / 2,
        y: typeof el.y === 'number' ? el.y : sh / 2,
      });
    }

    let cameraCtx: { time: number; rectLeft: number; rectTop: number; panX: number; panY: number; planeZ: Map<string, number> } | undefined;
    if (cameraActive) {
      const rect = viewport.getBoundingClientRect();
      const time = store.getState().playback.time;
      const planeZ = new Map<string, number>();
      for (const id of ids) {
        const el = findById(source.elements, id);
        if (el) planeZ.set(id, elementDepthZ(source, el, time));
      }
      cameraCtx = { time, rectLeft: rect.left, rectTop: rect.top, panX: pan.x, panY: pan.y, planeZ };
    }

    beginDrag({
      type: 'move',
      ids,
      initial,
      startClientX: e.clientX,
      startClientY: e.clientY,
      zoom: zoom || 1,
      camera: cameraCtx,
    });
  };

  const startRotateDrag = (
    e: ReactMouseEvent<HTMLDivElement>,
    target: Element,
  ): void => {
    if (e.button !== 0) return;
    if (!target.id) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    e.stopPropagation();
    e.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const cursorX = (e.clientX - rect.left - pan.x) / zoom;
    const cursorY = (e.clientY - rect.top - pan.y) / zoom;
    const sw = source.width ?? 1920;
    const sh = source.height ?? 1080;
    const anchorX = typeof target.x === 'number' ? target.x : sw / 2;
    const anchorY = typeof target.y === 'number' ? target.y : sh / 2;
    const initialRotation = elementRotation(target);
    const initialCursorAngle = angleFromAnchor(
      anchorX,
      anchorY,
      cursorX,
      cursorY,
    );
    beginDrag({
      type: 'rotate',
      id: target.id,
      anchorX,
      anchorY,
      initialRotation,
      initialCursorAngle,
      startCursorSourceX: cursorX,
      startCursorSourceY: cursorY,
      startClientX: e.clientX,
      startClientY: e.clientY,
      zoom: zoom || 1,
    });
  };

  const startResizeDrag = (
    e: ReactMouseEvent<HTMLDivElement>,
    target: Element,
    handle: ResizeHandle,
  ): void => {
    if (e.button !== 0) return;
    if (!target.id) return;
    if (typeof target.width !== 'number' || typeof target.height !== 'number') {
      // Element doesn't have explicit numeric dims; can't resize via
      // bounding box. Skip silently.
      return;
    }
    const viewport = viewportRef.current;
    if (!viewport) return;
    e.stopPropagation();
    e.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const startCursorSourceX = (e.clientX - rect.left - pan.x) / zoom;
    const startCursorSourceY = (e.clientY - rect.top - pan.y) / zoom;

    const sw = source.width ?? 1920;
    const sh = source.height ?? 1080;
    const init: ResizeInitial = {
      x: typeof target.x === 'number' ? target.x : sw / 2,
      y: typeof target.y === 'number' ? target.y : sh / 2,
      width: target.width,
      height: target.height,
      xAnchor: parseAnchor(target.x_anchor),
      yAnchor: parseAnchor(target.y_anchor),
    };

    beginDrag({
      type: 'resize',
      id: target.id,
      handle,
      init,
      startCursorSourceX,
      startCursorSourceY,
      startClientX: e.clientX,
      startClientY: e.clientY,
      zoom: zoom || 1,
    });
  };

  // ── Hover tracking ───────────────────────────────────────────────
  // Listen for mousemove on the viewport, hit-test, surface a hovered
  // id. The hover ghost box renders below — pointer-events: none, so
  // it never interferes with click-to-select or the selection handles.
  // Suppressed while dragging (otherwise the box flickers under your
  // cursor mid-drag).
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    if (dragging || playing) {
      // Drop any stale hover so it doesn't flash back when the drag
      // ends or playback stops over a different element.
      if (hoveredId !== null) setHoveredId(null);
      return;
    }
    const onMove = (ev: MouseEvent): void => {
      const rect = viewport.getBoundingClientRect();
      const dur = playbackDuration > 0 ? playbackDuration : 1e9;
      // Read the playhead lazily — no subscription, no re-render
      // churn on time updates.
      const t = store.getState().playback.time;
      let hit: Element | null;
      if (cameraActive) {
        const cpt = {
          x: (ev.clientX - rect.left - pan.x) / (zoom || 1),
          y: (ev.clientY - rect.top - pan.y) / (zoom || 1),
        };
        hit = cameraHitTest(source, cpt, t, dur);
      } else {
        const pt = screenToSource(ev.clientX, ev.clientY, rect, zoom, pan);
        hit = hitTest(scopedElements, source, { x: pt.x - groupPos.x, y: pt.y - groupPos.y }, t - groupOffset, dur);
      }
      const nextId = hit?.id ?? null;
      setHoveredId((prev) => (prev === nextId ? prev : nextId));
    };
    const onLeave = (): void => setHoveredId(null);
    viewport.addEventListener('mousemove', onMove);
    viewport.addEventListener('mouseleave', onLeave);
    return () => {
      viewport.removeEventListener('mousemove', onMove);
      viewport.removeEventListener('mouseleave', onLeave);
    };
  }, [
    viewportRef,
    playing,
    dragging,
    hoveredId,
    source,
    zoom,
    pan,
    cameraActive,
    playbackDuration,
    store,
    groupPath,
  ]);

  // ── Live drag dispatches ─────────────────────────────────────────
  // Per-frame math is pure delta in client space → source space via
  // the zoom captured at drag-start. We deliberately don't touch the
  // viewport rect, pan, or live store zoom here — that keeps drags
  // immune to layout changes (Panel sliding in on select) and to mid-
  // drag wheel-zooms.
  useEffect(() => {
    if (!dragging) return;

    const dispatchUpdate = (
      ev: { clientX: number; clientY: number; shiftKey: boolean },
    ): void => {
      const ctx = dragRef.current;
      if (!ctx) return;
      const dSourceX = (ev.clientX - ctx.startClientX) / ctx.zoom;
      const dSourceY = (ev.clientY - ctx.startClientY) / ctx.zoom;

      if (ctx.type === 'move') {
        const updates: Array<{ id: string; patch: Partial<Element> }> = [];
        const cam = ctx.camera;
        for (const [id, init] of ctx.initial) {
          let dx = dSourceX;
          let dy = dSourceY;
          if (cam) {
            // Camera view: unproject the start and current pointer onto
            // the element's own depth plane, so the drag tracks the
            // cursor through the perspective.
            const z = cam.planeZ.get(id) ?? 0;
            const toCanvas = (cx: number, cy: number): Pt => ({
              x: (cx - cam.rectLeft - cam.panX) / ctx.zoom,
              y: (cy - cam.rectTop - cam.panY) / ctx.zoom,
            });
            const wStart = unprojectToPlane(source, cam.time, toCanvas(ctx.startClientX, ctx.startClientY), z);
            const wNow = unprojectToPlane(source, cam.time, toCanvas(ev.clientX, ev.clientY), z);
            if (wStart && wNow) {
              dx = wNow.x - wStart.x;
              dy = wNow.y - wStart.y;
            }
          }
          updates.push({
            id,
            patch: { x: init.x + dx, y: init.y + dy } as Partial<Element>,
          });
        }
        moveElements(updates, { skipHistory: true });
      } else if (ctx.type === 'resize') {
        const cursorX = ctx.startCursorSourceX + dSourceX;
        const cursorY = ctx.startCursorSourceY + dSourceY;
        const result = computeResize(
          ctx.init,
          ctx.handle,
          cursorX,
          cursorY,
          ev.shiftKey,
        );
        moveElements(
          [{ id: ctx.id, patch: result as Partial<Element> }],
          { skipHistory: true },
        );
      } else {
        // rotate
        const cursorX = ctx.startCursorSourceX + dSourceX;
        const cursorY = ctx.startCursorSourceY + dSourceY;
        const cursorAngle = angleFromAnchor(
          ctx.anchorX,
          ctx.anchorY,
          cursorX,
          cursorY,
        );
        const newRotation = computeRotation(
          ctx.initialRotation,
          ctx.initialCursorAngle,
          cursorAngle,
          ev.shiftKey,
        );
        moveElements(
          [{ id: ctx.id, patch: { rotation: newRotation } as Partial<Element> }],
          { skipHistory: true },
        );
      }
    };

    const onMove = (ev: MouseEvent): void => {
      dispatchUpdate(ev);
    };
    const onUp = (ev: MouseEvent): void => {
      // Final dispatch with mouseup coords — closes the ~16ms gap
      // between the last mousemove sample and the actual release point.
      dispatchUpdate(ev);
      flushPendingSource();
      dragRef.current = null;
      setDragging(false);
      setInteractive(false);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging]);

  // Single-selection shows resize handles. Multi-select just shows
  // bounding boxes for moveable group context.
  const showHandles = selection.length === 1;

  // Hover ghost — only shown when the hovered element isn't already
  // selected (the selection box subsumes it).
  const hoveredBox = useMemo(() => {
    if (!hoveredId) return null;
    if (selection.includes(hoveredId)) return null;
    const el = scopedElements.find((e) => e.id === hoveredId);
    if (!el) return null;
    const box = elementSourceBox(el, source, { time: playheadTime - groupOffset, evalExpr });
    if (!box) return null;
    return {
      el,
      sx: box.x + groupPos.x,
      sy: box.y + groupPos.y,
      sw: box.w,
      sh: box.h,
      rotation: elementRotation(el),
      // Rotation pivots the box CENTRE (see selectedBoxes) — for transformOrigin.
      xAnchor: 0.5,
      yAnchor: 0.5,
    };
  }, [hoveredId, selection, source, playheadTime, groupPath]);

  // While playing, render nothing. The Stage's onMouseDown still
  // handles clicks (and will pause the playback), but there's no
  // hover ghost, no selection frame, no handles — keeps the canvas
  // clean during preview and frees the main thread from per-mousemove
  // hit-testing and per-time-tick box re-positioning.
  if (playing) return null;

  // Camera view: gizmos are SVG polygons through the element's PROJECTED
  // corners (move + select only; resize/rotate stay a Flat-view op).
  if (cameraActive) {
    const toScreen = (el: Element): Pt[] | null => {
      const q = projectElementQuad(source, el, playheadTime);
      if (!q) return null;
      return q.map((p) => ({ x: pan.x + p.x * zoom, y: pan.y + p.y * zoom }));
    };
    const pts = (q: Pt[]): string => q.map((p) => `${p.x},${p.y}`).join(' ');
    const hoverEl =
      hoveredId && !selection.includes(hoveredId)
        ? scopedElements.find((e) => e.id === hoveredId) ?? null
        : null;
    const hoverQuad = hoverEl ? toScreen(hoverEl) : null;
    return (
      <svg className="absolute inset-0 pointer-events-none" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
        {hoverQuad && hoverEl && (
          <polygon
            points={pts(hoverQuad)}
            className={pe}
            style={{ fill: 'transparent', stroke: 'var(--color-accent, #3b82f6)', strokeWidth: 1.5, cursor: 'move' }}
            onMouseDown={(e) => {
              if (e.button !== 0 || !hoverEl.id) return;
              selectOne(hoverEl.id);
              startMoveDrag(e as unknown as ReactMouseEvent<HTMLDivElement>, hoverEl);
            }}
          />
        )}
        {selectedBoxes.map(({ el }) => {
          const q = toScreen(el);
          if (!q) return null;
          return (
            <g key={el.id}>
              <polygon
                points={pts(q)}
                className={pe}
                style={{ fill: 'transparent', stroke: 'var(--color-foreground)', strokeWidth: 1.5, cursor: dragging ? 'grabbing' : 'move' }}
                onMouseDown={(e) => startMoveDrag(e as unknown as ReactMouseEvent<HTMLDivElement>, el)}
              />
              {q.map((p, i) => (
                <rect
                  key={i}
                  x={p.x - 4}
                  y={p.y - 4}
                  width={8}
                  height={8}
                  style={{ fill: 'var(--color-background)', stroke: 'var(--color-foreground)', strokeWidth: 1.5 }}
                />
              ))}
            </g>
          );
        })}
      </svg>
    );
  }

  return (
    <div className="absolute inset-0 pointer-events-none">
      {hoveredBox && (
        <div
          className={`absolute ${pe}`}
          style={{
            left: pan.x + hoveredBox.sx * zoom,
            top: pan.y + hoveredBox.sy * zoom,
            width: hoveredBox.sw * zoom,
            height: hoveredBox.sh * zoom,
            transform:
              hoveredBox.rotation !== 0
                ? `rotate(${hoveredBox.rotation}deg)`
                : undefined,
            transformOrigin: `${hoveredBox.xAnchor * 100}% ${hoveredBox.yAnchor * 100}%`,
            border: '1.5px solid var(--color-accent, #3b82f6)',
            borderRadius: 1,
            // Faint, no inset shadow — distinct from the selection box.
            boxShadow: 'none',
            cursor: 'move',
          }}
          // Click on hover ghost: select + immediately start a move drag,
          // so the user can click-and-drag in one motion (Figma-style).
          // If they release without moving, it just selects.
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            if (!hoveredBox.el.id) return;
            selectOne(hoveredBox.el.id);
            startMoveDrag(e, hoveredBox.el);
          }}
        />
      )}
      {selectedBoxes.map(({ el, sx, sy, sw, sh, rotation, xAnchor, yAnchor }) => {
        const screenX = pan.x + sx * zoom;
        const screenY = pan.y + sy * zoom;
        const screenW = sw * zoom;
        const screenH = sh * zoom;
        // Resize knobs need explicit numeric width/height — we patch
        // those values, and string/percent/"auto" sizing doesn't have a
        // sensible "drag the edge by N pixels" semantic. Rotation has
        // no such dependency; it just toggles a number field.
        const canResize =
          showHandles &&
          typeof el.width === 'number' &&
          typeof el.height === 'number';
        const canRotate = showHandles;
        return (
          <div
            key={el.id}
            className="absolute"
            style={{
              left: screenX,
              top: screenY,
              width: screenW,
              height: screenH,
              // Rotate the wrapper around the box CENTRE so the overlay
              // matches the render (the runtime pivots rotation at the
              // geometric centre regardless of anchor).
              transform: rotation !== 0 ? `rotate(${rotation}deg)` : undefined,
              transformOrigin: `${xAnchor * 100}% ${yAnchor * 100}%`,
              pointerEvents: 'none',
            }}
          >
            {/* Selection frame / move handle. */}
            <div
              className={`absolute inset-0 ${pe}`}
              style={{
                cursor: dragging ? 'grabbing' : 'move',
                border: '1.5px solid var(--color-foreground)',
                boxShadow: '0 0 0 1px rgba(0,0,0,0.4) inset',
              }}
              onMouseDown={(e) => startMoveDrag(e, el)}
            />

            {/* Resize handles. */}
            {canResize &&
              RESIZE_HANDLES.map((h) => {
                const pos = HANDLE_POSITION[h];
                return (
                  <div
                    key={h}
                    className={`absolute ${pe}`}
                    style={{
                      left: pos.left,
                      top: pos.top,
                      width: 10,
                      height: 10,
                      transform: 'translate(-50%, -50%)',
                      background: 'var(--color-background)',
                      border: '1.5px solid var(--color-foreground)',
                      borderRadius: 2,
                      cursor: HANDLE_CURSOR[h],
                    }}
                    onMouseDown={(e) => startResizeDrag(e, el, h)}
                  />
                );
              })}

            {/* Rotation handle — sits above the top-center of the box
                on a short stalk. Rotates with the box (since it lives
                inside the rotated wrapper). */}
            {canRotate && (
              <>
                <div
                  className="absolute pointer-events-none"
                  style={{
                    left: '50%',
                    top: 0,
                    width: 1,
                    height: 16,
                    background: 'var(--color-foreground)',
                    transform: 'translate(-50%, -100%)',
                  }}
                />
                <div
                  className={`absolute ${pe}`}
                  style={{
                    left: '50%',
                    top: 0,
                    width: 12,
                    height: 12,
                    transform: 'translate(-50%, calc(-100% - 16px))',
                    background: 'var(--color-background)',
                    border: '1.5px solid var(--color-foreground)',
                    borderRadius: '50%',
                    cursor: 'grab',
                  }}
                  onMouseDown={(e) => startRotateDrag(e, el)}
                  title="Drag to rotate · Shift for 15° increments"
                />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────

function findById(elements: readonly Element[], id: string): Element | null {
  for (const el of elements) {
    if (el.id === id) return el;
    if (el.type === 'group') {
      const nested = findById(el.elements as readonly Element[], id);
      if (nested) return nested;
    }
  }
  return null;
}
