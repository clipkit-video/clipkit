// Figma-layout pass (ruled by Ian 2026-06-11) — the Time / Transform
// composite renderers and the alignment action row. All of it is
// LAYER 2 (overrides/composites over derived fields): every widget
// here writes plain literal protocol fields; nothing introduces new
// semantics. The alignment row is the one non-field piece — stateless
// actions that compute one-shot x/y writes from elementSourceBox.

'use client';

import type { Element, Source } from '@clipkit/protocol';
import { elementSourceBox } from '@clipkit/editor-core';
import { cn } from '../lib/utils.js';
import {
  NumberControl,
  LengthControl,
  Stepper,
  type ScrubHandlers,
} from './primitives.js';

type Patch = Record<string, unknown>;
type Commit = (patch: Patch, live: boolean) => void;

// Stepper moved into primitives.tsx (NumberControl embeds it now);
// re-exported here for existing imports.
export { Stepper };

// ── Time block: Length (+steppers) and In & Out ─────────────────────

export function TimeRangeRows({
  time,
  resolvedDuration,
  commit,
  ...scrub
}: {
  /** The element's authored `time` (undefined = 0). */
  time: number | undefined;
  /** elementDuration(el, sourceDuration) — authored or resolved. */
  resolvedDuration: number;
  commit: Commit;
} & ScrubHandlers) {
  const tIn = time ?? 0;
  const tOut = tIn + resolvedDuration;
  return (
    <>
      <div className="flex items-center gap-2 h-8">
        <span className="w-16 shrink-0 text-[11px] text-muted-foreground truncate">Length</span>
        <div className="flex-1 grid grid-cols-2 gap-2 min-w-0">
          <NumberControl
            value={round3(resolvedDuration)}
            min={0.1}
            step={0.1}
            suffix="s"
            fluid
            onChange={(v, live) => commit({ duration: round3(Math.max(0.1, v)) }, live)}
            {...scrub}
          />
          <Stepper
            fluid
            onStep={(dir) =>
              commit({ duration: round3(Math.max(0.1, resolvedDuration + dir * 0.5)) }, false)
            }
          />
        </div>
      </div>
      <div className="flex items-center gap-2 h-8">
        <span className="w-16 shrink-0 text-[11px] text-muted-foreground truncate">In &amp; Out</span>
        <div className="flex-1 grid grid-cols-2 gap-2 min-w-0">
          <NumberControl
            value={round3(tIn)}
            min={0}
            step={0.05}
            suffix="s"
            fluid
            onChange={(v, live) => commit({ time: round3(Math.max(0, v)) }, live)}
            {...scrub}
          />
          <NumberControl
            value={round3(tOut)}
            min={tIn + 0.1}
            step={0.05}
            suffix="s"
            fluid
            onChange={(v, live) =>
              commit({ duration: round3(Math.max(0.1, v - tIn)) }, live)
            }
            {...scrub}
          />
        </div>
      </div>
    </>
  );
}

// ── Size: W/H wells (lock icon removed per Ian 2026-06-11) ─────────

export function SizeControl({
  width,
  height,
  commit,
  ...scrub
}: {
  width: unknown;
  height: unknown;
  commit: Commit;
} & ScrubHandlers) {
  return (
    <div className="flex-1 grid grid-cols-2 gap-2 min-w-0">
      <LengthControl
        value={numOrStr(width)}
        prefix="W"
        fluid
        onChange={(v, live) => commit({ width: v }, live)}
        {...scrub}
      />
      <LengthControl
        value={numOrStr(height)}
        prefix="H"
        fluid
        onChange={(v, live) => commit({ height: v }, live)}
        {...scrub}
      />
    </div>
  );
}

// ── Rotate: angle + rotate-90 / flip-H / flip-V quick actions ───────

