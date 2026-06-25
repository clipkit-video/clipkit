// Compound widgets — bespoke editors for the protocol's structured
// fields (D2: they register as custom control kinds; the renderer
// stays one mapping). All of them edit the WHOLE value and commit
// through onChange(next) — undo treats each edit as one step.

'use client';

import { useEffect, useRef, useState } from 'react';
import type {
  CaptionWord,
  GradientStop,
  LinearGradient,
  RadialGradient,
  TextMask,
  TextSpan,
} from '@clipkit/protocol';

type Gradient = LinearGradient | RadialGradient;
import { cn } from '../lib/utils.js';
import { CaptionTranscribe } from './CaptionTranscribe.js';
import {
  ColorControl,
  NumberControl,
  SelectControl,
  TextControl,
} from './primitives.js';

const ADD_BTN =
  'h-5 px-1.5 rounded text-[10px] text-muted-foreground hover:text-foreground hover:bg-card transition';
const REMOVE_BTN =
  'w-4 h-4 grid place-items-center rounded text-muted-foreground/60 hover:text-foreground text-[10px]';

/** Sub-rows on the panel's grid system: 32px pitch, 8px gaps. */
function SubRow({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-2 h-8">{children}</div>;
}

function SubLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] text-muted-foreground w-16 shrink-0 truncate">
      {children}
    </span>
  );
}

// ── Gradient (shape.gradient) ───────────────────────────────────────

const DEFAULT_GRADIENT: Gradient = {
  type: 'linear',
  angle: 180,
  stops: [
    { offset: 0, color: '#FFFFFF' },
    { offset: 1, color: '#000000' },
  ],
};

export function GradientControl({
  value,
  onChange,
  onScrubStart,
  onScrubEnd,
}: {
  value: Gradient | undefined;
  onChange: (next: Gradient | undefined, live?: boolean) => void;
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
}) {
  const rampRef = useRef<HTMLDivElement>(null);
  if (!value) {
    return (
      <button type="button" className={ADD_BTN} onClick={() => onChange(DEFAULT_GRADIENT)}>
        + Add
      </button>
    );
  }
  const stops = value.stops ?? [];
  const patch = (p: Record<string, unknown>): void =>
    onChange({ ...value, ...p } as Gradient);
  const setStop = (i: number, p: Partial<GradientStop>): void => {
    const next = stops.map((s: GradientStop, j: number) => (j === i ? { ...s, ...p } : s));
    patch({ stops: next });
  };

  // The swatch is a fixed horizontal ramp (just shows the colors); the
  // protocol's `angle` now uses the CSS convention directly (0° = to top,
  // clockwise; default 180 = to bottom).
  const sorted = [...stops].sort((a, b) => a.offset - b.offset);
  const rampStops = sorted
    .map((s: GradientStop) => `${s.color} ${s.offset * 100}%`)
    .join(', ');

  // Drag a stop handle along the ramp — writes the stop's literal
  // `offset`, live on the one-undo-step contract.
  const dragStop = (e: React.PointerEvent, i: number): void => {
    e.preventDefault();
    e.stopPropagation();
    onScrubStart?.();
    const ramp = rampRef.current;
    const move = (ev: PointerEvent): void => {
      if (!ramp) return;
      const r = ramp.getBoundingClientRect();
      const off =
        Math.round(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)) * 100) / 100;
      onChange(
        {
          ...value,
          stops: stops.map((s: GradientStop, j: number) =>
            j === i ? { ...s, offset: off } : s,
          ),
        } as Gradient,
        true,
      );
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      onScrubEnd?.();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    // Boxed like the effects/animations rows (ruled by Ian 2026-06-12).
    <div className="flex flex-col w-full border border-border/60 rounded px-2 py-1.5">
      {/* Ramp preview with draggable stop handles. */}
      <div ref={rampRef} className="relative h-6 mb-1">
        {/* No border — its hairline read as a pale sliver against
            dark gradient ends (Ian's report). */}
        <div
          className="absolute inset-0 rounded-md"
          style={{
            background:
              value.type === 'linear'
                ? `linear-gradient(90deg, ${rampStops})`
                : `radial-gradient(circle, ${rampStops})`,
          }}
        />
        {stops.map((stop: GradientStop, i: number) => (
          <button
            key={i}
            type="button"
            // The classic gradient-editor knob: white ring + dark
            // outer hairline — visible over ANY stop color, and
            // clearly a control (a subtle ring read as a paint
            // artifact on dark ends).
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.6)] cursor-ew-resize hover:scale-125 transition-transform"
            style={{ left: `${stop.offset * 100}%`, background: stop.color }}
            title={`Stop ${i + 1} · ${Math.round(stop.offset * 100)}% (drag)`}
            aria-label={`Drag stop ${i + 1}`}
            onPointerDown={(e) => dragStop(e, i)}
          />
        ))}
      </div>
      <SubRow>
        <SubLabel>Type</SubLabel>
        <div className="flex-1 min-w-0 grid grid-cols-2 gap-2">
          <SelectControl
            value={value.type}
            options={['linear', 'radial']}
            fluid
            onChange={(t) =>
              onChange(
                t === 'linear'
                  ? { type: 'linear', angle: 180, stops: value.stops }
                  : { type: 'radial', cx: 0.5, cy: 0.5, radius: 0.5, stops: value.stops },
              )
            }
          />
          {value.type === 'linear' ? (
            <NumberControl
              value={value.angle ?? 180}
              suffix="°"
              fluid
              onChange={(v) => patch({ angle: v })}
            />
          ) : (
            <NumberControl
              value={value.radius ?? 0.5}
              min={0}
              max={1}
              step={0.05}
              fluid
              onChange={(v) => patch({ radius: v })}
            />
          )}
        </div>
      </SubRow>
      {stops.map((stop: GradientStop, i: number) => (
        <SubRow key={i}>
          <SubLabel>Stop {i + 1}</SubLabel>
          {/* Color gets the wider share so the hex fits unclipped. */}
          <div className="flex-1 min-w-0 grid grid-cols-[0.75fr_1.25fr] gap-2 items-center">
            <NumberControl
              value={stop.offset}
              min={0}
              max={1}
              step={0.01}
              fluid
              onChange={(v) => setStop(i, { offset: v })}
            />
            <div className="flex items-center gap-1 min-w-0">
              <ColorControl value={stop.color} fluid onChange={(c) => setStop(i, { color: c })} />
              {stops.length > 2 && (
                <button
                  type="button"
                  className={REMOVE_BTN}
                  aria-label="Remove stop"
                  onClick={() =>
                    patch({ stops: stops.filter((_: GradientStop, j: number) => j !== i) })
                  }
                >
                  ×
                </button>
              )}
            </div>
          </div>
        </SubRow>
      ))}
      <div className="flex items-center justify-between">
        {stops.length < 4 ? (
          <button
            type="button"
            className={ADD_BTN}
            onClick={() =>
              patch({
                stops: [...stops, { offset: 1, color: '#888888' }],
              })
            }
          >
            + Stop
          </button>
        ) : (
          <span />
        )}
        <button type="button" className={ADD_BTN} onClick={() => onChange(undefined)}>
          Remove
        </button>
      </div>
    </div>
  );
}

