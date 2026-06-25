// Control kit primitives — the flat, compact knobs every registry-
// rendered row uses (design/refs: small mono numerals, drag-scrub
// number fields, hairline inputs, no cards).
//
// Scrub contract (shared with stage drags): onScrubStart() snapshots
// history ONCE, every live change dispatches with skipHistory, so one
// scrub = one undo step.

'use client';

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { cn } from '../lib/utils.js';
import { ColorPickerPopover } from './ColorPicker.js';

/* Filled "well" fields per the Figma mock (ruled by Ian 2026-06-11):
   chip lighter than the panel, no border, ring on focus, optional
   muted prefix glyph (X / Y / W / H / ∠) inside the well. */
const FIELD_WRAP_CLS =
  'h-6 flex items-center gap-1 bg-field hover:bg-field-hover focus-within:ring-1 focus-within:ring-ring rounded-md px-1.5 transition-colors';
const FIELD_INNER_CLS =
  'flex-1 min-w-0 w-full bg-transparent text-[11px] font-mono tabular-nums text-foreground/90 outline-none text-right';
const FIELD_CLS =
  'h-6 w-[72px] bg-field hover:bg-field-hover focus:ring-1 focus:ring-ring rounded-md px-1.5 text-[11px] font-mono tabular-nums text-foreground/90 outline-none text-right transition-colors';

export interface ScrubHandlers {
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
}

interface NumberControlProps extends ScrubHandlers {
  value: number;
  onChange: (next: number, live: boolean) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Display suffix ('°', '%', 's', …) — visual only. */
  suffix?: string;
  /** Muted glyph inside the well, before the number ('X', 'W', icon).
      Also a scrub handle (cursor-ew-resize), per the reference HTML. */
  prefix?: React.ReactNode;
  /** Rendered inside the well's right edge (the ◇ keyframe diamond). */
  trailing?: React.ReactNode;
  /** Append a joined −/+ stepper beside the well. */
  stepper?: boolean;
  /** Stretch to fill the row's value column (the panel's fluid grid)
      instead of the fixed 72px default. */
  fluid?: boolean;
  width?: number;
}

const clamp = (v: number, min?: number, max?: number): number =>
  Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));

const roundTo = (v: number, step: number): number => {
  const inv = 1 / step;
  return Math.round(v * inv) / inv;
};

/** Partial numeric input — what's allowed WHILE typing ("-", "1.").
 * Letters never enter number fields (ruled by Ian 2026-06-11). */
const NUMERIC_PARTIAL = /^-?\d*\.?\d*$/;

/** Joined −/+ pair, same 24px well treatment as the inputs. */
export function Stepper({
  onStep,
  fluid,
}: {
  onStep: (dir: -1 | 1) => void;
  /** Fill the grid cell as a joined pair instead of fixed buttons. */
  fluid?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex h-6 gap-px rounded-md overflow-hidden shrink-0',
        fluid && 'flex-1 w-full min-w-0',
      )}
    >
      {([-1, 1] as const).map((dir) => (
        <button
          key={dir}
          type="button"
          className={cn(
            'h-6 grid place-items-center text-[12px] bg-field text-muted-foreground hover:text-foreground hover:bg-field-hover transition-colors',
            fluid ? 'flex-1' : 'w-6',
          )}
          onClick={() => onStep(dir)}
          aria-label={dir === -1 ? 'Decrease' : 'Increase'}
        >
          {dir === -1 ? '−' : '+'}
        </button>
      ))}
    </div>
  );
}

/** Drag-scrub number field: horizontal pointer drag scrubs (step per
 * 2px, ×10 with shift), click-through to type (numeric chars only),
 * ↑/↓ arrow steps, optional unit label + built-in stepper. */
