// On-stage motion-path editing (EDITORS B7b) — when the selected
// element has a `position` keyframe animation, its path draws on the
// stage as exact cubic segments (the §6.7 control-point construction:
// P1 = P0 + out_tangent, P2 = P3 + in_tangent, omitted handles =
// straight-line third-points), with draggable position keyframes and
// pen-tool tangent handles. Strictly a view of `keyframe_animations`
// — every gesture writes plain protocol keyframes back. 3D paths
// edit their xy projection (z stays untouched on drag).

'use client';

import { useState, type RefObject, type MouseEvent as ReactMouseEvent } from 'react';
import type { Element, Keyframe, KeyframeAnimation } from '@clipkit/protocol';
import { useEditor, useEditorStore } from '@clipkit/editor-core';

type Vec = readonly [number, number];

interface PathPoint {
  x: number;
  y: number;
  /** Extra components ([z]) preserved verbatim on writes. */
  rest: number[];
  out: Vec | null; // authored out_tangent (xy), or null = default
  inn: Vec | null;
  raw: Keyframe;
}

export function MotionPathOverlay({
  viewportRef,
}: {
  viewportRef: RefObject<HTMLDivElement | null>;
}) {
  const actions = useEditor();
  const source = useEditorStore((s) => s.source);
  const selection = useEditorStore((s) => s.selection);
  const zoom = useEditorStore((s) => s.ui.stageZoom) || 1;
  const pan = useEditorStore((s) => s.ui.stagePan);
  const [activePoint, setActivePoint] = useState(0);

  const srcW = source.width ?? 1920;
  const srcH = source.height ?? 1080;

  const el = selection.length === 1 ? findById(source.elements, selection[0]!) : null;
  const animIndex =
    el?.keyframe_animations?.findIndex((a) => a.property === 'position') ?? -1;
  const anim = animIndex >= 0 ? el!.keyframe_animations![animIndex]! : null;

  if (!el || !anim) return null;

  const points: PathPoint[] = anim.keyframes
    .filter((k) => Array.isArray(k.value) && k.value.length >= 2)
    .map((k) => {
      const v = k.value as number[];
      return {
        x: v[0]!,
        y: v[1]!,
        rest: v.slice(2),
        out: k.out_tangent ? ([k.out_tangent[0]!, k.out_tangent[1]!] as const) : null,
        inn: k.in_tangent ? ([k.in_tangent[0]!, k.in_tangent[1]!] as const) : null,
        raw: k,
      };
    });
  if (points.length < 1) return null;

  const act = Math.max(0, Math.min(activePoint, points.length - 1));

  // §6.7 control points (third-point defaults).
  const ctrl = (a: PathPoint, b: PathPoint): { p1: Vec; p2: Vec } => ({
    p1: a.out
      ? [a.x + a.out[0], a.y + a.out[1]]
      : [a.x + (b.x - a.x) / 3, a.y + (b.y - a.y) / 3],
    p2: b.inn
      ? [b.x + b.inn[0], b.y + b.inn[1]]
      : [b.x - (b.x - a.x) / 3, b.y - (b.y - a.y) / 3],
  });

  let d = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const { p1, p2 } = ctrl(a, b);
    d += ` C ${p1[0]} ${p1[1]}, ${p2[0]} ${p2[1]}, ${b.x} ${b.y}`;
  }

  // ── Write-back: gestures snapshot history once, then stream live ──
  const writeKeyframes = (next: Keyframe[]): void => {
    const nextAnims = el.keyframe_animations!.map((a: KeyframeAnimation, i: number) =>
      i === animIndex ? { ...a, keyframes: next } : a,
    );
    actions.moveElements(
      [{ id: el.id!, patch: { keyframe_animations: nextAnims } }],
      { skipHistory: true },
    );
  };

  const sourcePoint = (ev: MouseEvent, svg: SVGSVGElement): Vec => {
    const rect = svg.getBoundingClientRect();
    return [
      ((ev.clientX - rect.left) / rect.width) * srcW,
      ((ev.clientY - rect.top) / rect.height) * srcH,
    ];
  };

  const dragGesture = (
    e: ReactMouseEvent,
    apply: (sp: Vec) => Keyframe[],
  ): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const svg = (e.currentTarget as SVGElement).ownerSVGElement ?? (e.currentTarget as unknown as SVGSVGElement);
    let started = false;
    const onMove = (ev: MouseEvent): void => {
      if (!started) {
        started = true;
        actions.pushHistory();
        actions.setInteractive(true);
      }
      writeKeyframes(apply(sourcePoint(ev, svg)));
    };
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (started) {
        actions.flushPendingSource();
        actions.setInteractive(false);
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const dragPoint = (e: ReactMouseEvent, pi: number): void => {
    setActivePoint(pi);
    const target = points[pi]!.raw;
    dragGesture(e, (sp) => {
      const v = [round1(sp[0]), round1(sp[1]), ...points[pi]!.rest];
      return anim.keyframes.map((k) =>
        k === target ? { ...k, value: v as Keyframe['value'] } : k,
      );
    });
  };

  const dragTangent = (e: ReactMouseEvent, pi: number, which: 'out' | 'in'): void => {
    const p = points[pi]!;
    const target = p.raw;
    dragGesture(e, (sp) => {
      const t: [number, number] = [round1(sp[0] - p.x), round1(sp[1] - p.y)];
      return anim.keyframes.map((k) =>
        k === target
          ? which === 'out'
            ? { ...k, out_tangent: t as Keyframe['out_tangent'] }
            : { ...k, in_tangent: t as Keyframe['in_tangent'] }
          : k,
      );
    });
  };

  // Tangent handle display positions for the active point (defaults
  // shown at the third-point so dragging materializes them in place).
  const a = points[act]!;
  const prev = points[act - 1] ?? null;
  const next = points[act + 1] ?? null;
  const outPos: Vec | null = next
    ? a.out
      ? [a.x + a.out[0], a.y + a.out[1]]
      : [a.x + (next.x - a.x) / 3, a.y + (next.y - a.y) / 3]
    : null;
  const innPos: Vec | null = prev
    ? a.inn
      ? [a.x + a.inn[0], a.y + a.inn[1]]
      : [a.x - (a.x - prev.x) / 3, a.y - (a.y - prev.y) / 3]
    : null;

  const r = 6 / zoom; // keep hit targets ~constant on screen
  void viewportRef;

  return (
    <svg
      viewBox={`0 0 ${srcW} ${srcH}`}
      className="absolute z-20"
      style={{
        left: pan.x,
        top: pan.y,
        width: srcW * zoom,
        height: srcH * zoom,
        pointerEvents: 'none',
        overflow: 'visible',
      }}
      aria-label="Motion path"
    >
      <path
        d={d}
        fill="none"
        stroke="var(--color-primary)"
        strokeOpacity={0.7}
        strokeWidth={1.5 / zoom}
        strokeDasharray={`${4 / zoom} ${3 / zoom}`}
      />
      {/* Tangent handles for the active point. */}
      {outPos && (
        <g style={{ pointerEvents: 'auto' }}>
          <line x1={a.x} y1={a.y} x2={outPos[0]} y2={outPos[1]} stroke="var(--color-primary)" strokeOpacity={0.5} strokeWidth={1 / zoom} />
          <circle
            cx={outPos[0]} cy={outPos[1]} r={r * 0.7}
            fill="var(--color-background)" stroke="var(--color-primary)" strokeWidth={1.2 / zoom}
            className="cursor-grab"
            onMouseDown={(e) => dragTangent(e, act, 'out')}
          />
        </g>
      )}
      {innPos && (
        <g style={{ pointerEvents: 'auto' }}>
          <line x1={a.x} y1={a.y} x2={innPos[0]} y2={innPos[1]} stroke="var(--color-primary)" strokeOpacity={0.5} strokeWidth={1 / zoom} />
          <circle
            cx={innPos[0]} cy={innPos[1]} r={r * 0.7}
            fill="var(--color-background)" stroke="var(--color-primary)" strokeWidth={1.2 / zoom}
            className="cursor-grab"
            onMouseDown={(e) => dragTangent(e, act, 'in')}
          />
        </g>
      )}
      {/* Position keyframe points. */}
      {points.map((p, pi) => (
        <rect
          key={pi}
          x={p.x - r}
          y={p.y - r}
          width={r * 2}
          height={r * 2}
          transform={`rotate(45 ${p.x} ${p.y})`}
          fill={pi === act ? 'var(--color-primary)' : 'var(--color-background)'}
          stroke="var(--color-primary)"
          strokeWidth={1.2 / zoom}
          style={{ pointerEvents: 'auto' }}
          className="cursor-move"
          onMouseDown={(e) => dragPoint(e, pi)}
        />
      ))}
    </svg>
  );
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

const round1 = (v: number): number => Math.round(v * 10) / 10;
