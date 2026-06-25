// Interpolation panel (re-ruled by Ian 2026-06-11: the curve view
// TAKES OVER THE INSPECTOR instead of the timeline). Strictly a view
// of ONE segment's easing — the segment under the playhead — drawn
// through the runtime's NORMATIVE applyEasing so the curve IS the
// rendered motion. Layout per the reference HTML: Hold / Ease /
// Spring segmented tabs, a square curve well (draggable bezier
// handles when custom), Ease preset select, Bezier numbers, and an
// animated preview ball. All writes land on the segment's incoming
// keyframe's `easing` — plain literal document edits.

'use client';

import { useEffect, useRef, useState } from 'react';
import type { Element, Keyframe, KeyframeAnimation } from '@clipkit/protocol';
import { applyEasing } from '@clipkit/runtime';
import {
  elementTime,
  useEditor,
  useEditorContext,
  useEditorStore,
} from '@clipkit/editor-core';
import { cn } from '../lib/utils.js';
import { findElementById, kfTime } from '../lib/keyframes.js';
import { SelectControl, TextControl } from '../controls/primitives.js';

const NAMED_PRESETS = [
  'linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out',
  'ease-in-cubic', 'ease-out-cubic', 'ease-in-out-cubic',
  'ease-out-quart', 'ease-out-expo', 'ease-out-back',
  'elastic-out', 'bounce-out',
];
const DEFAULT_BEZIER: readonly [number, number, number, number] = [0.42, 0, 0.58, 1];

/** Bezier equivalents (or close approximations) for the named
 * presets — these position the ALWAYS-VISIBLE handles; grabbing one
 * converts the segment to Custom and edits from that shape. The drawn
 * curve itself is always the normative applyEasing, not these. */
const PRESET_BEZIER: Record<string, readonly [number, number, number, number]> = {
  linear: [0.333, 0.333, 0.667, 0.667],
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
  'ease-in-cubic': [0.32, 0, 0.67, 0],
  'ease-out-cubic': [0.33, 1, 0.68, 1],
  'ease-in-out-cubic': [0.65, 0, 0.35, 1],
  'ease-out-quart': [0.25, 1, 0.5, 1],
  'ease-out-expo': [0.16, 1, 0.3, 1],
  'ease-out-back': [0.34, 1.56, 0.64, 1],
  'elastic-out': [0.34, 1.56, 0.64, 1],
  'bounce-out': [0.34, 1.56, 0.64, 1],
};

// Curve well geometry (the reference's 236 viewBox).
const VB = 236;
const X0 = 12;
const X1 = 224;
const Y0 = 216; // value 0
const Y1 = 20; // value 1
const gx = (p: number): number => X0 + (X1 - X0) * p;
const gy = (v: number): number => Y0 + (Y1 - Y0) * v;

type Mode = 'hold' | 'ease' | 'spring';

function parseBezier(easing: unknown): [number, number, number, number] | null {
  if (typeof easing !== 'string' || !easing.startsWith('cubic-bezier')) return null;
  const nums = easing.match(/-?\d*\.?\d+/g)?.map(Number);
  return nums && nums.length === 4 && nums.every(Number.isFinite)
    ? (nums as [number, number, number, number])
    : null;
}

function modeOf(easing: unknown): Mode {
  if (typeof easing === 'string') {
    if (easing.startsWith('steps')) return 'hold';
    if (easing === 'spring') return 'spring';
  }
  return 'ease';
}

export function InterpolationPanel() {
  const { store } = useEditorContext();
  const actions = useEditor();
  const target = useEditorStore((s) => s.ui.curveTarget);
  const source = useEditorStore((s) => s.source);
  // Segment under the playhead (derived index — re-renders only when
  // the playhead crosses a keyframe).
  const segIndex = useEditorStore((s) => {
    if (!s.ui.curveTarget) return 0;
    const el = findElementById(s.source.elements, s.ui.curveTarget.elementId);
    const anim = el?.keyframe_animations?.find(
      (a) => a.property === s.ui.curveTarget!.property,
    );
    if (!el || !anim || anim.keyframes.length < 2) return 0;
    const local = Math.max(0, s.playback.time - elementTime(el));
    const sorted = [...anim.keyframes].sort((a, b) => kfTime(a) - kfTime(b));
    let i = sorted.findIndex((k) => kfTime(k) > local);
    if (i === -1) i = sorted.length - 1;
    return Math.max(0, Math.min(i - 1, sorted.length - 2));
  });

  const el = target ? findElementById(source.elements, target.elementId) : null;
  const animIndex =
    el?.keyframe_animations?.findIndex((a) => a.property === target?.property) ?? -1;
  const anim = animIndex >= 0 ? el!.keyframe_animations![animIndex] : null;

  if (!target || !el?.id || !anim) return null;
  return (
    <InterpolationBody
      key={`${target.elementId}-${target.property}-${segIndex}`}
      el={el}
      animIndex={animIndex}
      anim={anim}
      segIndex={segIndex}
      property={target.property}
      onClose={() => actions.setUiState({ curveTarget: null })}
    />
  );
}