export function RotateControl({
  rotation,
  xScale,
  yScale,
  commit,
  ...scrub
}: {
  rotation: unknown;
  xScale: unknown;
  yScale: unknown;
  commit: Commit;
} & ScrubHandlers) {
  const rot = typeof rotation === 'number' ? rotation : 0;
  // Joined segmented group (the reference HTML's gap-px look).
  const act = (cls: string, label: string, onClick: () => void, icon: React.ReactNode) => (
    <button
      type="button"
      className={cn(
        'flex-1 h-6 grid place-items-center bg-field text-muted-foreground hover:text-foreground hover:bg-field-hover transition-colors',
        cls,
      )}
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      {icon}
    </button>
  );
  return (
    <div className="flex-1 grid grid-cols-2 gap-2 min-w-0 items-center">
      <NumberControl
        value={rot}
        step={1}
        suffix="°"
        prefix={
          <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true">
            <path
              d="M1.5 8.5 L8.5 1.5 M1.5 8.5 H8.5 M5.5 8.5 A4 4 0 0 0 4.3 5.7"
              fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round"
            />
          </svg>
        }
        fluid
        onChange={(v, live) => commit({ rotation: v }, live)}
        {...scrub}
      />
      <div className="flex h-6 gap-px rounded-md overflow-hidden min-w-0">
      {act('', 'Rotate 90° clockwise', () => commit({ rotation: rot + 90 }, false), (
        <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M9.5 4.5 a4 4 0 1 0 0.5 3 M9.5 1.5 V4.5 H6.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ))}
      {act('', 'Flip horizontal', () =>
        commit({ x_scale: -(typeof xScale === 'number' ? xScale : 1) }, false), (
        <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M6 1 V11 M4.5 3.5 L1.5 6 L4.5 8.5 Z M7.5 3.5 L10.5 6 L7.5 8.5 Z" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
        </svg>
      ))}
      {act('', 'Flip vertical', () =>
        commit({ y_scale: -(typeof yScale === 'number' ? yScale : 1) }, false), (
        <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M1 6 H11 M3.5 4.5 L6 1.5 L8.5 4.5 Z M3.5 7.5 L6 10.5 L8.5 7.5 Z" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
        </svg>
      ))}
      </div>
    </div>
  );
}

// ── Anchor: numeric X/Y % wells + the anchor pad (ruled by Ian) ─────
// The pad has edge ticks (left/right/top/bottom) and a center plus:
// a tick writes ONE axis to 0 or 1, the plus writes both to 0.5. The
// wells edit the same two fields as exact percentages. Writes keep
// the authored format (number stays a fraction; string/unauthored
// writes "%" strings — the protocol accepts both).

export function AnchorControl({
  xAnchor,
  yAnchor,
  commit,
  ...scrub
}: {
  xAnchor: unknown;
  yAnchor: unknown;
  commit: Commit;
} & ScrubHandlers) {
  const x = parseAnchorNum(xAnchor);
  const y = parseAnchorNum(yAnchor);
  const fmt = (raw: unknown, frac: number): number | string =>
    typeof raw === 'number' ? round3(frac) : `${round3(frac * 100)}%`;

  return (
    <div className="flex items-start gap-2 py-1">
      <span className="w-16 shrink-0 text-[11px] text-muted-foreground pt-1.5 truncate">
        Anchor
      </span>
      {/* Two half-columns: stacked X/Y wells (no steppers — custom
          block, ruled by Ian), then the 3×3 dot pad. */}
      <div className="flex-1 grid grid-cols-2 gap-2 min-w-0 items-start">
        <div className="flex flex-col gap-2 min-w-0">
          <NumberControl
            value={round1(x * 100)}
            min={0}
            max={100}
            step={1}
            suffix="%"
            prefix="X"
            fluid
            onChange={(v, live) => commit({ x_anchor: fmt(xAnchor, v / 100) }, live)}
            {...scrub}
          />
          <NumberControl
            value={round1(y * 100)}
            min={0}
            max={100}
            step={1}
            suffix="%"
            prefix="Y"
            fluid
            onChange={(v, live) => commit({ y_anchor: fmt(yAnchor, v / 100) }, live)}
            {...scrub}
          />
        </div>
        <AnchorPad
          x={x}
          y={y}
          onPick={(nx, ny) =>
            commit(
              { x_anchor: fmt(xAnchor, nx), y_anchor: fmt(yAnchor, ny) },
              false,
            )
          }
        />
      </div>
    </div>
  );
}

