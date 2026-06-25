// Stage — viewport for the rendered preview. Canvas displays at its
// natural source dimensions (1920 × 1080, 1080 × 1920, etc.) transformed
// by a zoom + pan applied to the wrapping div. Standard video-editor
// canvas behavior:
//
//   - Wheel              → zoom (centered on cursor)
//   - Cmd/Ctrl + wheel   → zoom (alt, also catches trackpad pinch)
//   - Click + drag on background → pan
//   - Space + click + drag       → pan (always, even over clip overlays)
//   - Zoom controls in the bottom-right corner
//   - Fit-to-screen computed once on first viewport measurement
//
// Zoom + pan live in `ui.stageZoom` and `ui.stagePan` (Zustand). They
// don't go into history — pure viewport state.

import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { useEditor } from '@clipkit/editor-core';
import { useEditorContext } from '@clipkit/editor-core';
import { PerfHud } from './PerfHud.js';
import { useEditorStore } from '@clipkit/editor-core';
import { StageOverlay } from './StageOverlay.js';
import { MotionPathOverlay } from './MotionPathOverlay.js';
import { ZoomControl } from './frame/ZoomControl.js';
import { AddElementBar } from './frame/AddElementBar.js';
import { Breadcrumbs } from './frame/Breadcrumbs.js';
import { cn } from './lib/utils.js';
import { hitTest, screenToSource, boxSelect, resolveGroupPath } from '@clipkit/editor-core';
import { cameraGizmosActive, cameraHitTest } from './lib/camera-gizmo.js';

const VIEWPORT_PADDING = 32;
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 16;
const ZOOM_STEP = 0.15;
// Wheel/trackpad zoom is per-event (and trackpads fire many events per gesture),
// so it gets a gentler step than the +/- buttons.
const WHEEL_ZOOM_STEP = 0.06;

interface StagePanRef {
  panning: boolean;
  startX: number;
  startY: number;
  startPan: { x: number; y: number };
}

const CLICK_VS_DRAG_THRESHOLD_PX = 4;