// ── Box shadow (shape.shadow) ───────────────────────────────────────

export function BoxShadowControl({
  value,
  onChange,
}: {
  value: { color: string; offset_x?: number; offset_y?: number; blur?: number } | undefined;
  onChange: (next: typeof value) => void;
}) {
  if (!value) {
    return (
      <button
        type="button"
        className={ADD_BTN}
        onClick={() => onChange({ color: '#00000099', offset_y: 12, blur: 24 })}
      >
        + Add
      </button>
    );
  }
  return (
    // Boxed + on the grid system, matching the gradient subview.
    <div className="flex flex-col w-full border border-border/60 rounded px-2 py-1.5">
      <SubRow>
        <SubLabel>Color</SubLabel>
        <div className="flex-1 min-w-0">
          <ColorControl value={value.color} fluid onChange={(c) => onChange({ ...value, color: c })} />
        </div>
      </SubRow>
      <SubRow>
        <SubLabel>Offset</SubLabel>
        <div className="flex-1 min-w-0 grid grid-cols-2 gap-2">
          <NumberControl
            value={value.offset_x ?? 0}
            prefix="X"
            suffix="px"
            fluid
            onChange={(v) => onChange({ ...value, offset_x: v })}
          />
          <NumberControl
            value={value.offset_y ?? 0}
            prefix="Y"
            suffix="px"
            fluid
            onChange={(v) => onChange({ ...value, offset_y: v })}
          />
        </div>
      </SubRow>
      <SubRow>
        <SubLabel>Blur</SubLabel>
        <div className="flex-1 min-w-0 grid grid-cols-2 gap-2 items-center">
          <NumberControl
            value={value.blur ?? 0}
            min={0}
            suffix="px"
            fluid
            onChange={(v) => onChange({ ...value, blur: v })}
          />
          <button type="button" className={cn(ADD_BTN, 'justify-self-end')} onClick={() => onChange(undefined)}>
            Remove
          </button>
        </div>
      </SubRow>
    </div>
  );
}

