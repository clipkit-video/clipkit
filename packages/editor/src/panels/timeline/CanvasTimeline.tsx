// Canvas timeline (EDITORS D9, hybrid — ruled by Ian 2026-06-12).
// A viewport-sized canvas PAINTS the scroll area (rows, ruler, clips,
// keyframe lanes, snap guide) offset by scroll; a second canvas paints
// the playhead on rAF; a virtualized DOM overlay places transparent
// hit-rects over only the on-screen clips/handles/diamonds for
// interaction + accessibility. Layout comes from timeline-layout.ts;
// the drag / snap / split math is transplanted from the DOM timeline
// (it operates on source-time + client-px, medium-independent).
//
// Why: the DOM timeline melts on big imports (≈800 layers → thousands
// of nodes, layout-thrash on zoom/scroll). Here the cost is O(visible
// rows), not O(project).

'use client';

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import type { Element, Keyframe, KeyframeAnimation } from '@clipkit/protocol';
import {
  buildSnapTargets,
  chooseTickInterval,
  computeSourceDuration,
  elementDuration,
  elementLabel,
  elementTime,
  elementLayer,
  formatTickLabel,
  resolveGroupPath,
  snapTo,
  useEditor,
  useEditorContext,
  useEditorStore,
} from '@clipkit/editor-core';
import { extractWaveformPeaks, type WaveformPeaks } from '@clipkit/playback';
import { chunkCaptionWords } from '@clipkit/runtime';
import { Lock, LockOpen } from 'lucide-react';
import { cn } from '../../lib/utils.js';
import { ungroupInElements } from '../../lib/ungroup.js';
import { groupElements } from '../../lib/group.js';
import { filmstripFrame } from './filmstrip.js';
import { KF_EPS, kfTime, toggleKeyframeAt } from '../../lib/keyframes.js';
import { PALETTE, FALLBACK_SWATCHES } from './Clip.js';
import {
  buildLayout,
  visibleLayerRange,
  HEADER_W,
  LANE_H,
  ROW_H,
  RULER_H,
  type ClipRect,
  type TimelineLayout,
} from './timeline-layout.js';

const MIN_DUR = 0.1;
const SNAP_PX = 6;
const HANDLE_W = 7;
// Drag auto-scroll: px band from a viewport edge that starts scrolling, and the
// per-frame speed cap (px). Speed ramps with how far the cursor is into the band.
const AUTOSCROLL_EDGE = 36;
const AUTOSCROLL_MAX = 18;
// Volume rubber-band ceiling. Like pro editors, unity (100% = 0 dB,
// the source level) is NOT the max — we allow boost above it (the
// runtime applies gain = volume/100 with no upper clamp). 200% ≈
// +6 dB. Unity sits mid-clip, leaving headroom above to boost.
const VOL_MAX = 200;

type DragMode = 'move' | 'trim-l' | 'trim-r' | 'keyframe';

interface DragState {
  mode: DragMode;
  id: string;
  startX: number;
  startY: number;
  origTime: number;
  origDur: number;
  origLayer: number;
  started: boolean;
  moving: Array<{ id: string; time: number; layer: number; dur: number }>;
  animIndex?: number;
  kfIndex?: number;
  origKfTime?: number;
}

interface MenuState {
  x: number;
  y: number;
  id: string;
}

/** Chrome colors pulled from the editor's CSS tokens (theme-aware). */
interface ChromePalette {
  bg: string;
  panel: string;
  border: string;
  borderFaint: string;
  text: string;
  muted: string;
  playhead: string;
  secondary: string;
}

function readChrome(el: HTMLElement): ChromePalette {
  const s = getComputedStyle(el);
  const v = (n: string, fallback: string): string =>
    s.getPropertyValue(n).trim() || fallback;
  return {
    bg: v('--color-background', '#141414'),
    panel: v('--color-card', '#181818'),
    border: v('--color-border', '#232323'),
    borderFaint: v('--color-border', '#232323'),
    text: v('--color-foreground', '#fafafa'),
    muted: v('--color-muted-foreground', '#8a8a8a'),
    playhead: v('--color-playhead', '#5c9be0'),
    secondary: v('--color-secondary', '#161616'),
  };
}