export const Stage = forwardRef<HTMLCanvasElement>(function Stage(_, ref) {
  // Note on playback.time: we deliberately do NOT subscribe. It updates
  // ~10×/sec during playback and Stage doesn't render anything that
  // depends on it — the only consumer is the click-to-hit-test path,
  // which reads the latest value via store.getState() on demand.
  const { store } = useEditorContext();
  const ready = useEditorStore((s) => s.playback.ready);
  const error = useEditorStore((s) => s.playback.error);
  const source = useEditorStore((s) => s.source);
  const selection = useEditorStore((s) => s.selection);
  // playback.duration changes only on source updates, not per frame.
  const playbackDuration = useEditorStore((s) => s.playback.duration);
  const playing = useEditorStore((s) => s.playback.playing);
  const zoom = useEditorStore((s) => s.ui.stageZoom);
  const pan = useEditorStore((s) => s.ui.stagePan);
  const stageView = useEditorStore((s) => s.ui.stageView);
  const tool = useEditorStore((s) => s.ui.tool);
  const groupPath = useEditorStore((s) => s.ui.groupPath);
  const _scope = resolveGroupPath(source.elements, groupPath);
  const scopedElements = _scope.elements;
  const groupOffset = _scope.timeOffset;
  const groupPos = _scope.offset;
  const {
    clearSelection,
    setSelection,
    selectOne,
    setUiState,
    pause,
    patchSource,
    pushHistory,
    setInteractive,
    flushPendingSource,
  } = useEditor();

  const srcW = source.width ?? 1920;
  const srcH = source.height ?? 1080;

  const viewportRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<StagePanRef>({
    panning: false,
    startX: 0,
    startY: 0,
    startPan: { x: 0, y: 0 },
  });
  const spaceHeldRef = useRef(false);

  // ── Fit-to-screen ────────────────────────────────────────────────
  const fitToScreen = useCallback((): void => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const vw = viewport.clientWidth - VIEWPORT_PADDING * 2;
    const vh = viewport.clientHeight - VIEWPORT_PADDING * 2;
    if (vw <= 0 || vh <= 0) return;
    const fitZoom = Math.min(vw / srcW, vh / srcH);
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, fitZoom));
    const centerX = (viewport.clientWidth - srcW * newZoom) / 2;
    const centerY = (viewport.clientHeight - srcH * newZoom) / 2;
    setUiState({ stageZoom: newZoom, stagePan: { x: centerX, y: centerY } });
  }, [srcW, srcH, setUiState]);

  // ── Initial auto-fit on mount (zoom=0 sentinel) ──────────────────
  useLayoutEffect(() => {
    if (zoom === 0) fitToScreen();
    // Refit if the source dimensions change (rare — happens on
    // setSource to a different composition).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srcW, srcH]);

  // ── Wheel = zoom (cursor-centered) ──────────────────────────────
  // Registered via a manual addEventListener with passive: false so
  // we can call preventDefault inside (React's synthetic wheel handler
  // is forced-passive and warns when you preventDefault). Reads zoom/
  // pan via refs so the listener doesn't need to be re-attached on
  // every state change.
  const zoomLiveRef = useRef(zoom);
  zoomLiveRef.current = zoom;
  const panZoomLiveRef = useRef(pan);
  panZoomLiveRef.current = pan;
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const currentZoom = zoomLiveRef.current;
      const currentPan = panZoomLiveRef.current;
      const rect = viewport.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const direction = -Math.sign(e.deltaY);
      const factor = 1 + direction * WHEEL_ZOOM_STEP;
      const newZoom = Math.max(
        MIN_ZOOM,
        Math.min(MAX_ZOOM, (currentZoom || 1) * factor),
      );
      if (newZoom === currentZoom) return;
      const canvasPointX = (cx - currentPan.x) / (currentZoom || 1);
      const canvasPointY = (cy - currentPan.y) / (currentZoom || 1);
      setUiState({
        stageZoom: newZoom,
        stagePan: {
          x: cx - canvasPointX * newZoom,
          y: cy - canvasPointY * newZoom,
        },
      });
    };
    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      viewport.removeEventListener('wheel', onWheel);
    };
  }, [setUiState]);

  // ── Stay-centered on viewport resize ────────────────────────────
  // When the viewport's size changes (Panel sliding in/out, JsonView
  // toggling, window resize), shift pan by half the size delta. This
  // keeps the source-space point that was at the viewport center
  // before the resize at the viewport center after — so a centered
  // canvas stays centered, and any intentional pan offset is
  // preserved relative to the new center.
  //
  // Uses live refs for pan/zoom so the observer doesn't need to be
  // re-attached on every state change.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    let prevW = viewport.clientWidth;
    let prevH = viewport.clientHeight;
    const observer = new ResizeObserver(() => {
      const w = viewport.clientWidth;
      const h = viewport.clientHeight;
      const dW = w - prevW;
      const dH = h - prevH;
      prevW = w;
      prevH = h;
      if (dW === 0 && dH === 0) return;
      // Zoom = 0 means "not yet fit-to-screen'd"; skip — the
      // fit-to-screen effect will set the right pan once dims are
      // known.
      if (zoomLiveRef.current === 0) return;
      const currentPan = panZoomLiveRef.current;
      setUiState({
        stagePan: {
          x: currentPan.x + dW / 2,
          y: currentPan.y + dH / 2,
        },
      });
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [setUiState]);

  // Keep a live ref to the current pan so the mousedown handler can
  // capture it without binding a stale closure.
  const panLiveRef = useRef(pan);
  panLiveRef.current = pan;
  const toolRef = useRef(tool);
  toolRef.current = tool;
  // Marquee box-select rectangle, in viewport (client-relative) px.
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  // Live refs so closures inside listeners read fresh values.
  const selectionLiveRef = useRef(selection);
  selectionLiveRef.current = selection;

  // ── Viewport mousedown — unified handler for pan vs click-select ──
  //
  // - Mousedown on viewport background or with space held →
  //     watch for movement. If the cursor moves > threshold, switch to
  //     pan mode and follow drag. If mouseup without crossing the
  //     threshold, treat as a click → hit-test, select/clear.
  // - Mousedown on a selection box (handled by StageOverlay) →
  //     overlay stops propagation, so we never get here.

  // Marquee box-select on the canvas (Select tool). Drag a rectangle over empty
  // canvas → select every element whose box it covers (Shift adds). Coords are
  // viewport-relative for the visual; corners convert to source space for the hit.
  const startMarquee = (e: React.MouseEvent<HTMLDivElement>): void => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const additive = e.shiftKey;
    const base = additive ? selectionLiveRef.current : [];
    const sx = e.clientX, sy = e.clientY;
    const x0 = sx - rect.left, y0 = sy - rect.top;
    setMarquee({ x0, y0, x1: x0, y1: y0 });
    let moved = false;
    const onMove = (ev: MouseEvent): void => {
      const x1 = ev.clientX - rect.left, y1 = ev.clientY - rect.top;
      if (Math.abs(x1 - x0) > CLICK_VS_DRAG_THRESHOLD_PX || Math.abs(y1 - y0) > CLICK_VS_DRAG_THRESHOLD_PX) moved = true;
      setMarquee({ x0, y0, x1, y1 });
    };
    const onUp = (ev: MouseEvent): void => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setMarquee(null);
      if (!moved) {
        if (!additive) clearSelection(); // plain click on empty = clear
        return;
      }
      const z = zoom || 1;
      const p0 = screenToSource(sx, sy, rect, z, panLiveRef.current);
      const p1 = screenToSource(ev.clientX, ev.clientY, rect, z, panLiveRef.current);
      const sourceDuration = playbackDuration > 0 ? playbackDuration : 1e9;
      const t = store.getState().playback.time;
      const hits = boxSelect(scopedElements, source, { x0: p0.x - groupPos.x, y0: p0.y - groupPos.y, x1: p1.x - groupPos.x, y1: p1.y - groupPos.y }, t - groupOffset, sourceDuration);
      setSelection(additive ? [...new Set([...base, ...hits])] : hits);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const onMouseDown = (e: React.MouseEvent<HTMLDivElement>): void => {
    const isMiddle = e.button === 1;
    const isLeft = e.button === 0;
    const onBackground = e.target === viewportRef.current;
    const canPanOnly = isMiddle && !onBackground;
    const canClickOrPan = isLeft && (onBackground || spaceHeldRef.current);
    if (!isMiddle && !isLeft) return;
    if (!canPanOnly && !canClickOrPan) return;
    e.preventDefault();

    // Playing → left-click pauses (unless space is held, in which
    // case the user is panning the viewport, not interacting with
    // content). Skips the hit-test/selection logic below; the user
    // gets a second click to actually select once paused.
    if (isLeft && playing && !spaceHeldRef.current) {
      pause();
      return;
    }

    // Select tool: left-drag on empty canvas marquees instead of panning. Space
    // still pans (temporary hand), and the Hand tool falls through to the pan
    // path below.
    if (isLeft && onBackground && !spaceHeldRef.current && toolRef.current === 'select') {
      startMarquee(e);
      return;
    }

    const startX = e.clientX;
    const startY = e.clientY;
    const startPan = { ...panLiveRef.current };
    let dragging = false;

    const onMove = (ev: MouseEvent): void => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!dragging) {
        if (dx * dx + dy * dy < CLICK_VS_DRAG_THRESHOLD_PX ** 2) return;
        dragging = true;
        panRef.current.panning = true;
      }
      setUiState({
        stagePan: { x: startPan.x + dx, y: startPan.y + dy },
      });
    };
    const onUp = (ev: MouseEvent): void => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      panRef.current.panning = false;
      if (dragging) return;
      // It was a click — hit-test against active elements.
      const viewport = viewportRef.current;
      if (!viewport || !isLeft || spaceHeldRef.current) return;
      const rect = viewport.getBoundingClientRect();
      const sourceDuration =
        playbackDuration > 0 ? playbackDuration : 1e9;
      const t = store.getState().playback.time;
      // Camera view: hit-test against the elements' PROJECTED quads so a
      // click selects what's actually on top under the camera.
      const hit = cameraGizmosActive(source, stageView)
        ? cameraHitTest(
            source,
            {
              x: (ev.clientX - rect.left - pan.x) / (zoom || 1),
              y: (ev.clientY - rect.top - pan.y) / (zoom || 1),
            },
            t,
            sourceDuration,
          )
        : (() => {
            const p = screenToSource(ev.clientX, ev.clientY, rect, zoom, pan);
            return hitTest(scopedElements, source, { x: p.x - groupPos.x, y: p.y - groupPos.y }, t - groupOffset, sourceDuration);
          })();
      if (hit?.id) {
        if (ev.shiftKey) {
          const sel = selectionLiveRef.current;
          if (sel.includes(hit.id)) {
            setSelection(sel.filter((s) => s !== hit.id));
          } else {
            setSelection([...sel, hit.id]);
          }
        } else {
          selectOne(hit.id);
        }
      } else {
        clearSelection();
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // ── Space key tracking (hold space + drag to pan over anything) ─
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.code === 'Space' && !isTypingTarget(e.target)) {
        spaceHeldRef.current = true;
        if (viewportRef.current) viewportRef.current.style.cursor = 'grab';
      }
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.code === 'Space') {
        spaceHeldRef.current = false;
        if (viewportRef.current) viewportRef.current.style.cursor = '';
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);


  // ── Zoom controls ───────────────────────────────────────────────
  const zoomBy = (factor: number): void => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const newZoom = Math.max(
      MIN_ZOOM,
      Math.min(MAX_ZOOM, (zoom || 1) * factor),
    );
    if (newZoom === zoom) return;
    const canvasPointX = (cx - pan.x) / (zoom || 1);
    const canvasPointY = (cy - pan.y) / (zoom || 1);
    setUiState({
      stageZoom: newZoom,
      stagePan: {
        x: cx - canvasPointX * newZoom,
        y: cy - canvasPointY * newZoom,
      },
    });
  };

  const effectiveZoom = zoom || 1;
  const canvasStyle: CSSProperties = {
    position: 'absolute',
    left: pan.x,
    top: pan.y,
    width: srcW * effectiveZoom,
    height: srcH * effectiveZoom,
    background: '#000',
    boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
    borderRadius: 4,
    cursor: spaceHeldRef.current ? 'grab' : 'default',
    // Let clicks pass through to the viewport so the unified pan-vs-click
    // handler runs. Without this, e.target is the canvas, onBackground
    // is false, and Stage's onMouseDown early-returns — so clicks on the
    // canvas (including on rendered elements) never selected anything.
    pointerEvents: 'none',
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 bg-stage overflow-hidden">
      <div
        ref={viewportRef}
        className="relative flex-1 min-h-0 min-w-0 overflow-hidden"
        onMouseDown={onMouseDown}
        style={{
          cursor: tool === 'hand' ? 'grab' : 'default',
          // CSS vars (defined in styles.css) flip per theme so the
          // checker pattern adapts to light mode without re-rendering.
          backgroundImage:
            'repeating-conic-gradient(var(--color-stage-checker-a) 0% 25%, var(--color-stage-checker-b) 0% 50%)',
          backgroundSize: '24px 24px',
        }}
      >
        <canvas ref={ref} style={canvasStyle} />
        <StageOverlay viewportRef={viewportRef} />
        <MotionPathOverlay viewportRef={viewportRef} />
        <PerfHud />
        {marquee && (
          <div
            className="absolute pointer-events-none border border-primary bg-primary/10 z-10"
            style={{
              left: Math.min(marquee.x0, marquee.x1),
              top: Math.min(marquee.y0, marquee.y1),
              width: Math.abs(marquee.x1 - marquee.x0),
              height: Math.abs(marquee.y1 - marquee.y0),
            }}
          />
        )}

        {!ready && !error && (
          <div className="absolute inset-0 grid place-items-center text-muted-foreground text-sm pointer-events-none">
            Initializing…
          </div>
        )}
        {error && (
          <div className="absolute inset-0 grid place-items-center text-destructive text-sm p-6 text-center pointer-events-none">
            {error}
          </div>
        )}

        {/* Stage view toggle — bottom-left, only when the source has a
            camera. 'Camera' renders through it (true framing); 'Flat'
            ignores it for orthographic, gizmo-correct editing (AE's
            Front view). Lens rule: preview-only, never serialized. */}
        {/* Bottom-left stack: stage-view toggle (top) + drill-down breadcrumbs (below). */}
        <div className="absolute bottom-3 left-3 z-10 flex flex-col gap-1 items-start">
        {source.camera && (
          <div className="flex items-center gap-0.5 bg-background/90 backdrop-blur-sm border border-border rounded-md p-0.5">
            {(['flat', 'camera'] as const).map((v) => (
              <button
                key={v}
                type="button"
                className={cn(
                  'h-6 px-2 rounded-sm text-[10px] font-medium capitalize transition-colors',
                  stageView === v
                    ? 'text-foreground bg-secondary'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60',
                )}
                onClick={() => setUiState({ stageView: v })}
                aria-pressed={stageView === v}
                title={
                  v === 'flat'
                    ? 'Flat view — ignore the camera (orthographic, for editing)'
                    : 'Camera view — render through the scene camera'
                }
              >
                {v}
              </button>
            ))}
          </div>
        )}
          <Breadcrumbs />
        </div>
        {/* Zoom controls — bottom-right of the viewport. Floating over
            content, so the shared flat cluster gets a minimal surface
            (panel background + hairline, no card). */}
        <div className="absolute bottom-3 right-3 bg-background/90 backdrop-blur-sm border border-border rounded-md px-0.5 py-0.5">
          <ZoomControl
            readout={`${Math.round(effectiveZoom * 100)}%`}
            onZoomOut={() => zoomBy(1 - ZOOM_STEP)}
            onZoomIn={() => zoomBy(1 + ZOOM_STEP)}
            onFit={fitToScreen}
            fitLabel="Fit to screen"
          />
        </div>
        {/* Add-element bar — left of the viewport. */}
        <AddElementBar />
      </div>

    </div>
  );
});

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