const near = (a: number, b: number): boolean => Math.abs(a - b) < 0.005;

/** 3×3 anchor dot grid (re-ruled back by Ian 2026-06-11): one dot per
 * preset (0 / 50 / 100 on each axis); the active combination shows in
 * the playhead blue. */
function AnchorPad({
  x,
  y,
  onPick,
}: {
  x: number;
  y: number;
  onPick: (nx: number, ny: number) => void;
}) {
  const stops = [0, 0.5, 1];
  return (
    <div className="w-full h-[72px] bg-field rounded-md min-w-0 grid grid-cols-3 grid-rows-3 overflow-hidden">
      {stops.flatMap((ay) =>
        stops.map((ax) => {
          const active = near(x, ax) && near(y, ay);
          return (
            <button
              key={`${ax}-${ay}`}
              type="button"
              className="w-full h-full grid place-items-center group"
              onClick={() => onPick(ax, ay)}
              title={`Anchor ${ax * 100}% / ${ay * 100}%`}
              aria-label={`Anchor ${ax * 100}% ${ay * 100}%`}
              aria-pressed={active}
            >
              <span
                className={cn(
                  'rounded-full transition-all',
                  active
                    ? 'w-2 h-2'
                    : 'w-1 h-1 bg-muted-foreground/50 group-hover:bg-muted-foreground group-hover:scale-150',
                )}
                style={active ? { background: 'var(--color-playhead)' } : undefined}
              />
            </button>
          );
        }),
      )}
    </div>
  );
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ── Alignment action row ────────────────────────────────────────────
// Stateless: each button computes target x/y from elementSourceBox and
// writes ONE literal patch. Reference frame: single selection → the
// composition (or the parent group's box for nested children);
// multi-selection → the selection's bounding box. Distribute needs 3+.

type AlignMode = 'start' | 'center' | 'end';

interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}

function findWithParent(
  elements: readonly Element[],
  id: string,
  parent: Element | null = null,
): { el: Element; parent: Element | null } | null {
  for (const el of elements) {
    if (el.id === id) return { el, parent };
    if (el.type === 'group') {
      const nested = findWithParent(el.elements as readonly Element[], id, el);
      if (nested) return nested;
    }
  }
  return null;
}