function InterpolationBody({
  el,
  animIndex,
  anim,
  segIndex,
  property,
  onClose,
}: {
  el: Element;
  animIndex: number;
  anim: KeyframeAnimation;
  segIndex: number;
  property: string;
  onClose: () => void;
}) {
  const actions = useEditor();
  const svgRef = useRef<SVGSVGElement>(null);
  const sorted = [...anim.keyframes].sort((a, b) => kfTime(a) - kfTime(b));
  const single = sorted.length < 2;
  const kfB = sorted[Math.min(segIndex + 1, sorted.length - 1)];
  const easing = kfB?.easing;
  const mode = modeOf(easing);
  const customBezier = parseBezier(easing);
  // Handles are ALWAYS editable in Ease mode (ruled by Ian): named
  // presets show their bezier-equivalent handle positions; dragging
  // converts the segment to Custom starting from that shape.
  const bezier =
    customBezier ??
    (mode === 'ease'
      ? ([...(PRESET_BEZIER[typeof easing === 'string' ? easing : 'linear'] ??
          DEFAULT_BEZIER)] as [number, number, number, number])
      : null);

  const writeEasing = (next: Keyframe['easing'], live = false): void => {
    if (!kfB) return;
    const keyframes = anim.keyframes.map((k) =>
      k === kfB || (kfTime(k) === kfTime(kfB) && k.value === kfB.value)
        ? { ...k, easing: next }
        : k,
    );
    const nextAnims = (el.keyframe_animations ?? []).map((a, i) =>
      i === animIndex ? { ...a, keyframes } : a,
    );
    if (live) {
      actions.moveElements([{ id: el.id!, patch: { keyframe_animations: nextAnims } }], {
        skipHistory: true,
      });
    } else {
      actions.updateElement(el.id!, {
        keyframe_animations: nextAnims,
      } as Partial<Element>);
    }
  };

  // ── Bezier handle drag (one undo step per gesture) ───────────────
  const dragHandle = (e: React.PointerEvent, which: 0 | 1): void => {
    if (!bezier || !svgRef.current) return;
    e.preventDefault();
    actions.pushHistory();
    actions.setInteractive(true);
    const svg = svgRef.current;
    const move = (ev: PointerEvent): void => {
      const rect = svg.getBoundingClientRect();
      const px = ((ev.clientX - rect.left) / rect.width) * VB;
      const py = ((ev.clientY - rect.top) / rect.height) * VB;
      const x = Math.min(1, Math.max(0, (px - X0) / (X1 - X0)));
      const y = (Y0 - py) / (Y0 - Y1); // y may overshoot beyond 0..1
      const next = [...bezier] as [number, number, number, number];
      next[which * 2] = round2(x);
      next[which * 2 + 1] = round2(y);
      writeEasing(`cubic-bezier(${next.join(', ')})` as Keyframe['easing'], true);
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      actions.flushPendingSource();
      actions.setInteractive(false);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // Curve path through the NORMATIVE evaluator.
  const STEPS = 48;
  let path = `M ${gx(0)} ${gy(0)}`;
  for (let i = 1; i <= STEPS; i++) {
    const p = i / STEPS;
    path += ` L ${round2(gx(p))} ${round2(gy(applyEasing(easing, p)))}`;
  }

  const c1 = bezier ? { x: gx(bezier[0]), y: gy(bezier[1]) } : null;
  const c2 = bezier ? { x: gx(bezier[2]), y: gy(bezier[3]) } : null;

  const setMode = (m: Mode): void => {
    if (m === mode) return;
    if (m === 'hold') writeEasing('steps(1)' as Keyframe['easing']);
    else if (m === 'spring') writeEasing('spring' as Keyframe['easing']);
    else writeEasing(undefined); // ease default (runtime ease-out family / linear interp)
  };

  const easeValue = customBezier
    ? 'Custom'
    : typeof easing === 'string' && NAMED_PRESETS.includes(easing)
      ? easing
      : 'linear';

  return (
    <div className="flex flex-col h-full bg-background overflow-y-auto">
      <div className="flex items-center justify-between h-9 px-3 border-b border-border shrink-0">
        <span className="text-[11px] font-medium truncate">
          Interpolation · {property}
          {!single && (
            <span className="text-muted-foreground"> · k{segIndex + 1}→k{segIndex + 2}</span>
          )}
        </span>
        <button
          type="button"
          className="w-5 h-5 grid place-items-center text-muted-foreground hover:text-foreground"
          title="Close"
          aria-label="Close interpolation panel"
          onClick={onClose}
        >
          ×
        </button>
      </div>

      <div className="px-3 py-3 flex flex-col gap-2">
        {single ? (
          <span className="text-[11px] text-muted-foreground">
            One keyframe — add another to shape the interpolation.
          </span>
        ) : (
          <>
            {/* Hold / Ease / Spring */}
            <div className="flex gap-px items-center overflow-clip rounded-md w-full">
              {(['hold', 'ease', 'spring'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={cn(
                    'flex-1 h-6 flex items-center justify-center text-[11px] capitalize transition-colors',
                    mode === m
                      ? 'bg-secondary text-foreground'
                      : 'bg-field text-muted-foreground hover:text-foreground hover:bg-field-hover',
                  )}
                  aria-pressed={mode === m}
                  onClick={() => setMode(m)}
                >
                  {m}
                </button>
              ))}
            </div>

            {/* The curve well. */}
            <div className="w-full aspect-square bg-field rounded-md relative overflow-hidden">
              <svg ref={svgRef} viewBox={`0 0 ${VB} ${VB}`} className="w-full h-full" fill="none">
                <line x1="0" y1={Y1} x2={VB} y2={Y1} stroke="var(--color-border)" />
                <line x1="0" y1={Y0} x2={VB} y2={Y0} stroke="var(--color-border)" />
                {c1 && c2 && (
                  <>
                    <line stroke="var(--color-primary)" strokeOpacity="0.5" x1={gx(0)} y1={gy(0)} x2={c1.x} y2={c1.y} />
                    <line stroke="var(--color-primary)" strokeOpacity="0.5" x1={gx(1)} y1={gy(1)} x2={c2.x} y2={c2.y} />
                  </>
                )}
                <path stroke="var(--color-primary)" strokeWidth="2" d={path} />
                {/* Endpoint diamonds. */}
                <rect width="8" height="8" rx="2" fill="var(--color-primary)" x={gx(0) - 4} y={gy(0) - 4} transform={`rotate(45 ${gx(0)} ${gy(0)})`} />
                <rect width="8" height="8" rx="2" fill="var(--color-primary)" x={gx(1) - 4} y={gy(1) - 4} transform={`rotate(45 ${gx(1)} ${gy(1)})`} />
                {c1 && c2 && (
                  <>
                    <circle
                      fill="var(--color-primary)" cx={c1.x} cy={c1.y} r="5"
                      className="cursor-grab"
                      onPointerDown={(e) => dragHandle(e, 0)}
                    />
                    <circle
                      fill="var(--color-primary)" cx={c2.x} cy={c2.y} r="5"
                      className="cursor-grab"
                      onPointerDown={(e) => dragHandle(e, 1)}
                    />
                  </>
                )}
              </svg>
            </div>

            {mode === 'ease' && (
              <div className="flex items-center gap-2 h-8">
                <span className="w-16 shrink-0 text-[11px] text-muted-foreground truncate">Ease</span>
                <div className="flex-1 min-w-0">
                  <SelectControl
                    value={easeValue}
                    options={['linear', ...NAMED_PRESETS.filter((n) => n !== 'linear'), 'Custom']}
                    fluid
                    onChange={(v) =>
                      v === 'Custom'
                        ? writeEasing(`cubic-bezier(${DEFAULT_BEZIER.join(', ')})` as Keyframe['easing'])
                        : writeEasing((v === 'linear' ? undefined : v) as Keyframe['easing'])
                    }
                  />
                </div>
              </div>
            )}

            {customBezier && (
              <div className="flex items-center gap-2 h-8">
                <span className="w-16 shrink-0 text-[11px] text-muted-foreground truncate">Bezier</span>
                <div className="flex-1 min-w-0">
                  <TextControl
                    value={customBezier.join(', ')}
                    fluid
                    onChange={(v) => {
                      const nums = v.match(/-?\d*\.?\d+/g)?.map(Number);
                      if (nums && nums.length === 4 && nums.every(Number.isFinite)) {
                        writeEasing(`cubic-bezier(${nums.join(', ')})` as Keyframe['easing']);
                      }
                    }}
                  />
                </div>
              </div>
            )}

            {/* Animated preview ball. */}
            <div className="flex items-center gap-2 h-8">
              <span className="w-16 shrink-0 text-[11px] text-muted-foreground truncate">Preview</span>
              <div className="flex-1 min-w-0">
                <PreviewBall easing={easing} />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Looping easing preview — rAF, painted out-of-band. */
function PreviewBall({ easing }: { easing: Keyframe['easing'] }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const ballRef = useRef<HTMLDivElement>(null);
  const easingRef = useRef(easing);
  easingRef.current = easing;
  useEffect(() => {
    let raf = 0;
    let start: number | null = null;
    const CYCLE = 1600; // 1.1s run + pause
    const paint = (ts: number): void => {
      if (start === null) start = ts;
      const t = ((ts - start) % CYCLE) / 1100;
      const p = Math.min(1, t);
      const track = trackRef.current;
      const ball = ballRef.current;
      if (track && ball) {
        const w = track.clientWidth - 14;
        ball.style.left = `${3 + Math.max(0, applyEasing(easingRef.current, p)) * w}px`;
      }
      raf = requestAnimationFrame(paint);
    };
    raf = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div ref={trackRef} className="bg-field h-6 rounded-md relative overflow-hidden">
      <div
        ref={ballRef}
        className="absolute top-1/2 -translate-y-1/2 rounded-full bg-muted-foreground"
        style={{ width: 8, height: 8, left: 3 }}
      />
    </div>
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