// ── Text / caption background (composite: color + radius + padding) ──

export function TextBackgroundControl({
  color,
  radius,
  padding,
  commit,
}: {
  color: string | undefined;
  radius: number | undefined;
  padding: number | [number, number] | undefined;
  commit: (patch: Record<string, unknown>, live: boolean) => void;
}) {
  if (typeof color !== 'string') {
    return (
      <button
        type="button"
        className={ADD_BTN}
        onClick={() => commit({ background_color: '#000000', background_border_radius: 8, background_padding: [16, 8] }, false)}
      >
        + Add
      </button>
    );
  }
  const padX = Array.isArray(padding) ? padding[0] : typeof padding === 'number' ? padding : 0;
  const padY = Array.isArray(padding) ? padding[1] : typeof padding === 'number' ? padding : 0;
  // Collapse to a single number when X === Y, else store [x, y].
  const setPad = (nx: number, ny: number, live: boolean): void =>
    commit({ background_padding: nx === ny ? nx : [nx, ny] }, live);
  return (
    <div className="flex flex-col w-full border border-border/60 rounded px-2 py-1.5">
      <SubRow>
        <SubLabel>Color</SubLabel>
        <div className="flex-1 min-w-0">
          <ColorControl value={color} fluid onChange={(c, live) => commit({ background_color: c }, live ?? false)} />
        </div>
      </SubRow>
      <SubRow>
        <SubLabel>Radius</SubLabel>
        <div className="flex-1 min-w-0">
          <NumberControl value={radius ?? 0} min={0} suffix="px" fluid onChange={(v, live) => commit({ background_border_radius: v }, !!live)} />
        </div>
      </SubRow>
      <SubRow>
        <SubLabel>Padding</SubLabel>
        <div className="flex-1 min-w-0 grid grid-cols-2 gap-2">
          <NumberControl value={padX} prefix="X" min={0} suffix="px" fluid onChange={(v, live) => setPad(v, padY, !!live)} />
          <NumberControl value={padY} prefix="Y" min={0} suffix="px" fluid onChange={(v, live) => setPad(padX, v, !!live)} />
        </div>
      </SubRow>
      <SubRow>
        <SubLabel> </SubLabel>
        <button
          type="button"
          className={cn(ADD_BTN, 'justify-self-end')}
          onClick={() => commit({ background_color: undefined, background_border_radius: undefined, background_padding: undefined }, false)}
        >
          Remove
        </button>
      </SubRow>
    </div>
  );
}

// ── Text reveal mask (text.mask) ────────────────────────────────────

export function TextMaskControl({
  value,
  onChange,
}: {
  value: TextMask | undefined;
  onChange: (next: TextMask | undefined) => void;
}) {
  if (!value) {
    return (
      <button
        type="button"
        className={ADD_BTN}
        onClick={() => onChange({ type: 'linear-wipe', angle: -45, progress: 0, softness: 0.3 })}
      >
        + Add
      </button>
    );
  }
  const progress = typeof value.progress === 'number' ? value.progress : 0;
  return (
    <div className="flex flex-col gap-0.5 w-full">
      <SubRow>
        <SubLabel>Angle</SubLabel>
        <NumberControl
          value={value.angle ?? -45}
          suffix="°"
          onChange={(v) => onChange({ ...value, angle: v })}
          width={56}
        />
      </SubRow>
      <SubRow>
        <SubLabel>Progress</SubLabel>
        {Array.isArray(value.progress) ? (
          <span className="text-[10px] italic text-muted-foreground/70">keyframed</span>
        ) : (
          <NumberControl
            value={progress}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => onChange({ ...value, progress: v })}
            width={56}
          />
        )}
      </SubRow>
      <SubRow>
        <SubLabel>Softness</SubLabel>
        <NumberControl
          value={value.softness ?? 0.3}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) => onChange({ ...value, softness: v })}
          width={56}
        />
        <button type="button" className={cn(ADD_BTN, 'ml-auto')} onClick={() => onChange(undefined)}>
          Remove
        </button>
      </SubRow>
    </div>
  );
}

// ── Caption word table (caption.words) ──────────────────────────────