export function AlignmentRow({
  source,
  selection,
  commitMany,
}: {
  source: Source;
  selection: readonly string[];
  /** Batched element patches — ONE history entry. */
  commitMany: (updates: Array<{ id: string; patch: Patch }>) => void;
}) {
  const items = selection
    .map((id) => findWithParent(source.elements, id))
    .filter((r): r is { el: Element; parent: Element | null } => r !== null)
    .map((r) => ({ ...r, box: elementSourceBox(r.el, source) }))
    .filter((r): r is typeof r & { box: NonNullable<typeof r.box> } => r.box !== null);
  if (items.length === 0) return null;

  const frameFor = (parent: Element | null): Frame => {
    if (items.length > 1) {
      // Selection bounds.
      const xs = items.map((i) => i.box.x);
      const ys = items.map((i) => i.box.y);
      const x2 = items.map((i) => i.box.x + i.box.w);
      const y2 = items.map((i) => i.box.y + i.box.h);
      return {
        x: Math.min(...xs),
        y: Math.min(...ys),
        w: Math.max(...x2) - Math.min(...xs),
        h: Math.max(...y2) - Math.min(...ys),
      };
    }
    // Single: the parent group's box when nested (its local space),
    // else the composition.
    if (parent) {
      const pb = elementSourceBox(parent, source);
      if (pb) return { x: 0, y: 0, w: pb.w, h: pb.h };
    }
    return { x: 0, y: 0, w: source.width ?? 1920, h: source.height ?? 1080 };
  };

  const align = (axis: 'x' | 'y', mode: AlignMode): void => {
    const updates = items.map(({ el, parent, box }) => {
      const f = frameFor(parent);
      const size = axis === 'x' ? box.w : box.h;
      const fPos = axis === 'x' ? f.x : f.y;
      const fSize = axis === 'x' ? f.w : f.h;
      const target =
        mode === 'start' ? fPos : mode === 'center' ? fPos + (fSize - size) / 2 : fPos + fSize - size;
      // box.x = x − w·ax  ⇒  x = targetBox + w·ax (anchors preserved).
      const anchor = axis === 'x'
        ? parseAnchorNum(el.x_anchor)
        : parseAnchorNum(el.y_anchor);
      return { id: el.id!, patch: { [axis]: round3(target + size * anchor) } };
    });
    commitMany(updates.filter((u) => u.id));
  };

  const distribute = (axis: 'x' | 'y'): void => {
    if (items.length < 3) return;
    const sorted = [...items].sort((a, b) =>
      axis === 'x' ? a.box.x - b.box.x : a.box.y - b.box.y,
    );
    const first = sorted[0]!.box;
    const last = sorted[sorted.length - 1]!.box;
    const span =
      (axis === 'x' ? last.x + last.w - first.x : last.y + last.h - first.y);
    const total = sorted.reduce((s, i) => s + (axis === 'x' ? i.box.w : i.box.h), 0);
    const gap = (span - total) / (sorted.length - 1);
    let cursor = axis === 'x' ? first.x : first.y;
    const updates = sorted.map(({ el, box }) => {
      const size = axis === 'x' ? box.w : box.h;
      const anchor = axis === 'x'
        ? parseAnchorNum(el.x_anchor)
        : parseAnchorNum(el.y_anchor);
      const patch = { [axis]: round3(cursor + size * anchor) };
      cursor += size + gap;
      return { id: el.id!, patch };
    });
    commitMany(updates.filter((u) => u.id));
  };

  const canDistribute = items.length >= 3;

  const btn = (label: string, onClick: () => void, icon: React.ReactNode, disabled = false) => (
    <button
      type="button"
      className="w-6 h-6 grid place-items-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-25 disabled:hover:bg-transparent"
      onClick={onClick}
      title={label}
      aria-label={label}
      disabled={disabled}
    >
      {icon}
    </button>
  );

  // Compact Figma-style glyphs: a reference line + a bar.
  const g = (d: string) => (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d={d} stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" fill="none" />
    </svg>
  );

  return (
    <div className="flex items-center justify-between px-2 h-8 border-b border-border shrink-0">
      {btn('Align left', () => align('x', 'start'), g('M2 1.5 V10.5 M4.5 4 H9 M4.5 8 H7'))}
      {btn('Align horizontal center', () => align('x', 'center'), g('M6 1.5 V10.5 M3 4 H9 M4 8 H8'))}
      {btn('Align right', () => align('x', 'end'), g('M10 1.5 V10.5 M3 4 H7.5 M5 8 H7.5'))}
      {btn('Align top', () => align('y', 'start'), g('M1.5 2 H10.5 M4 4.5 V9 M8 4.5 V7'))}
      {btn('Align vertical center', () => align('y', 'center'), g('M1.5 6 H10.5 M4 3 V9 M8 4 V8'))}
      {btn('Align bottom', () => align('y', 'end'), g('M1.5 10 H10.5 M4 3 V7.5 M8 5 V7.5'))}
      {btn('Distribute horizontally', () => distribute('x'), g('M1.5 1.5 V10.5 M10.5 1.5 V10.5 M6 4 V8'), !canDistribute)}
      {btn('Distribute vertically', () => distribute('y'), g('M1.5 1.5 H10.5 M1.5 10.5 H10.5 M4 6 H8'), !canDistribute)}
    </div>
  );
}

// ── Shared bits ─────────────────────────────────────────────────────

function parseAnchorNum(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    if (Number.isFinite(n)) return v.includes('%') ? n / 100 : n;
  }
  return 0.5;
}

function numOrStr(v: unknown): number | string {
  return typeof v === 'number' || typeof v === 'string' ? v : 0;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