export function NumberControl({
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
  prefix,
  trailing,
  stepper,
  fluid,
  width,
  onScrubStart,
  onScrubEnd,
}: NumberControlProps) {
  const [text, setText] = useState<string | null>(null);
  const dragRef = useRef<{ startX: number; startV: number; scrubbed: boolean } | null>(null);

  const display = text ?? String(roundTo(value, Math.min(step, 0.01)));

  const stepBy = (dir: -1 | 1, factor = 1): void => {
    onChange(clamp(roundTo(value + dir * step * factor, step), min, max), false);
    setText(null);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>): void => {
    // Only scrub from an unfocused field — focused = typing mode.
    if (document.activeElement === e.currentTarget) return;
    dragRef.current = { startX: e.clientX, startV: value, scrubbed: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLElement>): void => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    if (!d.scrubbed && Math.abs(dx) < 3) return;
    if (!d.scrubbed) {
      d.scrubbed = true;
      onScrubStart?.();
    }
    const factor = e.shiftKey ? 10 : 1;
    const next = clamp(roundTo(d.startV + (dx / 2) * step * factor, step), min, max);
    onChange(next, true);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLElement>): void => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d?.scrubbed) {
      e.preventDefault();
      onScrubEnd?.();
      (e.currentTarget as HTMLElement).blur();
    }
  };
  const scrubProps = {
    onPointerDown,
    onPointerMove,
    onPointerUp,
  };

  const commitText = (raw: string): void => {
    const parsed = parseFloat(raw);
    if (Number.isFinite(parsed)) onChange(clamp(parsed, min, max), false);
    setText(null);
  };

  const needsWrap = Boolean(prefix || trailing || suffix || stepper);
  const input = (
    <input
      className={cn(
        needsWrap ? FIELD_INNER_CLS : FIELD_CLS,
        !needsWrap && fluid && 'w-full flex-1 min-w-0',
        'cursor-ew-resize focus:cursor-text select-none',
      )}
      style={!needsWrap && !fluid && width ? { width } : undefined}
      value={display}
      onChange={(e) => {
        // Reject non-numeric characters at the keystroke level.
        if (NUMERIC_PARTIAL.test(e.target.value)) setText(e.target.value);
      }}
      onFocus={() => setText(String(roundTo(value, Math.min(step, 0.01))))}
      onBlur={(e) => text !== null && commitText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setText(null);
          (e.target as HTMLInputElement).blur();
        }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          stepBy(e.key === 'ArrowUp' ? 1 : -1, e.shiftKey ? 10 : 1);
        }
      }}
      {...scrubProps}
      inputMode="decimal"
      spellCheck={false}
    />
  );
  if (!needsWrap) return input;
  const well = (
    <span
      className={cn(
        FIELD_WRAP_CLS,
        // flex-1 ONLY beside the stepper (horizontal flex = shares
        // width). In vertical stacks flex-1 would override h-6 and
        // collapse the well, so plain fluid uses w-full.
        stepper ? 'flex-1 min-w-0' : (fluid || undefined) && 'w-full min-w-0',
      )}
      style={fluid || stepper ? undefined : { width: width ?? 72 }}
    >
      {prefix && (
        <span
          className="text-[10px] text-muted-foreground/70 hover:text-foreground select-none shrink-0 cursor-ew-resize transition-colors"
          {...scrubProps}
        >
          {prefix}
        </span>
      )}
      {input}
      {/* The unit, as a persistent muted label (not part of the value). */}
      {suffix && (
        <span className="text-[10px] text-muted-foreground/70 select-none shrink-0">
          {suffix}
        </span>
      )}
      {/* pl-1: breathing room between the value and the diamond. */}
      {trailing && <span className="shrink-0 flex items-center pl-1 -mr-0.5">{trailing}</span>}
    </span>
  );
  if (!stepper) return well;
  return (
    <span
      className={cn('flex items-center gap-2', fluid && 'w-full flex-1 min-w-0')}
      style={fluid ? undefined : { width: width ?? 72 }}
    >
      {well}
      <Stepper onStep={(dir) => stepBy(dir)} />
    </span>
  );
}

/** Length values: number (px) or string with a unit ("50%", "10vw").
 * The numeric part scrubs/edits; an existing unit suffix is kept. */
export function LengthControl({
  value,
  onChange,
  step = 1,
  prefix,
  trailing,
  stepper,
  fluid,
  onScrubStart,
  onScrubEnd,
}: ScrubHandlers & {
  value: number | string;
  onChange: (next: number | string, live: boolean) => void;
  step?: number;
  prefix?: React.ReactNode;
  trailing?: React.ReactNode;
  stepper?: boolean;
  fluid?: boolean;
}) {
  const str = typeof value === 'string' ? value : null;
  const match = str?.match(/^(-?\d*\.?\d+)\s*(px|%|vw|vh|vmin|vmax)$/);
  const num = match ? parseFloat(match[1]!) : typeof value === 'number' ? value : 0;
  const unit = match?.[2] === 'px' ? '' : match?.[2] ?? '';
  // Unparseable strings ('auto', 'end', keywords) edit as raw text.
  if (str !== null && !match) {
    return (
      <TextControl
        value={str}
        onChange={(v) => onChange(v, false)}
        width={72}
        fluid={fluid}
      />
    );
  }
  return (
    <NumberControl
      value={num}
      // Numeric lengths are pixels — show it (writes stay plain numbers).
      suffix={unit === '' ? 'px' : unit}
      prefix={prefix}
      trailing={trailing}
      stepper={stepper}
      fluid={fluid}
      step={step}
      onScrubStart={onScrubStart}
      onScrubEnd={onScrubEnd}
      onChange={(n, live) => onChange(unit ? `${n}${unit}` : n, live)}
    />
  );
}