export function CaptionWordsControl({
  value,
  onChange,
}: {
  value: CaptionWord[] | undefined;
  onChange: (next: CaptionWord[]) => void;
}) {
  const words = value ?? [];
  const setWord = (i: number, p: Partial<CaptionWord>): void =>
    onChange(words.map((w, j) => (j === i ? { ...w, ...p } : w)));
  return (
    <div className="flex flex-col gap-0.5 w-full max-h-72 overflow-y-auto">
      <CaptionTranscribe />
      {words.map((w, i) => (
        <SubRow key={i}>
          <TextControl value={w.text} onChange={(t) => setWord(i, { text: t })} width={76} />
          <NumberControl
            value={w.start}
            min={0}
            step={0.01}
            onChange={(v) => setWord(i, { start: v })}
            width={48}
          />
          <NumberControl
            value={w.end}
            min={0}
            step={0.01}
            onChange={(v) => setWord(i, { end: v })}
            width={48}
          />
          {words.length > 1 && (
            <button
              type="button"
              className={REMOVE_BTN}
              aria-label="Remove word"
              onClick={() => onChange(words.filter((_, j) => j !== i))}
            >
              ×
            </button>
          )}
        </SubRow>
      ))}
      <button
        type="button"
        className={cn(ADD_BTN, 'self-start')}
        onClick={() => {
          const last = words[words.length - 1];
          const t = last ? last.end : 0;
          onChange([...words, { text: 'word', start: t, end: t + 0.4 }]);
        }}
      >
        + Word
      </button>
    </div>
  );
}

// ── Text spans (text.spans) ─────────────────────────────────────────

export function TextSpansControl({
  value,
  onChange,
  onScrubStart,
  onScrubEnd,
}: {
  value: TextSpan[] | undefined;
  onChange: (next: TextSpan[] | undefined, live?: boolean) => void;
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
}) {
  const spans = value ?? [];
  if (spans.length === 0) {
    return (
      <button
        type="button"
        className={ADD_BTN}
        onClick={() => onChange([{ text: 'Styled ' }, { text: 'text', fill_color: '#FFB800' }])}
      >
        + Add
      </button>
    );
  }
  const setSpan = (i: number, p: Partial<TextSpan>, live = false): void =>
    onChange(spans.map((s, j) => (j === i ? { ...s, ...p } : s)), live);
  return (
    <div className="flex flex-col gap-0.5 w-full max-h-56 overflow-y-auto">
      {spans.map((s, i) => (
        <SubRow key={i}>
          <TextControl
            value={s.text}
            live
            onScrubStart={onScrubStart}
            onScrubEnd={onScrubEnd}
            onChange={(t, live) => setSpan(i, { text: t }, live)}
            width={96}
          />
          <ColorControl
            value={s.fill_color ?? '#ffffff'}
            onChange={(c) => setSpan(i, { fill_color: c })}
          />
          <button
            type="button"
            className={REMOVE_BTN}
            aria-label="Remove span"
            onClick={() => {
              const next = spans.filter((_, j) => j !== i);
              onChange(next.length > 0 ? next : undefined);
            }}
          >
            ×
          </button>
        </SubRow>
      ))}
      <button
        type="button"
        className={cn(ADD_BTN, 'self-start')}
        onClick={() => onChange([...spans, { text: 'span' }])}
      >
        + Span
      </button>
    </div>
  );
}

// ── Multiline text (text.text) ──────────────────────────────────────

export function TextareaControl({
  value,
  onChange,
  onScrubStart,
  onScrubEnd,
}: {
  value: string;
  /** `live` true while typing (skip history); commit happens on blur. */
  onChange: (next: string, live: boolean) => void;
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const editing = useRef(false);
  // Adopt external updates only when we're not the one editing, so live
  // self-writes don't fight the cursor.
  useEffect(() => {
    if (!editing.current) setDraft(value);
  }, [value]);
  return (
    <textarea
      className="w-full min-h-14 bg-transparent border border-border/60 hover:border-border focus:border-primary/50 rounded px-1.5 py-1 text-[11px] text-foreground/90 outline-none resize-y"
      value={draft}
      onFocus={() => {
        editing.current = true;
        onScrubStart?.();
      }}
      onChange={(e) => {
        setDraft(e.target.value);
        onChange(e.target.value, true); // live preview per keystroke
      }}
      onBlur={() => {
        editing.current = false;
        onScrubEnd?.();
      }}
      spellCheck={false}
    />
  );
}