export function CanvasTimeline({
  pxPerSec,
  scrollRef,
  onScale,
}: {
  pxPerSec: number;
  scrollRef?: React.Ref<HTMLDivElement>;
  /** Set the timeline scale (px/s) — drives ctrl/⌘ + wheel zoom. */
  onScale?: (next: number) => void;
}) {
  const { engine, theme, store } = useEditorContext();
  const actions = useEditor();
  const source = useEditorStore((s) => s.source);
  const selection = useEditorStore((s) => s.selection);

  const [locked, setLocked] = useState<ReadonlySet<number>>(new Set());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [snapGuide, setSnapGuide] = useState<number | null>(null);
  // Live vertical-drag preview: a clip floats freely up/down (dyPx); the slot it
  // would drop into is shown as an insertion gap (see insertGap), committed only
  // on release.
  const [dragGhost, setDragGhost] = useState<{
    ids: ReadonlySet<string>;
    dyPx: number;
    /** Per-id ORIGINAL content-x (drag start) — the ghost stays pinned here. */
    originX: Record<string, number>;
  } | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  // Marquee (rubber-band) box-select over the clip area. The ORIGIN is stored in
  // content space (cx0/cy0 = absolute timeline px) and the live corner in viewport
  // space (vx/vy = container-relative px). Recomputing the box as `origin - scroll`
  // each render keeps it anchored to the content as the timeline scrolls.
  const [marquee, setMarquee] = useState<{ cx0: number; cy0: number; vx: number; vy: number } | null>(null);
  const [scroll, setScroll] = useState({ x: 0, y: 0 });
  // Live scroll for drag handlers (window listeners read the latest, not a stale closure).
  const scrollPosRef = useRef(scroll);
  scrollPosRef.current = scroll;
  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [peaksTick, setPeaksTick] = useState(0);
  const peaksRef = useRef<Map<string, WaveformPeaks>>(new Map());
  const peaksRequested = useRef<Set<string>>(new Set());

  // Group drill-down: when inside a group, the timeline lays out that group's
  // children (their times are local to the group). Edits still route through the
  // real source via id (updateElement/moveElements recurse into groups).
  const groupPath = useEditorStore((s) => s.ui.groupPath);
  const { elements: scopedElements, crumbs, timeOffset: groupOffset } = resolveGroupPath(source.elements, groupPath);
  const activeGroup = crumbs.at(-1) as (Element & { duration?: unknown; time?: unknown }) | undefined;
  // Absolute start of the entered group in real comp time — children's local
  // times sit at `groupOffset + childTime`. Playhead/seek/playback map through it.
  const scopedSource = useMemo(
    () => ({ ...source, elements: scopedElements, duration: activeGroup ? (activeGroup.duration ?? 'auto') : source.duration }) as typeof source,
    [source, scopedElements, activeGroup],
  );
  const duration = computeSourceDuration(scopedSource);
  // Live values for the rAF playhead loop + seek helper.
  const groupOffsetRef = useRef(groupOffset);
  groupOffsetRef.current = groupOffset;
  const groupDurRef = useRef(duration);
  groupDurRef.current = duration;
  const inGroup = groupPath.length > 0;
  const inGroupRef = useRef(inGroup);
  inGroupRef.current = inGroup;
  // Seek by LOCAL time (maps to real comp time when inside a group).
  const seekLocal = (localT: number): void => actions.seek(groupOffsetRef.current + Math.max(0, Math.min(groupDurRef.current, localT)));
  const layout = useMemo(
    () => buildLayout(scopedSource, duration, pxPerSec, expanded),
    [scopedSource, duration, pxPerSec, expanded],
  );

  // Enter a group → scope the timeline to it, flash it, and move the playhead to
  // the group's start (so playback is constrained to the group's window).
  const enterGroup = (g: Element): void => {
    if (g.type !== 'group' || typeof g.id !== 'string') return;
    const childStart = groupOffset + (typeof (g as { time?: unknown }).time === 'number' ? (g as { time: number }).time : 0);
    actions.setUiState({ groupPath: [...groupPath, g.id], groupFlashId: g.id });
    actions.setSelection([]);
    actions.seek(childStart);
  };

  const scrollElRef = useRef<HTMLDivElement | null>(null);
  const baseCanvasRef = useRef<HTMLCanvasElement>(null);
  const playheadCanvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const justDraggedRef = useRef(false);
  // Auto-scroll-while-dragging: last cursor (client px) + the rAF handle.
  const lastPointerRef = useRef({ x: 0, y: 0 });
  const autoScrollRef = useRef<number | null>(null);
  const chromeRef = useRef<ChromePalette | null>(null);

  const sourceRef = useRef(source);
  sourceRef.current = source;
  const latest = (): typeof source => sourceRef.current;

  const selSet = useMemo(() => new Set(selection), [selection]);

  // ── Insertion gap: while dragging a single clip vertically, an empty lane
  //    opens at the boundary the cursor's midpoint rule selects (above a row's
  //    vertical midpoint → slot above it; below → slot below it). `atY` is the
  //    content-y of the boundary (rows at/below shift down by `height`); `toLayer`
  //    is the reflow target committed on release. The gap snaps between boundaries
  //    as the cursor crosses midpoints and eases open/closed. ──
  const [insertGap, setInsertGap] = useState<
    { atY: number; height: number } | null
  >(null);
  const gapRef = useRef<
    { atY: number; toLayer: number; height: number; target: number } | null
  >(null);
  const gapRafRef = useRef<number | null>(null);

  const runGapAnim = (): void => {
    if (gapRafRef.current != null) return;
    const tick = (): void => {
      const g = gapRef.current;
      if (!g) { gapRafRef.current = null; return; }
      g.height += (g.target - g.height) * 0.3;
      const settled = Math.abs(g.target - g.height) < 0.5;
      if (settled) g.height = g.target;
      if (settled && g.target === 0) {
        gapRef.current = null; gapRafRef.current = null; setInsertGap(null); return;
      }
      setInsertGap({ atY: g.atY, height: g.height });
      gapRafRef.current = settled ? null : requestAnimationFrame(tick);
    };
    gapRafRef.current = requestAnimationFrame(tick);
  };
  // Open (or relocate) the gap at a boundary. atY/toLayer update immediately so
  // the gap snaps to the new slot; height eases toward a full row.
  const openGap = (atY: number, toLayer: number): void => {
    const cur = gapRef.current;
    gapRef.current = { atY, toLayer, height: cur?.height ?? 0, target: ROW_H };
    setInsertGap({ atY, height: gapRef.current.height });
    runGapAnim();
  };
  const closeGap = (): void => {
    if (gapRef.current) { gapRef.current.target = 0; runGapAnim(); }
  };
  // Cancel any pending rAF on unmount.
  useEffect(() => () => {
    if (gapRafRef.current != null) cancelAnimationFrame(gapRafRef.current);
    if (autoScrollRef.current != null) cancelAnimationFrame(autoScrollRef.current);
  }, []);

  // ── Viewport measurement ────────────────────────────────────────────
  const setScrollEl = (el: HTMLDivElement | null): void => {
    scrollElRef.current = el;
    if (typeof scrollRef === 'function') scrollRef(el);
    else if (scrollRef) (scrollRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
  };
  useEffect(() => {
    const el = scrollElRef.current;
    if (!el) return;
    const measure = (): void =>
      setViewport({ w: el.clientWidth, h: el.clientHeight });
    measure();
    chromeRef.current = readChrome(el);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Re-read chrome on theme change.
  useEffect(() => {
    if (scrollElRef.current) chromeRef.current = readChrome(scrollElRef.current);
    drawBase();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  // ── Ctrl/⌘ + wheel (and trackpad pinch) zoom, cursor-anchored ──────
  // Plain wheel still scrolls the layers; shift+wheel scrolls time
  // (both native). The zoom keeps the time under the cursor fixed by
  // adjusting scrollLeft after the new scale applies (layout effect).
  const pendingZoom = useRef<{ time: number; px: number } | null>(null);
  useEffect(() => {
    const el = scrollElRef.current;
    if (!el || !onScale) return;
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return; // plain wheel = scroll
      e.preventDefault();
      const px = e.clientX - el.getBoundingClientRect().left - HEADER_W;
      if (px < 0) return;
      pendingZoom.current = { time: (el.scrollLeft + px) / pxPerSec, px };
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      onScale(pxPerSec * factor);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onScale, pxPerSec]);

  // After a wheel-zoom rescales pxPerSec, pin the anchored time back
  // under the cursor.
  useLayoutEffect(() => {
    const pz = pendingZoom.current;
    const el = scrollElRef.current;
    if (!pz || !el) return;
    pendingZoom.current = null;
    el.scrollLeft = Math.max(0, pz.time * pxPerSec - pz.px);
  }, [pxPerSec]);

  // ── Base canvas paint ────────────────────────────────────────────────
  const drawBase = (): void => {
    const canvas = baseCanvasRef.current;
    const chrome = chromeRef.current;
    if (!canvas || !chrome || viewport.w === 0) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== viewport.w * dpr || canvas.height !== viewport.h * dpr) {
      canvas.width = viewport.w * dpr;
      canvas.height = viewport.h * dpr;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, viewport.w, viewport.h);
    ctx.font =
      '10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.textBaseline = 'middle';

    const sx = (cx: number): number => HEADER_W + cx - scroll.x;
    // syRaw = unshifted; sy adds the insertion gap so rows at/below the boundary
    // make room. The dragged clip + its ghost use syRaw (they float above the
    // reflow), everything else uses sy.
    const syRaw = (cy: number): number => RULER_H + cy - scroll.y;
    const gapY = insertGap?.atY ?? Infinity;
    const gapH = insertGap?.height ?? 0;
    const sy = (cy: number): number => syRaw(cy) + (cy >= gapY ? gapH : 0);
    const { start, end } = visibleLayerRange(layout.layers, scroll.y, viewport.h - RULER_H);

    // ── Content region (clipped so nothing paints under header/ruler) ──
    ctx.save();
    ctx.beginPath();
    ctx.rect(HEADER_W, RULER_H, viewport.w - HEADER_W, viewport.h - RULER_H);
    ctx.clip();

    for (let i = start; i < end; i++) {
      const row = layout.layers[i]!;
      const rowTop = sy(row.y);
      // Row separator — a soft mid-gray hairline. The old faint border
      // (dark gray @ 0.4) blended into the near-black bg; muted-foreground
      // reads clearly on both the dark and light timeline backgrounds.
      ctx.strokeStyle = chrome.muted;
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      ctx.moveTo(HEADER_W, rowTop + row.h - 0.5);
      ctx.lineTo(viewport.w, rowTop + row.h - 0.5);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Clips (only those on visible rows + horizontally in view).
    const visLayerNums = new Set(
      layout.layers.slice(start, end).map((l) => l.layer),
    );
    for (const clip of layout.clips) {
      if (!visLayerNums.has(clip.layer)) continue;
      const x = sx(clip.x);
      if (x + clip.w < HEADER_W || x > viewport.w) continue;
      if (dragGhost?.ids.has(clip.id)) continue; // dragged → drawn in the float pass below
      const url = getMediaUrl(clip.element);
      // Audio → waveform; video → filmstrip (frames drawn in drawClip
      // via the getFrame callback).
      const peaks = clip.element.type === 'audio' && url ? peaksRef.current.get(url) ?? null : null;
      drawClip(
        ctx,
        clip,
        x,
        sy(clip.y),
        selSet.has(clip.id),
        clip.id === hoveredId,
        theme,
        locked.has(clip.layer),
        peaks,
        pxPerSec,
        bumpMedia,
      );
    }

    // Keyframe lanes.
    for (const lane of layout.lanes) {
      const laneY = sy(lane.y);
      if (laneY + lane.h < RULER_H || laneY > viewport.h) continue;
      ctx.fillStyle = chrome.secondary;
      ctx.globalAlpha = 0.5;
      ctx.fillRect(HEADER_W, laneY, viewport.w - HEADER_W, lane.h);
      ctx.globalAlpha = 1;
      for (const kf of lane.keyframes) {
        const kx = sx(kf.x);
        if (kx < HEADER_W - 6 || kx > viewport.w + 6) continue;
        drawDiamond(ctx, kx, sy(kf.y), 4, chrome.playhead);
      }
    }

    // Snap guide.
    if (snapGuide !== null) {
      const gx = sx(snapGuide * pxPerSec);
      if (gx >= HEADER_W) {
        ctx.strokeStyle = chrome.playhead;
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        ctx.moveTo(gx, RULER_H);
        ctx.lineTo(gx, viewport.h);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // New-layer gap: an empty highlighted lane in the space the rows opened up.
    if (insertGap && insertGap.height > 0.5) {
      const gy = syRaw(insertGap.atY);
      const k = Math.min(1, insertGap.height / ROW_H);
      ctx.fillStyle = chrome.playhead;
      ctx.globalAlpha = 0.12 * k;
      ctx.fillRect(HEADER_W, gy, viewport.w - HEADER_W, insertGap.height);
      ctx.globalAlpha = 0.6 * k;
      ctx.strokeStyle = chrome.playhead;
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(HEADER_W, gy + 0.5);
      ctx.lineTo(viewport.w, gy + 0.5);
      ctx.moveTo(HEADER_W, gy + insertGap.height - 0.5);
      ctx.lineTo(viewport.w, gy + insertGap.height - 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // Dragged clip(s): a stripped ghost PINNED at the original position (it does
    // not move), plus the full-fidelity clip floating at the live cursor
    // position. Both use syRaw → they float ABOVE the gap reflow, no jump.
    if (dragGhost) {
      for (const clip of layout.clips) {
        if (!dragGhost.ids.has(clip.id)) continue;
        const rowY = syRaw(clip.y); // layer is unchanged mid-drag → origin lane
        // Ghost, pinned to where the clip started.
        drawClip(
          ctx, clip, sx(dragGhost.originX[clip.id] ?? clip.x), rowY,
          false, false, theme, false, null, pxPerSec, bumpMedia, true,
        );
        // Full clip, floating at the cursor.
        const url = getMediaUrl(clip.element);
        const peaks =
          clip.element.type === 'audio' && url ? peaksRef.current.get(url) ?? null : null;
        drawClip(
          ctx, clip, sx(clip.x), rowY + dragGhost.dyPx,
          true, false, theme, false, peaks, pxPerSec, bumpMedia, false,
        );
      }
    }
    ctx.restore();

    // ── Ruler (top strip, opaque over content) ──
    ctx.fillStyle = chrome.bg;
    ctx.fillRect(HEADER_W, 0, viewport.w - HEADER_W, RULER_H);
    ctx.strokeStyle = chrome.border;
    ctx.beginPath();
    ctx.moveTo(HEADER_W, RULER_H - 0.5);
    ctx.lineTo(viewport.w, RULER_H - 0.5);
    ctx.stroke();
    const { major, minor } = chooseTickInterval(pxPerSec);
    const lastTick = Math.max(0, Math.ceil(duration));
    const tickCount = Math.max(0, Math.ceil(lastTick / minor - 1e-6));
    ctx.save();
    ctx.beginPath();
    ctx.rect(HEADER_W, 0, viewport.w - HEADER_W, RULER_H);
    ctx.clip();
    for (let i = 0; i < tickCount; i++) {
      const t = i * minor;
      const x = sx(t * pxPerSec);
      if (x < HEADER_W - 1 || x > viewport.w) continue;
      const isMajor = i % 5 === 0;
      // muted-foreground reads on the dark ruler; border was too dark.
      ctx.strokeStyle = chrome.muted;
      ctx.globalAlpha = isMajor ? 0.7 : 0.4;
      ctx.beginPath();
      ctx.moveTo(x, isMajor ? 0 : RULER_H - 6);
      ctx.lineTo(x, RULER_H);
      ctx.stroke();
      ctx.globalAlpha = 1;
      if (isMajor) {
        ctx.fillStyle = chrome.muted;
        ctx.fillText(formatTickLabel(t, duration, major), x + 4, RULER_H / 2);
      }
    }
    ctx.restore();

    // ── Post-end zone: a diagonal-stripe band past where the source ends
    //    (the "video is over here" affordance, matching the old ruler).
    //    The end is rounded up to a whole second like the ticks. ──
    const endX = sx(lastTick * pxPerSec);
    const bandStart = Math.max(endX, HEADER_W);
    if (bandStart < viewport.w) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(bandStart, 0, viewport.w - bandStart, RULER_H);
      ctx.clip();
      // 45° hatch, ~4px stripe / ~4px gap (lineWidth 4, x-step ≈ 8/sin45°).
      ctx.strokeStyle = chrome.border;
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 4;
      ctx.beginPath();
      for (let x = bandStart - RULER_H; x < viewport.w; x += 11) {
        ctx.moveTo(x, RULER_H);
        ctx.lineTo(x + RULER_H, 0);
      }
      ctx.stroke();
      ctx.restore();
      // Crisp end-line marking where the content actually stops.
      if (endX >= HEADER_W && endX <= viewport.w) {
        ctx.strokeStyle = chrome.border;
        ctx.beginPath();
        ctx.moveTo(endX + 0.5, 0);
        ctx.lineTo(endX + 0.5, RULER_H);
        ctx.stroke();
      }
    }

    // ── Header column (left strip, opaque) ──
    ctx.fillStyle = chrome.bg;
    ctx.fillRect(0, 0, HEADER_W, viewport.h);
    ctx.strokeStyle = chrome.border;
    ctx.beginPath();
    ctx.moveTo(HEADER_W - 0.5, 0);
    ctx.lineTo(HEADER_W - 0.5, viewport.h);
    ctx.stroke();
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, RULER_H, HEADER_W, viewport.h - RULER_H);
    ctx.clip();
    for (let i = start; i < end; i++) {
      const row = layout.layers[i]!;
      const rowTop = sy(row.y);
      ctx.fillStyle = chrome.muted;
      const labelX = row.animId ? 30 : 22;
      ctx.fillText(`Layer ${row.layer}`, labelX, rowTop + ROW_H / 2);
    }
    ctx.restore();

    // Corner.
    ctx.fillStyle = chrome.bg;
    ctx.fillRect(0, 0, HEADER_W, RULER_H);
    ctx.strokeStyle = chrome.border;
    ctx.beginPath();
    ctx.moveTo(0, RULER_H - 0.5);
    ctx.lineTo(HEADER_W, RULER_H - 0.5);
    ctx.moveTo(HEADER_W - 0.5, 0);
    ctx.lineTo(HEADER_W - 0.5, RULER_H);
    ctx.stroke();
  };

  useEffect(drawBase, [layout, scroll, viewport, selSet, locked, snapGuide, theme, peaksTick, hoveredId, dragGhost, insertGap]);

  // Redraw when async media (waveforms / filmstrip frames) lands.
  const bumpMedia = (): void => setPeaksTick((t) => t + 1);

  // Lazily decode waveform peaks for visible AUDIO clips. Cached per
  // URL, so revisits are cheap.
  useEffect(() => {
    const { start, end } = visibleLayerRange(layout.layers, scroll.y, viewport.h - RULER_H);
    const visNums = new Set(layout.layers.slice(start, end).map((l) => l.layer));
    for (const clip of layout.clips) {
      if (!visNums.has(clip.layer) || clip.element.type !== 'audio') continue;
      const url = getMediaUrl(clip.element);
      if (!url || peaksRequested.current.has(url)) continue;
      peaksRequested.current.add(url);
      extractWaveformPeaks(url)
        .then((p) => {
          peaksRef.current.set(url, p);
          setPeaksTick((t) => t + 1);
        })
        .catch(() => {/* no decodable audio — clip stays plain */});
    }
  }, [layout, scroll.y, viewport.h]);

  // ── Playhead canvas (rAF) ────────────────────────────────────────────
  useEffect(() => {
    const canvas = playheadCanvasRef.current;
    if (!canvas || viewport.w === 0) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = viewport.w * dpr;
    canvas.height = viewport.h * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    let last = Number.NaN;
    const paint = (): void => {
      let t = engine?.currentTime ?? 0;
      // Constrain playback to the entered group's window — don't run past it.
      if (inGroupRef.current && engine?.playing) {
        const start = groupOffsetRef.current;
        const end = start + groupDurRef.current;
        if (t >= end - 1e-3) {
          const loop = store.getState().ui.loop;
          engine.seek(loop ? start : end);
          if (!loop) engine.pause();
          t = engine.currentTime;
        } else if (t < start) {
          engine.seek(start);
          t = engine.currentTime;
        }
      }
      const localT = inGroupRef.current ? t - groupOffsetRef.current : t;
      if (localT !== last) {
        last = localT;
        const chrome = chromeRef.current;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, viewport.w, viewport.h);
        const x = HEADER_W + localT * pxPerSec - scroll.x;
        if (x >= HEADER_W && x <= viewport.w && chrome) {
          ctx.strokeStyle = 'var(--color-destructive)';
          // destructive token doesn't resolve in canvas; use a literal red.
          ctx.strokeStyle = '#ef4444';
          ctx.fillStyle = '#ef4444';
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, viewport.h);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(x - 9, 0);
          ctx.lineTo(x + 9, 0);
          ctx.lineTo(x, 14);
          ctx.closePath();
          ctx.fill();
        }
      }
      raf = requestAnimationFrame(paint);
    };
    raf = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(raf);
  }, [engine, pxPerSec, scroll, viewport]);

  // ── Context-menu outside-close ──────────────────────────────────────
  useEffect(() => {
    if (!menu) return;
    const close = (): void => setMenu(null);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menu]);

  // ── Drag machinery (transplanted) ───────────────────────────────────
  const beginDrag = (
    e: ReactMouseEvent,
    el: Element,
    mode: DragMode,
    extra?: { animIndex: number; kfIndex: number; origKfTime: number },
  ): void => {
    if (e.button !== 0 || !el.id || locked.has(elementLayer(el))) return;
    e.preventDefault();
    e.stopPropagation();
    const id = el.id;
    if (e.shiftKey && mode === 'move') {
      const next = selection.includes(id)
        ? selection.filter((s) => s !== id)
        : [...selection, id];
      actions.setSelection(next);
      return;
    }
    const movingIds =
      mode === 'move' && selection.includes(id) && selection.length > 1
        ? selection
        : [id];
    if (!selection.includes(id)) actions.selectOne(id);

    const st0 = latest();
    const moving = movingIds
      .map((mid) => findById(st0.elements as readonly Element[], mid))
      .filter((m): m is Element => !!m && !!m.id)
      .map((m) => ({
        id: m.id!,
        time: elementTime(m),
        layer: elementLayer(m),
        dur: elementDuration(m, duration),
      }));

    dragRef.current = {
      mode,
      id,
      startX: e.clientX,
      startY: e.clientY,
      origTime: elementTime(el),
      origDur: elementDuration(el, duration),
      origLayer: elementLayer(el),
      started: false,
      moving,
      ...extra,
    };

    // The drag application, parameterized by pointer position so the auto-scroll
    // loop can re-run it at the last cursor while the view scrolls underneath.
    const applyDrag = (clientX: number, clientY: number): void => {
      const d = dragRef.current;
      if (!d) return;
      const dx = clientX - d.startX;
      const dy = clientY - d.startY;
      if (!d.started && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
      if (!d.started) {
        d.started = true;
        actions.pushHistory();
        actions.setInteractive(true);
        startAutoScroll();
      }
      const dt = dx / pxPerSec;
      const st = latest();
      const movingSet = new Set(d.moving.map((m) => m.id));
      const targets = buildSnapTargets(st, duration, movingSet, engine?.currentTime ?? 0);
      const thresholdSec = SNAP_PX / pxPerSec;

      if (d.mode === 'move') {
        const s1 = snapTo(d.origTime + dt, targets, thresholdSec);
        const s2 = snapTo(d.origTime + d.origDur + dt, targets, thresholdSec);
        let snappedDt = dt;
        let guide: number | null = null;
        if (s2.target !== null) {
          snappedDt = s2.value - (d.origTime + d.origDur);
          guide = s2.target;
        }
        if (s1.target !== null) {
          snappedDt = s1.value - d.origTime;
          guide = s1.target;
        }
        const minTime = Math.min(...d.moving.map((m) => m.time));
        snappedDt = Math.max(-minTime, snappedDt);
        setSnapGuide(guide);

        // Horizontal commits live (time + snapping, unchanged). The lane stays
        // put mid-drag so the clip never jumps layers; the vertical is a FREE
        // ghost that only settles into a layer on release (see onUp) — so up/down
        // floats with the cursor instead of snapping lane-to-lane.
        // Clipkit layers are compositing layers, not exclusive NLE lanes —
        // elements are meant to share the screen, so time-overlap on a layer is
        // legal. No collision block (that's what made dragging feel "stuck").
        const updates = d.moving.map((m) => ({
          id: m.id,
          patch: { time: round3(m.time + snappedDt) },
        }));
        actions.moveElements(updates, { skipHistory: true });

        // Single-clip vertical reorder: float the clip and open an insertion gap
        // at the boundary the cursor's midpoint rule selects. (Multi-select keeps
        // its lanes — no vertical reorder.)
        const sEl = scrollElRef.current;
        const rows = layout.layers;
        if (d.moving.length === 1 && Math.abs(dy) > 4) {
          // Original content-x per clip (drag-start times) — pins the ghost.
          const originX: Record<string, number> = {};
          for (const m of d.moving) originX[m.id] = m.time * pxPerSec;
          setDragGhost({ ids: movingSet, dyPx: dy, originX });

          // Insertion slot p ∈ [0, N] = number of rows whose vertical midpoint
          // sits above the cursor (p=0 → above the top row, p=N → below the last).
          let to: number | undefined;
          let atY = 0;
          if (sEl && rows.length >= 1) {
            const cy = clientY - sEl.getBoundingClientRect().top - RULER_H + sEl.scrollTop;
            let p = 0;
            for (const r of rows) if (cy >= r.y + r.h / 2) p++;
            const origPos = rows.findIndex((r) => r.layer === d.origLayer);
            // Reflow target: the row just below the gap when moving toward the
            // front, just above it when moving toward the back. The two slots
            // flanking the clip's own row resolve to origLayer → a no-op (no gap).
            const cand = p <= origPos ? rows[p]?.layer : rows[p - 1]?.layer;
            if (cand !== undefined && cand !== d.origLayer && !locked.has(cand)) {
              to = cand;
              atY = p < rows.length ? rows[p]!.y : layout.contentH;
            }
          }
          if (to !== undefined) openGap(atY, to);
          else if (gapRef.current) closeGap();
        } else {
          setDragGhost(null);
          if (gapRef.current) closeGap();
        }
      } else if (d.mode === 'trim-l') {
        const endT = d.origTime + d.origDur;
        const s = snapTo(d.origTime + dt, targets, thresholdSec);
        setSnapGuide(s.target);
        const t = Math.max(0, Math.min(endT - MIN_DUR, s.value));
        actions.moveElements(
          [{ id: d.id, patch: { time: round3(t), duration: round3(endT - t) } }],
          { skipHistory: true },
        );
      } else if (d.mode === 'trim-r') {
        const s = snapTo(d.origTime + d.origDur + dt, targets, thresholdSec);
        setSnapGuide(s.target);
        const endT = Math.max(d.origTime + MIN_DUR, s.value);
        actions.moveElements(
          [{ id: d.id, patch: { duration: round3(endT - d.origTime) } }],
          { skipHistory: true },
        );
      } else if (d.mode === 'keyframe' && d.animIndex !== undefined && d.kfIndex !== undefined) {
        const el2 = findById(st.elements as readonly Element[], d.id);
        const anims = el2?.keyframe_animations;
        if (!el2 || !anims) return;
        const nextT = Math.max(0, (d.origKfTime ?? 0) + dt);
        const nextAnims = anims.map((a: KeyframeAnimation, ai: number) =>
          ai !== d.animIndex
            ? a
            : {
                ...a,
                keyframes: a.keyframes.map((k: Keyframe, ki: number) =>
                  ki === d.kfIndex ? { ...k, time: round3(nextT) } : k,
                ),
              },
        );
        actions.moveElements(
          [{ id: d.id, patch: { keyframe_animations: nextAnims } }],
          { skipHistory: true },
        );
      }
    };

    // Edge auto-scroll: while a drag is active and the cursor sits in a band near
    // a viewport edge, scroll that way each frame and fold the delta into the drag
    // origin (startX/startY) so the floating clip stays under the cursor and the
    // committed time / drop slot follow the newly revealed content. Vertical only
    // applies to 'move' (reorder); horizontal applies to every mode.
    const startAutoScroll = (): void => {
      if (autoScrollRef.current != null) return;
      const spd = (pen: number): number => Math.min(AUTOSCROLL_MAX, 2 + pen * 0.3);
      const tick = (): void => {
        const d = dragRef.current;
        const sEl = scrollElRef.current;
        if (!d || !d.started || !sEl) { autoScrollRef.current = null; return; }
        const lp = lastPointerRef.current;
        const r = sEl.getBoundingClientRect();
        let vy = 0;
        if (d.mode === 'move') {
          const topZ = r.top + RULER_H + AUTOSCROLL_EDGE;
          const botZ = r.bottom - AUTOSCROLL_EDGE;
          if (lp.y < topZ) vy = -spd(topZ - lp.y);
          else if (lp.y > botZ) vy = spd(lp.y - botZ);
        }
        let vx = 0;
        const leftZ = r.left + HEADER_W + AUTOSCROLL_EDGE;
        const rightZ = r.right - AUTOSCROLL_EDGE;
        if (lp.x < leftZ) vx = -spd(leftZ - lp.x);
        else if (lp.x > rightZ) vx = spd(lp.x - rightZ);

        if (vy !== 0 || vx !== 0) {
          const beforeTop = sEl.scrollTop;
          const beforeLeft = sEl.scrollLeft;
          const nextTop = Math.max(0, Math.min(sEl.scrollHeight - sEl.clientHeight, beforeTop + vy));
          const nextLeft = Math.max(0, Math.min(sEl.scrollWidth - sEl.clientWidth, beforeLeft + vx));
          const ady = nextTop - beforeTop;
          const adx = nextLeft - beforeLeft;
          if (ady !== 0 || adx !== 0) {
            sEl.scrollTop = nextTop;
            sEl.scrollLeft = nextLeft;
            d.startY -= ady;
            d.startX -= adx;
            applyDrag(lp.x, lp.y);
          }
        }
        autoScrollRef.current = requestAnimationFrame(tick);
      };
      autoScrollRef.current = requestAnimationFrame(tick);
    };
    const stopAutoScroll = (): void => {
      if (autoScrollRef.current != null) {
        cancelAnimationFrame(autoScrollRef.current);
        autoScrollRef.current = null;
      }
    };

    const onMove = (ev: MouseEvent): void => {
      lastPointerRef.current = { x: ev.clientX, y: ev.clientY };
      applyDrag(ev.clientX, ev.clientY);
    };
    const onUp = (): void => {
      const d = dragRef.current;
      dragRef.current = null;
      justDraggedRef.current = d?.started === true;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      stopAutoScroll();
      setSnapGuide(null);
      setDragGhost(null);
      const gap = gapRef.current;
      gapRef.current = null;
      if (gapRafRef.current != null) { cancelAnimationFrame(gapRafRef.current); gapRafRef.current = null; }
      setInsertGap(null);
      if (d?.started) {
        // Vertical drag = reorder layers. The dragged element takes the slot the
        // insertion gap marks and every element it crossed shifts by one — so the
        // container stays uniquely + densely layered (layer 1 = front). No
        // collision, no "new lane" creation.
        if (d.mode === 'move') {
          const to = gap && gap.target > 0 ? gap.toLayer : undefined;
          if (to !== undefined && to !== d.origLayer) {
            const from = d.origLayer;
            const ups: Array<{ id: string; patch: Partial<Element> }> = [];
            for (const el of latest().elements as readonly Element[]) {
              if (!el.id || el.id === d.id || typeof el.layer !== 'number') continue;
              const l = el.layer;
              if (to < from) {
                if (l >= to && l < from) ups.push({ id: el.id, patch: { layer: l + 1 } });
              } else if (l > from && l <= to) {
                ups.push({ id: el.id, patch: { layer: l - 1 } });
              }
            }
            ups.push({ id: d.id, patch: { layer: to } });
            actions.moveElements(ups, { skipHistory: true });
          }
        }
        if (d.mode === 'keyframe' && d.animIndex !== undefined) {
          const st = latest();
          const el2 = findById(st.elements as readonly Element[], d.id);
          const anims = el2?.keyframe_animations;
          if (el2 && anims) {
            const nextAnims = anims.map((a: KeyframeAnimation, ai: number) =>
              ai !== d.animIndex ? a : { ...a, keyframes: [...a.keyframes].sort(byKfTime) },
            );
            actions.moveElements(
              [{ id: d.id, patch: { keyframe_animations: nextAnims } }],
              { skipHistory: true },
            );
          }
        }
        actions.flushPendingSource();
        actions.setInteractive(false);
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Fade-handle drag — writes audio_fade_in / audio_fade_out (literal
  // seconds), one undo step per gesture. Dragging the in-dot right (or
  // the out-dot left) lengthens the fade; clamped to [0, clip dur].
  const beginFadeDrag = (e: ReactMouseEvent, el: Element, side: 'in' | 'out'): void => {
    if (e.button !== 0 || !el.id || locked.has(elementLayer(el))) return;
    e.preventDefault();
    e.stopPropagation();
    const id = el.id;
    if (!selection.includes(id)) actions.selectOne(id);
    const dur = elementDuration(el, duration);
    const field = side === 'in' ? 'audio_fade_in' : 'audio_fade_out';
    const orig = num((el as Record<string, unknown>)[field]);
    const startX = e.clientX;
    let started = false;
    const onMove = (ev: MouseEvent): void => {
      const dx = ev.clientX - startX;
      if (!started && Math.abs(dx) < 3) return;
      if (!started) {
        started = true;
        actions.pushHistory();
        actions.setInteractive(true);
      }
      const dSec = (side === 'in' ? dx : -dx) / pxPerSec;
      const next = Math.max(0, Math.min(dur, round3(orig + dSec)));
      actions.moveElements([{ id, patch: { [field]: next } }], { skipHistory: true });
    };
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      justDraggedRef.current = started;
      if (started) {
        actions.flushPendingSource();
        actions.setInteractive(false);
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Volume rubber-band drag — vertical, writes the static `volume`
  // (percent), one undo step. A full clip-height drag spans 0..100.
  const beginVolumeDrag = (e: ReactMouseEvent, el: Element, clipH: number): void => {
    if (e.button !== 0 || !el.id || locked.has(elementLayer(el))) return;
    if (Array.isArray((el as { volume?: unknown }).volume)) return; // animated → inspector
    e.preventDefault();
    e.stopPropagation();
    const id = el.id;
    if (!selection.includes(id)) actions.selectOne(id);
    const orig = typeof (el as { volume?: unknown }).volume === 'number'
      ? (el as { volume: number }).volume
      : 100;
    const startY = e.clientY;
    let started = false;
    const onMove = (ev: MouseEvent): void => {
      const dy = ev.clientY - startY;
      if (!started && Math.abs(dy) < 3) return;
      if (!started) {
        started = true;
        actions.pushHistory();
        actions.setInteractive(true);
      }
      const next = Math.max(0, Math.min(VOL_MAX, Math.round(orig - (dy / clipH) * VOL_MAX)));
      actions.moveElements([{ id, patch: { volume: next } }], { skipHistory: true });
    };
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      justDraggedRef.current = started;
      if (started) {
        actions.flushPendingSource();
        actions.setInteractive(false);
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const menuActions = (id: string) => {
    const st = latest();
    const el = findById(st.elements as readonly Element[], id);
    const playhead = engine?.currentTime ?? 0;
    const canSplit =
      !!el &&
      !(el as { time_remap?: unknown }).time_remap &&
      playhead > elementTime(el) + 0.05 &&
      playhead < elementTime(el) + elementDuration(el, duration) - 0.05;
    return {
      canSplit,
      split: () => {
        if (!el || !canSplit) return;
        const parts = splitElement(el, playhead, duration);
        if (!parts) return;
        const next: Element[] = [];
        for (const e2 of st.elements) {
          if (e2 === el) next.push(parts[0], parts[1]);
          else next.push(e2 as Element);
        }
        actions.patchSource({ elements: next });
        actions.selectOne(parts[1].id!);
      },
      duplicate: () => {
        if (!el) return;
        const start = elementTime(el);
        const dur = elementDuration(el, duration);
        const copy = {
          ...el,
          id: `${el.id}-copy-${Date.now().toString(36).slice(-4)}`,
          time: round3(start + dur),
        } as Element;
        actions.addElement(copy);
      },
      remove: () => actions.removeElement(id),
      isGroup: el?.type === 'group',
      enter: () => { if (el) enterGroup(el); },
      ungroup: () => {
        if (!el || el.type !== 'group' || typeof el.id !== 'string') return;
        const r = ungroupInElements(st.elements as Element[], el.id);
        if (!r) return;
        actions.patchSource({ elements: r.elements });
        actions.setSelection(r.liftedIds);
      },
      canGroup: selection.length >= 2 && typeof el?.id === 'string' && selection.includes(el.id),
      group: () => {
        const r = groupElements(st.elements as Element[], selection, `group-${Date.now().toString(36).slice(-5)}`);
        if (!r) return;
        actions.patchSource({ elements: r.elements });
        actions.selectOne(r.groupId);
      },
    };
  };

  // ── DOM overlay positions ───────────────────────────────────────────
  const sx = (cx: number): number => HEADER_W + cx - scroll.x;
  const sy = (cy: number): number => RULER_H + cy - scroll.y;

  // Marquee box-select: drag a rectangle over empty clip area to select every
  // intersecting clip. Coords are relative to the content-clip container (so
  // they match clip rects, which are at clip.x - scroll.x / clip.y - scroll.y).
  const beginMarquee = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    const base = additive ? selection : [];
    const vx0 = e.clientX - rect.left;
    const vy0 = e.clientY - rect.top;
    // Origin in CONTENT space so it stays put as the timeline scrolls under it.
    const s0 = scrollPosRef.current;
    const cx0 = vx0 + s0.x;
    const cy0 = vy0 + s0.y;
    setMarquee({ cx0, cy0, vx: vx0, vy: vy0 });
    let moved = false;
    const onMove = (ev: MouseEvent): void => {
      const vx = ev.clientX - rect.left;
      const vy = ev.clientY - rect.top;
      const s = scrollPosRef.current;
      if (Math.abs(vx + s.x - cx0) > 3 || Math.abs(vy + s.y - cy0) > 3) moved = true;
      setMarquee({ cx0, cy0, vx, vy });
    };
    const onUp = (ev: MouseEvent): void => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setMarquee(null);
      if (!moved) {
        if (!additive) actions.setSelection([]); // plain click on empty = clear
        return;
      }
      const s = scrollPosRef.current;
      // Both corners in content space → hit-test is scroll-independent.
      const cx1 = ev.clientX - rect.left + s.x;
      const cy1 = ev.clientY - rect.top + s.y;
      const ml = Math.min(cx0, cx1), mr = Math.max(cx0, cx1), mt = Math.min(cy0, cy1), mb = Math.max(cy0, cy1);
      const hits = layout.clips
        .filter((c) => c.x < mr && c.x + c.w > ml && c.y < mb && c.y + c.h > mt)
        .map((c) => c.id);
      actions.setSelection(additive ? [...new Set([...base, ...hits])] : hits);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  const { start, end } = visibleLayerRange(layout.layers, scroll.y, viewport.h - RULER_H);
  const visLayers = layout.layers.slice(start, end);
  const visLayerNums = new Set(visLayers.map((l) => l.layer));
  const visClips = layout.clips.filter((c) => {
    if (!visLayerNums.has(c.layer)) return false;
    const x = sx(c.x);
    return x + c.w >= HEADER_W && x <= viewport.w;
  });
  const visLanes = layout.lanes.filter((l) => {
    const y = sy(l.y);
    return y + l.h >= RULER_H && y <= viewport.h;
  });

  return (
    <div
      ref={setScrollEl}
      className="flex-1 min-h-0 overflow-auto relative"
      onScroll={(e) =>
        setScroll({ x: e.currentTarget.scrollLeft, y: e.currentTarget.scrollTop })
      }
    >
      {/* Scroll sizer → native scrollbars. */}
      <div
        style={{
          width: HEADER_W + layout.contentW,
          height: RULER_H + layout.contentH,
        }}
      >
        {/* Viewport-pinned anchor (sticky 0×0); children overflow it. */}
        <div className="sticky top-0 left-0 w-0 h-0 z-0">
          <canvas
            ref={baseCanvasRef}
            className="absolute top-0 left-0 pointer-events-none"
            style={{ width: viewport.w, height: viewport.h }}
          />
          <canvas
            ref={playheadCanvasRef}
            className="absolute top-0 left-0 pointer-events-none"
            style={{ width: viewport.w, height: viewport.h }}
          />
          {/* Interaction overlay — pointer-events only on children. */}
          <div
            className="absolute top-0 left-0 pointer-events-none"
            style={{ width: viewport.w, height: viewport.h }}
          >
            {/* Ruler seek strip. */}
            <div
              className="absolute pointer-events-auto cursor-pointer"
              aria-label="Seek timeline"
              style={{ left: HEADER_W, top: 0, width: Math.max(0, viewport.w - HEADER_W), height: RULER_H }}
              onMouseDown={(e) => {
                const t = (e.clientX - e.currentTarget.getBoundingClientRect().left + scroll.x) / pxPerSec;
                seekLocal(t);
              }}
            />

            {/* Header-clip: row buttons + lane navs, masked to the
                header column (below the ruler) so a row scrolled up
                can't float its controls into the ruler/corner. */}
            <div
              className="absolute overflow-hidden pointer-events-none"
              style={{ left: 0, top: RULER_H, width: HEADER_W, height: Math.max(0, viewport.h - RULER_H) }}
            >
            {/* Header overlay: lock + expand chevron + lane labels. */}
            {visLayers.map((row) => {
              const top = row.y - scroll.y;
              return (
                <div key={`h-${row.layer}`}>
                  {row.animId && (
                    <button
                      type="button"
                      className="absolute pointer-events-auto grid place-items-center text-muted-foreground hover:text-foreground"
                      style={{ left: 6, top: top + ROW_H / 2 - 8, width: 16, height: 16 }}
                      title={row.expandedId ? 'Collapse keyframe tracks' : 'Expand keyframe tracks'}
                      aria-label={row.expandedId ? 'Collapse keyframe tracks' : 'Expand keyframe tracks'}
                      aria-expanded={!!row.expandedId}
                      onClick={() =>
                        setExpanded((prev) => {
                          const n = new Set(prev);
                          const id = row.expandedId ?? row.animId!;
                          if (n.has(id)) n.delete(id);
                          else n.add(id);
                          return n;
                        })
                      }
                    >
                      <svg width="6" height="6" viewBox="0 0 8 8" aria-hidden="true"
                        className={cn('transition-transform', row.expandedId && 'rotate-90')}>
                        <path d="M2 1 L6 4 L2 7 Z" fill="currentColor" />
                      </svg>
                    </button>
                  )}
                  <button
                    type="button"
                    className={cn(
                      'absolute pointer-events-auto grid place-items-center',
                      locked.has(row.layer) ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                    )}
                    style={{ left: HEADER_W - 22, top: top + ROW_H / 2 - 8, width: 16, height: 16 }}
                    title={locked.has(row.layer) ? 'Unlock layer' : 'Lock layer'}
                    aria-label={locked.has(row.layer) ? 'Unlock layer' : 'Lock layer'}
                    aria-pressed={locked.has(row.layer)}
                    onClick={() =>
                      setLocked((prev) => {
                        const n = new Set(prev);
                        if (n.has(row.layer)) n.delete(row.layer);
                        else n.add(row.layer);
                        return n;
                      })
                    }
                  >
                    {locked.has(row.layer) ? <Lock size={11} /> : <LockOpen size={11} />}
                  </button>
                </div>
              );
            })}

            {/* Lane header rows: property label (opens curve) + the
                ◀ ◆ ▶ prev / toggle-at-playhead / next cluster. */}
            {visLanes.map((lane) => (
              <LaneNav
                key={`ln-${lane.elementId}-${lane.property}`}
                elementId={lane.elementId}
                property={lane.property}
                animIndex={lane.animIndex}
                top={lane.y - scroll.y}
                height={lane.h}
              />
            ))}
            </div>

            {/* Content-clip: clips / volume / fades / keyframes. Clipped
                to the content rect so a clip scrolled up under the
                ruler (or left under the header) can't steal those
                clicks — its hit-rect is masked there. */}
            <div
              className="absolute overflow-hidden pointer-events-none"
              style={{
                left: HEADER_W,
                top: RULER_H,
                width: Math.max(0, viewport.w - HEADER_W),
                height: Math.max(0, viewport.h - RULER_H),
              }}
            >
            {/* Marquee box-select: capture layer (behind clips, so a clip still
                wins its own click) + the drawn rectangle (above, zIndex). */}
            <div className="absolute inset-0 pointer-events-auto" onMouseDown={beginMarquee} />
            {marquee && (() => {
              // Origin back into viewport space at the CURRENT scroll, so the box
              // grows/shrinks correctly while the timeline scrolls.
              const ox = marquee.cx0 - scroll.x;
              const oy = marquee.cy0 - scroll.y;
              return (
                <div
                  className="absolute pointer-events-none border border-primary bg-primary/10"
                  style={{
                    left: Math.min(ox, marquee.vx),
                    top: Math.min(oy, marquee.vy),
                    width: Math.abs(marquee.vx - ox),
                    height: Math.abs(marquee.vy - oy),
                    zIndex: 50,
                  }}
                />
              );
            })()}
            {/* Clip hit-rects (move + trim handles + context menu). */}
            {visClips.map((clip) => {
              const left = clip.x - scroll.x;
              const top = clip.y - scroll.y;
              const isLocked = locked.has(clip.layer);
              return (
                <div
                  key={clip.id}
                  className="absolute pointer-events-auto"
                  style={{
                    left,
                    top,
                    width: clip.w,
                    height: clip.h,
                    cursor: isLocked ? 'not-allowed' : 'grab',
                  }}
                  onMouseDown={(e) => beginDrag(e, clip.element, 'move')}
                  onDoubleClick={(e) => {
                    if (clip.element.type === "group") { e.stopPropagation(); enterGroup(clip.element); }
                  }}
                  onMouseEnter={() => setHoveredId(clip.id)}
                  onMouseLeave={() => setHoveredId((h) => (h === clip.id ? null : h))}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    if (!selection.includes(clip.id)) actions.selectOne(clip.id);
                    setMenu({ x: e.clientX, y: e.clientY, id: clip.id });
                  }}
                  title={elementLabel(clip.element)}
                  aria-label={elementLabel(clip.element)}
                >
                  {!isLocked && clip.w > HANDLE_W * 2 + 8 && (
                    <>
                      <div
                        className="absolute top-0 bottom-0 left-0 cursor-ew-resize"
                        style={{ width: HANDLE_W }}
                        onMouseDown={(e) => beginDrag(e, clip.element, 'trim-l')}
                      />
                      <div
                        className="absolute top-0 bottom-0 right-0 cursor-ew-resize"
                        style={{ width: HANDLE_W }}
                        onMouseDown={(e) => beginDrag(e, clip.element, 'trim-r')}
                      />
                    </>
                  )}
                </div>
              );
            })}

            {/* Volume rubber-band hit strips (audio/video, static
                volume). On top of the move zone along the line; below
                the fade dots so corners stay fades. */}
            {visClips.flatMap((clip) => {
              if (clip.element.type !== 'audio') return [];
              if (locked.has(clip.layer)) return [];
              const vol = (clip.element as { volume?: unknown }).volume;
              if (Array.isArray(vol)) return [];
              const v = typeof vol === 'number' ? vol : 100;
              const ly = (clip.y - scroll.y) + (1 - Math.min(1, Math.max(0, v / VOL_MAX))) * clip.h;
              const left = clip.x - scroll.x;
              return [
                <div
                  key={`vol-${clip.id}`}
                  className="absolute pointer-events-auto cursor-ns-resize"
                  style={{ left: left + 12, top: ly - 6, width: Math.max(0, clip.w - 24), height: 13 }}
                  title={`Volume ${v}% — drag up/down`}
                  aria-label="Volume line"
                  onMouseDown={(ev) => beginVolumeDrag(ev, clip.element, clip.h)}
                  onMouseEnter={() => setHoveredId(clip.id)}
                />,
              ];
            })}

            {/* Fade-handle hit targets (audio/video). Rendered AFTER
                the clip hit-rects so the top-corner dot wins over the
                trim edge there; the rest of the edge stays trim. */}
            {visClips.flatMap((clip) => {
              if (clip.element.type !== 'audio') return [];
              if (locked.has(clip.layer)) return [];
              const el = clip.element as Record<string, unknown>;
              const fin = num(el.audio_fade_in);
              const fout = num(el.audio_fade_out);
              const top = clip.y - scroll.y;
              const inX = clip.x + fin * pxPerSec - scroll.x;
              const outX = clip.x + clip.w - fout * pxPerSec - scroll.x;
              const dot = (key: string, cx: number, side: 'in' | 'out') => (
                <div
                  key={key}
                  className="absolute pointer-events-auto cursor-grab"
                  style={{ left: cx - 7, top: top - 3, width: 14, height: 14 }}
                  title={`Fade ${side === 'in' ? 'in' : 'out'} — drag to adjust`}
                  aria-label={`Fade ${side} handle`}
                  onMouseDown={(ev) => beginFadeDrag(ev, clip.element, side)}
                  onMouseEnter={() => setHoveredId(clip.id)}
                />
              );
              return [
                dot(`fi-${clip.id}`, inX, 'in'),
                dot(`fo-${clip.id}`, outX, 'out'),
              ];
            })}

            {/* Keyframe diamond hit-targets. */}
            {visLanes.flatMap((lane) =>
              lane.keyframes.map((kf) => {
                const left = kf.x - scroll.x;
                if (left < -6 || left > viewport.w - HEADER_W + 6) return null;
                const el = findById(layout.clips.map((c) => c.element), lane.elementId);
                return (
                  <div
                    key={`kf-${lane.elementId}-${lane.property}-${kf.kfIndex}`}
                    className="absolute pointer-events-auto cursor-ew-resize"
                    style={{ left: left - 6, top: (kf.y - scroll.y) - 6, width: 12, height: 12 }}
                    title="Drag to retime · click to edit interpolation"
                    aria-label={`Keyframe ${lane.property} @ ${kf.time}s`}
                    onMouseDown={(e) => {
                      if (!el) return;
                      beginDrag(e, el, 'keyframe', {
                        animIndex: kf.animIndex,
                        kfIndex: kf.kfIndex,
                        origKfTime: kf.time,
                      });
                    }}
                    onClick={() => {
                      if (justDraggedRef.current || !el) return;
                      seekLocal(elementTime(el) + kf.time);
                      actions.setUiState({ curveTarget: { elementId: lane.elementId, property: lane.property } });
                    }}
                  />
                );
              }),
            )}
            </div>
          </div>
        </div>
      </div>

      {menu && (
        <ClipMenu menu={menu} actions={menuActions(menu.id)} close={() => setMenu(null)} />
      )}
    </div>
  );
}

// ── Canvas draw helpers ───────────────────────────────────────────────

const HANDLE_HIT = 14;

function drawClip(
  ctx: CanvasRenderingContext2D,
  clip: ClipRect,
  x: number,
  y: number,
  selected: boolean,
  hovered: boolean,
  theme: 'light' | 'dark',
  isLocked: boolean,
  peaks: WaveformPeaks | null,
  pxPerSec: number,
  onMedia: () => void,
  ghost = false,
): void {
  const el = clip.element;
  const sw = (PALETTE[el.type] ?? FALLBACK_SWATCHES)[theme];
  const w = clip.w;
  const h = clip.h;
  if (ghost) {
    // Origin placeholder while dragging: outline + fill color only, faded —
    // no waveform / filmstrip / icon / label (those ride the floating clip).
    ctx.globalAlpha = 0.4;
    roundRect(ctx, x, y, w, h, 6);
    ctx.fillStyle = sw.bg;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = sw.border;
    ctx.stroke();
    ctx.globalAlpha = 1;
    return;
  }
  ctx.globalAlpha = isLocked ? 0.5 : hovered && !selected ? 0.92 : 1;
  roundRect(ctx, x, y, w, h, 6);
  ctx.fillStyle = sw.bg;
  ctx.fill();

  ctx.save();
  roundRect(ctx, x, y, w, h, 6);
  ctx.clip();

  // Filmstrip (video) — frames tiled across the body, sampled in the
  // browser (no backend). trim_start + playback_rate map clip-local
  // time → media time.
  if (el.type === 'video') {
    const url = getMediaUrl(el);
    if (url) {
      const trimStart = num((el as { trim_start?: unknown }).trim_start);
      const rate = num((el as { playback_rate?: unknown }).playback_rate) || 1;
      const tileW = Math.max(40, Math.round(h * (16 / 9)));
      for (let tx = 0; tx < w; tx += tileW) {
        const localSec = (tx + tileW / 2) / pxPerSec;
        const mediaTime = trimStart + localSec * rate;
        const frame = filmstripFrame(url, mediaTime, h, onMedia);
        if (frame) {
          const drawW = Math.min(tileW, w - tx);
          // Cover-crop the frame to the tile.
          const fAspect = frame.width / frame.height;
          const sw2 = Math.min(frame.width, drawW / tileW * frame.height * fAspect);
          ctx.drawImage(frame, 0, 0, sw2, frame.height, x + tx, y, drawW, h);
        }
      }
      // Subtle separators between frames.
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth = 1;
      for (let tx = tileW; tx < w; tx += tileW) {
        ctx.beginPath();
        ctx.moveTo(x + tx, y);
        ctx.lineTo(x + tx, y + h);
        ctx.stroke();
      }
    }
  }

  // Waveform (audio) — accent-tinted min/max bars, lower 2/3.
  if (peaks) {
    const trimStart =
      typeof (el as { trim_start?: unknown }).trim_start === 'number'
        ? (el as { trim_start: number }).trim_start
        : 0;
    drawWaveform(ctx, peaks, trimStart, clip.dur, x, y + h / 3, w, (h * 2) / 3, withAlpha(sw.selectedBorder, 0.5));
  }

  // Caption chunks — the windowed segments (one block per chunk, derived from
  // `max_length` via the SAME function the renderer uses, so they match). Falls
  // back to per-word ticks when there's no windowing (one chunk).
  if (el.type === 'caption' && Array.isArray(el.words)) {
    const win = Math.max(clip.dur, 0.001);
    const chunks = chunkCaptionWords(el.words as Array<{ text: string; start: number; end: number }>, (el as { max_length?: number | 'auto' }).max_length);
    if (chunks.length > 1) {
      for (const c of chunks) {
        const cx = x + 3 + (c.start / win) * (w - 6);
        const cw = Math.max(3, ((c.end - c.start) / win) * (w - 6) - 2);
        ctx.fillStyle = withAlpha(sw.selectedBorder, 0.3);
        roundRect(ctx, cx, y + 4, cw, h - 8, 2);
        ctx.fill();
      }
    } else {
      ctx.fillStyle = withAlpha(sw.selectedBorder, 0.55);
      for (const word of el.words as Array<{ start: number; end: number }>) {
        const wx = x + 4 + (word.start / win) * (w - 8);
        const ww = Math.max(1, ((word.end - word.start) / win) * (w - 8) - 1);
        ctx.fillRect(wx, y + h - 6, ww, 3);
      }
    }
  }

  // Volume rubber-band — AUDIO only (video shows a filmstrip; stacking
  // the gain line over it cramps both — ruled by Ian 2026-06-12; video
  // audio still adjusts in the inspector). Static numeric volume only.
  if (el.type === 'audio') {
    const vol = (el as { volume?: unknown }).volume;
    if (typeof vol === 'number' || vol === undefined) {
      const v = typeof vol === 'number' ? vol : 100;
      const ly = y + (1 - Math.min(1, Math.max(0, v / VOL_MAX))) * h;
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, ly);
      ctx.lineTo(x + w, ly);
      ctx.stroke();
      if (hovered || selected) {
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.beginPath();
        ctx.arc(x + w / 2, ly, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Type icon (accent) + label. A 16px left inset clears the resize-
  // handle zone (bars live at x+4…x+10) so the icon never overlaps it.
  const inset = x + 16;
  let labelX = inset;
  if (w > 52) {
    drawTypeIcon(ctx, el.type, inset, y + h / 2 - 7, sw.selectedBorder);
    labelX = inset + 22;
  }
  ctx.fillStyle = sw.text;
  ctx.fillText(elementLabel(el), labelX, y + h / 2);
  ctx.restore();

  // Border (over the fill/waveform).
  roundRect(ctx, x, y, w, h, 6);
  ctx.lineWidth = selected ? 2 : 1.5;
  ctx.strokeStyle = selected ? sw.selectedBorder : sw.border;
  ctx.stroke();

  // Resize handles — double bars at each edge, on hover/selection.
  // NON-AUDIO only (ruled by Ian 2026-06-12): audio reserves its
  // corners for the fade grab-dots, so it stays cursor-only trim.
  if (el.type !== 'audio' && (selected || hovered) && !isLocked && w > HANDLE_HIT * 2 + 8) {
    drawHandle(ctx, x + 4, y + h / 2, sw.selectedBorder);
    drawHandle(ctx, x + w - 10, y + h / 2, sw.selectedBorder);
  }

  // Fade tapers + grab dots — AUDIO only (same reason as the gain
  // line). Taper draws when a fade is set; dots on hover/selection.
  if (el.type === 'audio') {
    const fin = num((el as { audio_fade_in?: unknown }).audio_fade_in);
    const fout = num((el as { audio_fade_out?: unknown }).audio_fade_out);
    const finPx = Math.min(w, fin * pxPerSec);
    const foutPx = Math.min(w, fout * pxPerSec);
    ctx.strokeStyle = sw.selectedBorder;
    ctx.lineWidth = 1.5;
    if (fin > 0) {
      ctx.beginPath();
      ctx.moveTo(x, y + h);
      ctx.lineTo(x + finPx, y);
      ctx.stroke();
    }
    if (fout > 0) {
      ctx.beginPath();
      ctx.moveTo(x + w - foutPx, y);
      ctx.lineTo(x + w, y + h);
      ctx.stroke();
    }
    if ((hovered || selected) && !isLocked) {
      fadeDot(ctx, x + finPx, y, sw.selectedBorder);
      fadeDot(ctx, x + w - foutPx, y, sw.selectedBorder);
    }
  }
  ctx.globalAlpha = 1;
}

/** Two thin vertical accent bars — the legacy resize-handle look. */
function drawHandle(ctx: CanvasRenderingContext2D, x: number, cy: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, cy - 6, 2, 12);
  ctx.fillRect(x + 4, cy - 6, 2, 12);
}

/** A grab dot on the fade line — accent fill, white ring. */
function fadeDot(ctx: CanvasRenderingContext2D, cx: number, cy: number, color: string): void {
  ctx.beginPath();
  ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#fff';
  ctx.stroke();
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Per-type icon (stroke paths from Clip.tsx) at a 14px box from
 * (ix, iy), in the accent color. */
function drawTypeIcon(
  ctx: CanvasRenderingContext2D,
  type: Element['type'],
  ix: number,
  iy: number,
  color: string,
): void {
  ctx.save();
  ctx.translate(ix, iy);
  ctx.scale(14 / 16, 14 / 16);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const stroke = (d: string): void => ctx.stroke(new Path2D(d));
  const rr = (rx: number, ry: number, rw: number, rh: number, r: number): void => {
    const p = new Path2D();
    p.roundRect(rx, ry, rw, rh, r);
    ctx.stroke(p);
  };
  switch (type) {
    case 'video':
      rr(2, 4, 9, 8, 1.5);
      stroke('M11 6 L14 4 V12 L11 10 Z');
      break;
    case 'audio':
      stroke('M3 7 V9 M5.5 5 V11 M8 3 V13 M10.5 5 V11 M13 7 V9');
      break;
    case 'shape':
    case 'particles':
      rr(2.5, 2.5, 11, 11, 2);
      break;
    case 'image': {
      rr(2, 3, 12, 10, 1.5);
      ctx.beginPath();
      ctx.arc(6, 6.5, 1.2, 0, Math.PI * 2);
      ctx.fill();
      stroke('M2.5 11.5 L6 8 L9 11 L11.5 9 L13.5 11');
      break;
    }
    case 'caption':
      rr(2, 3.5, 12, 9, 1.5);
      stroke('M4.5 8.5 H7 M9 8.5 H11.5 M4.5 10.5 H6 M8 10.5 H11.5');
      break;
    case 'group':
      stroke('M8 2 L14 5 L8 8 L2 5 Z M2 8 L8 11 L14 8 M2 11 L8 14 L14 11');
      break;
    default: // text
      stroke('M3 4 H13 M8 4 V13');
  }
  ctx.restore();
}

/** Min/max peak bars (mirrors Waveform.tsx) into [x, x+w] × [y, y+h]. */
function drawWaveform(
  ctx: CanvasRenderingContext2D,
  wf: WaveformPeaks,
  trimStart: number,
  windowSec: number,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
): void {
  if (windowSec <= 0 || w <= 0) return;
  const startBucket = trimStart * wf.peaksPerSecond;
  const bucketsPerPx = (windowSec * wf.peaksPerSecond) / w;
  const mid = y + h / 2;
  const total = wf.peaks.length / 2;
  ctx.fillStyle = color;
  for (let px = 0; px < w; px++) {
    const b0 = Math.floor(startBucket + px * bucketsPerPx);
    const b1 = Math.max(b0 + 1, Math.floor(startBucket + (px + 1) * bucketsPerPx));
    let mn = 0;
    let mx = 0;
    for (let b = b0; b < b1 && b < total; b++) {
      if (b < 0) continue;
      mn = Math.min(mn, wf.peaks[b * 2]!);
      mx = Math.max(mx, wf.peaks[b * 2 + 1]!);
    }
    const y0 = mid - mx * (h / 2 - 1);
    const y1 = mid - mn * (h / 2 - 1);
    ctx.fillRect(x + px, y0, 1, Math.max(1, y1 - y0));
  }
}

function getMediaUrl(el: Element): string | null {
  return (el.type === 'audio' || el.type === 'video') &&
    typeof (el as { source?: unknown }).source === 'string'
    ? ((el as { source: string }).source)
    : null;
}

/** #rrggbb(aa) → rgba() at the given alpha. */
function withAlpha(hex: string, a: number): string {
  const m = /^#?([0-9a-fA-F]{6})/.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function drawDiamond(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  color: string,
): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx + r, cy);
  ctx.lineTo(cx, cy + r);
  ctx.lineTo(cx - r, cy);
  ctx.closePath();
  ctx.fill();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** A keyframe lane's header row: property label + ◀ ◆ ▶ cluster.
 * Positioned absolutely in the canvas timeline's header column. */
function LaneNav({
  elementId,
  property,
  animIndex,
  top,
  height,
}: {
  elementId: string;
  property: string;
  animIndex: number;
  top: number;
  height: number;
}) {
  const { store } = useEditorContext();
  const actions = useEditor();
  const el = useEditorStore((s) => findById(s.source.elements, elementId));
  const anim = el?.keyframe_animations?.[animIndex];
  if (!el?.id || !anim) return null;
  const start = elementTime(el);
  const playTime = (): number => store.getState().playback.time;

  const jump = (dir: -1 | 1): void => {
    const t = playTime();
    const abs = anim.keyframes.map((k) => start + kfTime(k)).sort((a, b) => a - b);
    const target =
      dir === 1 ? abs.find((a) => a > t + KF_EPS) : [...abs].reverse().find((a) => a < t - KF_EPS);
    if (target !== undefined) actions.seek(Math.max(0, target));
  };
  const toggle = (): void => {
    const local = Math.round(Math.max(0, playTime() - start) * 1000) / 1000;
    actions.updateElement(el.id!, {
      keyframe_animations: toggleKeyframeAt(el.keyframe_animations ?? [], animIndex, local),
    } as Partial<Element>);
  };
  const navBtn = (dir: -1 | 1, left: number) => (
    <button
      type="button"
      className="absolute pointer-events-auto grid place-items-center text-muted-foreground/60 hover:text-foreground"
      style={{ left, top: top + height / 2 - 8, width: 14, height: 16 }}
      title={dir === -1 ? 'Previous keyframe' : 'Next keyframe'}
      aria-label={dir === -1 ? 'Previous keyframe' : 'Next keyframe'}
      onClick={() => jump(dir)}
    >
      <svg width="7" height="7" viewBox="0 0 8 8" aria-hidden="true">
        <path d={dir === -1 ? 'M6 1 L2 4 L6 7 Z' : 'M2 1 L6 4 L2 7 Z'} fill="currentColor" />
      </svg>
    </button>
  );
  return (
    <>
      <button
        type="button"
        className="absolute pointer-events-auto text-[10px] text-muted-foreground hover:text-foreground truncate text-left"
        style={{ left: 20, top, width: HEADER_W - 20 - 46, height, lineHeight: `${height}px` }}
        title="Open in curve editor"
        onClick={() => actions.setUiState({ curveTarget: { elementId, property } })}
      >
        {property}
      </button>
      {navBtn(-1, HEADER_W - 46)}
      <button
        type="button"
        className="absolute pointer-events-auto grid place-items-center group"
        style={{ left: HEADER_W - 31, top: top + height / 2 - 8, width: 16, height: 16 }}
        title="Add / remove keyframe at playhead"
        aria-label={`Toggle ${property} keyframe at playhead`}
        onClick={toggle}
      >
        <span
          className="w-1.5 h-1.5 rotate-45 group-hover:scale-125 transition-transform"
          style={{ background: 'var(--color-playhead)' }}
        />
      </button>
      {navBtn(1, HEADER_W - 14)}
    </>
  );
}

function ClipMenu({
  menu,
  actions,
  close,
}: {
  menu: MenuState;
  actions: { split: () => void; canSplit: boolean; duplicate: () => void; remove: () => void; isGroup: boolean; enter: () => void; ungroup: () => void; canGroup: boolean; group: () => void };
  close: () => void;
}) {
  const item =
    'w-full text-left px-2.5 h-7 text-[11px] text-foreground/90 hover:bg-card disabled:opacity-35 disabled:hover:bg-transparent';
  return (
    <div
      className="fixed z-50 min-w-36 py-1 rounded-md border bg-popover shadow-2xl"
      style={{ left: menu.x, top: menu.y, borderColor: 'var(--color-popover-border)' }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button type="button" className={item} disabled={!actions.canSplit}
        onClick={() => { actions.split(); close(); }}>
        Split at playhead
      </button>
      <button type="button" className={item} onClick={() => { actions.duplicate(); close(); }}>
        Duplicate
      </button>
      {actions.canGroup && (
        <button type="button" className={item} onClick={() => { actions.group(); close(); }}>
          Group selection
        </button>
      )}
      {actions.isGroup && (
        <button type="button" className={item} onClick={() => { actions.enter(); close(); }}>
          Enter group
        </button>
      )}
      {actions.isGroup && (
        <button type="button" className={item} onClick={() => { actions.ungroup(); close(); }}>
          Ungroup
        </button>
      )}
      <div className="h-px bg-border my-1" />
      <button type="button" className={cn(item, 'text-destructive hover:text-destructive')}
        onClick={() => { actions.remove(); close(); }}>
        Delete
      </button>
    </div>
  );
}

// ── Split math (transplanted, exact) ─────────────────────────────────

function splitElement(el: Element, at: number, sourceDuration: number): [Element, Element] | null {
  const start = elementTime(el);
  const dur = elementDuration(el, sourceDuration);
  const end = start + dur;
  if (at <= start + 0.05 || at >= end - 0.05) return null;
  if ((el as { time_remap?: unknown }).time_remap) return null;
  const off = at - start;
  const a = { ...el, duration: round3(off) } as Element;
  const b: Record<string, unknown> = {
    ...el,
    id: `${el.id}-b`,
    time: round3(at),
    duration: round3(end - at),
  };
  if (el.type === 'video' || el.type === 'audio') {
    const rate =
      el.type === 'video' && typeof (el as { playback_rate?: unknown }).playback_rate === 'number'
        ? (el as { playback_rate: number }).playback_rate
        : 1;
    const trim0 = typeof (el as { trim_start?: unknown }).trim_start === 'number'
      ? (el as { trim_start: number }).trim_start
      : 0;
    b.trim_start = round3(trim0 + off * rate);
    const td = (el as { trim_duration?: unknown }).trim_duration;
    if (typeof td === 'number') {
      (a as Record<string, unknown>).trim_duration = round3(Math.min(td, off * rate));
      b.trim_duration = round3(Math.max(0.01, td - off * rate));
    }
  }
  if (el.keyframe_animations) {
    b.keyframe_animations = el.keyframe_animations.map((an) => ({
      ...an,
      keyframes: an.keyframes.map((k) =>
        typeof k.time === 'number' ? { ...k, time: round3(k.time - off) } : k,
      ),
    }));
  }
  if (el.animations) {
    b.animations = el.animations.map((an) =>
      typeof an.time === 'number' ? { ...an, time: round3(an.time - off) } : an,
    );
  }
  return [a, b as unknown as Element];
}

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

function byKfTime(a: Keyframe, b: Keyframe): number {
  const ta = typeof a.time === 'number' ? a.time : parseFloat(String(a.time)) || 0;
  const tb = typeof b.time === 'number' ? b.time : parseFloat(String(b.time)) || 0;
  return ta - tb;
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