export function TextControl({
  value,
  onChange,
  width = 120,
  fluid,
  live,
  onScrubStart,
  onScrubEnd,
}: {
  value: string;
  /** `live` flag is true on per-keystroke updates (callers may skip history). */
  onChange: (next: string, live?: boolean) => void;
  width?: number;
  fluid?: boolean;
  /** Commit per keystroke (skip-history while typing, flush on blur). */
  live?: boolean;
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
}) {
  // Same controlled pattern as TextareaControl: a local draft that adopts
  // external updates only when we're not the one editing. In `live` mode
  // we commit per keystroke (skip-history while typing, flush on blur);
  // otherwise we commit once on blur/Enter.
  const [draft, setDraft] = useState(value);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setDraft(value);
  }, [value]);
  return (
    <input
      className={cn(
        FIELD_CLS,
        'text-left cursor-text',
        fluid && 'w-full flex-1 min-w-0',
      )}
      style={fluid ? undefined : { width }}
      value={draft}
      onFocus={() => {
        editing.current = true;
        if (live) onScrubStart?.();
      }}
      onChange={(e) => {
        setDraft(e.target.value);
        if (live) onChange(e.target.value, true); // live preview per keystroke
      }}
      onBlur={() => {
        editing.current = false;
        if (live) onScrubEnd?.();
        else if (draft !== value) onChange(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          editing.current = false;
          setDraft(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
      spellCheck={false}
    />
  );
}

export function SelectControl({
  value,
  options,
  onChange,
  fluid,
}: {
  value: string;
  options: readonly string[];
  onChange: (next: string) => void;
  fluid?: boolean;
}) {
  return (
    <select
      className={cn(
        'h-6 bg-field hover:bg-field-hover rounded-md px-1 text-[11px] text-foreground/90 outline-none cursor-pointer transition-colors',
        fluid ? 'w-full flex-1 min-w-0' : 'max-w-[120px]',
      )}
      value={value}
      onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

export function ToggleControl({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
      className={cn(
        'relative w-7 h-4 rounded-full transition-colors',
        value ? 'bg-primary' : 'bg-ring hover:bg-muted-foreground/40',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 w-3 h-3 rounded-full transition-transform',
          // The thumb must read on BOTH track states (it was
          // background-on-border before: invisible in dark mode).
          value
            ? 'translate-x-3.5 bg-background'
            : 'translate-x-0.5 bg-muted-foreground',
        )}
      />
    </button>
  );
}

export function ColorControl({
  value,
  onChange,
  fluid,
  onScrubStart,
  onScrubEnd,
}: {
  value: string;
  onChange: (next: string, live?: boolean) => void;
  fluid?: boolean;
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const swatchRef = useRef<HTMLButtonElement>(null);
  return (
    <div className={cn('flex items-center gap-1', fluid && 'w-full min-w-0')}>
      <button
        ref={swatchRef}
        type="button"
        className="relative w-[18px] h-[18px] rounded border border-border overflow-hidden cursor-pointer shrink-0"
        title="Open color picker"
        aria-label="Open color picker"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {/* Checkerboard shows through translucent colors. */}
        <span
          className="absolute inset-0"
          style={{
            background:
              'repeating-conic-gradient(rgba(255,255,255,0.18) 0% 25%, transparent 0% 50%) 0 0 / 8px 8px',
          }}
        />
        <span className="absolute inset-0" style={{ background: value }} />
      </button>
      <TextControl
        value={value}
        onChange={(v) => onChange(v)}
        width={68}
        fluid={fluid}
      />
      {open && swatchRef.current && (
        <ColorPickerPopover
          anchor={swatchRef.current}
          value={value}
          onChange={onChange}
          onClose={() => setOpen(false)}
          onScrubStart={onScrubStart}
          onScrubEnd={onScrubEnd}
        />
      )}
    </div>
  );
}

/** 9-dot anchor grid — the composite claiming x_anchor / y_anchor. */
export function AnchorGridControl({
  x,
  y,
  onChange,
}: {
  x: number;
  y: number;
  onChange: (x: number, y: number) => void;
}) {
  const stops = [0, 0.5, 1];
  return (
    <div className="grid grid-cols-3 gap-px p-0.5 border border-border rounded">
      {stops.flatMap((ay) =>
        stops.map((ax) => {
          const active = Math.abs(ax - x) < 0.01 && Math.abs(ay - y) < 0.01;
          return (
            <button
              key={`${ax}-${ay}`}
              type="button"
              className="w-3.5 h-3.5 grid place-items-center group"
              onClick={() => onChange(ax, ay)}
              aria-label={`Anchor ${ax * 100}% ${ay * 100}%`}
              aria-pressed={active}
            >
              <span
                className={cn(
                  'w-1 h-1 rounded-full transition-colors',
                  active
                    ? 'bg-primary scale-150'
                    : 'bg-muted-foreground/40 group-hover:bg-muted-foreground',
                )}
              />
            </button>
          );
        }),
      )}
    </div>
  );
}

/** Hydration-safe wrapper for values currently driven by keyframes. */
export function KeyframedChip() {
  return (
    <span className="text-[10px] italic text-muted-foreground/70 px-1">
      keyframed
    </span>
  );
}
