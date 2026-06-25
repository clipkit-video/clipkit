// GradeControl — the inspector's "Color" widget. A compact summary row in the
// panel; clicking opens a FLY-OUT (like the color picker) with the grading
// controls so the narrow inspector stays scannable. Self-managed (reads the
// selected element + patches it directly, like ShapePresetControl).
//
// v1 writes the existing base filter fields (brightness / contrast / saturation
// / hue_rotate) — zero protocol change. Looks are named presets that expand to
// those same fields. (Tone via `levels` and LUT looks come next; true
// temperature/tint needs a protocol field and is intentionally absent.)

'use client';

import { useEffect, useRef, useState } from 'react';
import type { Element } from '@clipkit/protocol';
import { useEditor, useEditorStore } from '@clipkit/editor-core';
import { cn } from '../lib/utils.js';

interface Filters {
  brightness?: number;
  contrast?: number;
  saturation?: number;
  hue_rotate?: number;
}

// Named looks — expand to base filters (no new fields). "Original" resets.
const LOOKS: Array<{ id: string; label: string; f: Filters }> = [
  { id: 'original', label: 'Original', f: {} },
  { id: 'punch', label: 'Punch', f: { contrast: 1.18, saturation: 1.25 } },
  { id: 'vivid', label: 'Vivid', f: { brightness: 1.03, contrast: 1.1, saturation: 1.4 } },
  { id: 'faded', label: 'Faded', f: { brightness: 1.05, contrast: 0.85, saturation: 0.8 } },
  { id: 'bw', label: 'B&W', f: { saturation: 0, contrast: 1.1 } },
  { id: 'noir', label: 'Noir', f: { saturation: 0, contrast: 1.35, brightness: 0.95 } },
];

const FIELDS: Array<{ key: keyof Filters; label: string; min: number; max: number; def: number; unit: '%' | '°' }> = [
  { key: 'brightness', label: 'Brightness', min: 0, max: 2, def: 1, unit: '%' },
  { key: 'contrast', label: 'Contrast', min: 0, max: 2, def: 1, unit: '%' },
  { key: 'saturation', label: 'Saturation', min: 0, max: 2, def: 1, unit: '%' },
  { key: 'hue_rotate', label: 'Hue', min: -180, max: 180, def: 0, unit: '°' },
];

function num(v: unknown, d: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : d;
}

export function GradeControl() {
  const selId = useEditorStore((s) => s.selection[0]);
  const el = useEditorStore((s) => s.source.elements.find((e) => e.id === selId)) as
    | (Element & Filters)
    | undefined;
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  if (!el || !selId) return null;

  const f: Required<Filters> = {
    brightness: num(el.brightness, 1),
    contrast: num(el.contrast, 1),
    saturation: num(el.saturation, 1),
    hue_rotate: num(el.hue_rotate, 0),
  };
  const adjusted = f.brightness !== 1 || f.contrast !== 1 || f.saturation !== 1 || f.hue_rotate !== 0;

  // Preview on the element's own image when it is one; gradient reference otherwise.
  const src = (el as { source?: unknown }).source;
  const previewSrc = el.type === 'image' && typeof src === 'string' ? src : null;

  // Same shape as the color input (ColorControl): an 18px swatch + a field.
  return (
    <div className="flex items-center gap-1 w-full min-w-0">
      <button
        ref={btnRef}
        type="button"
        aria-expanded={open}
        title="Color grade"
        onClick={() => setOpen((o) => !o)}
        className="relative w-[18px] h-[18px] rounded border border-border overflow-hidden cursor-pointer shrink-0"
      >
        {/* Before/after split — left half neutral, right half graded. */}
        <GradeSwatch f={f} />
      </button>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="h-6 flex-1 min-w-0 truncate bg-field hover:bg-field-hover rounded-md px-1.5 text-[11px] text-left text-foreground/90 outline-none transition-colors"
      >
        {adjusted ? 'Adjusted' : 'Default'}
      </button>
      {open && btnRef.current && (
        <GradePopover selId={selId} anchor={btnRef.current} f={f} previewSrc={previewSrc} onClose={() => setOpen(false)} />
      )}
    </div>
  );
}

function GradePopover({
  selId,
  anchor,
  f,
  previewSrc,
  onClose,
}: {
  selId: string;
  anchor: HTMLElement;
  f: Required<Filters>;
  previewSrc: string | null;
  onClose: () => void;
}) {
  const { updateElement, moveElements, pushHistory } = useEditor();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent): void => {
      const t = e.target as Node;
      if (ref.current && !ref.current.contains(t) && !anchor.contains(t)) onClose();
    };
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [anchor, onClose]);

  // Open to the LEFT of the inspector (panel sits on the right edge).
  const r = anchor.getBoundingClientRect();
  const WIDTH = 252;
  const left = Math.max(8, r.left - WIDTH - 8);
  const top = Math.max(8, Math.min(r.top, window.innerHeight - 300));

  const patch = (p: Filters, live: boolean): void => {
    if (live) moveElements([{ id: selId, patch: p as Partial<Element> }], { skipHistory: true });
    else updateElement(selId, p as Partial<Element>);
  };
  const neutral: Filters = { brightness: undefined, contrast: undefined, saturation: undefined, hue_rotate: undefined };
  const applyLook = (lf: Filters): void => updateElement(selId, { ...neutral, ...lf } as Partial<Element>);

  // Rendered INLINE (not portaled) — same as the color picker — so the editor's
  // theme tokens resolve and `fixed` still escapes the inspector's scroll clip.
  return (
    <div
      ref={ref}
      className="fixed z-50 rounded-lg border bg-popover shadow-2xl p-2 flex flex-col gap-2.5 select-none"
      style={{ left, top, width: WIDTH, borderColor: 'var(--color-popover-border)' }}
    >
      {/* Looks */}
      <div>
        <div className="text-[9px] uppercase tracking-wide text-muted-foreground mb-1.5">Looks</div>
        <div className="grid grid-cols-3 gap-1">
          {LOOKS.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => applyLook(l.f)}
              className="h-10 rounded border border-border overflow-hidden relative hover:border-primary/60 transition-colors"
              title={l.label}
            >
              <Preview src={previewSrc} f={lookFilters(l.f)} />
              <span className="absolute inset-x-0 bottom-0 text-[8px] text-center bg-background/70 text-foreground/80 leading-[11px]">
                {l.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Adjust */}
      <div className="border-t border-border/50 pt-2 flex flex-col gap-1.5">
        {FIELDS.map((fld) => (
          <Slider
            key={fld.key}
            label={fld.label}
            value={f[fld.key]}
            min={fld.min}
            max={fld.max}
            step={fld.unit === '°' ? 1 : 0.01}
            unit={fld.unit}
            onStart={pushHistory}
            onLive={(v) => patch({ [fld.key]: v }, true)}
            onReset={() => patch({ [fld.key]: undefined }, false)}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={() => updateElement(selId, neutral as Partial<Element>)}
        className="text-[10px] text-muted-foreground hover:text-foreground transition-colors self-end"
      >
        Reset all
      </button>
    </div>
  );
}

function Slider({
  label, value, min, max, step, unit, onStart, onLive, onReset,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: '%' | '°';
  onStart: () => void;
  onLive: (v: number) => void;
  onReset: () => void;
}) {
  const display = unit === '°' ? `${Math.round(value)}°` : `${Math.round(value * 100)}%`;
  return (
    <div className="flex items-center gap-2">
      <span className="w-[68px] text-[10px] text-muted-foreground shrink-0">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onPointerDown={onStart}
        onChange={(e) => onLive(parseFloat(e.target.value))}
        className="flex-1 h-1 accent-primary cursor-pointer"
      />
      <button
        type="button"
        onDoubleClick={onReset}
        title="Double-click to reset"
        className="w-9 text-right text-[10px] tabular-nums text-foreground/80"
      >
        {display}
      </button>
    </div>
  );
}

// CSS filters are 1:1 with the protocol's brightness/contrast/saturation/
// hue_rotate, so this preview is ACCURATE to what the runtime renders.
function cssFilter(f: Required<Filters>): string {
  return `brightness(${f.brightness}) contrast(${f.contrast}) saturate(${f.saturation}) hue-rotate(${f.hue_rotate}deg)`;
}

// Reference used when the element has no image of its own — a spread of hues +
// tones so a look's character (warmth, punch, desaturation) reads clearly.
const REFERENCE =
  'linear-gradient(135deg, #102a43 0%, #2b6cb0 24%, #e0a23a 48%, #c05621 66%, #2f855a 84%, #e9e9e9 100%)';

// Panel swatch: a neutral warm tonal ramp (one hue family — not a rainbow),
// split before | after so the grade's shift reads. Neutral grade ⇒ the halves
// match ⇒ no visible split (an honest "Default" state).
const SWATCH_BASE = 'linear-gradient(180deg, #3f3933 0%, #cdc3b3 100%)';
function GradeSwatch({ f }: { f: Required<Filters> }) {
  return (
    <>
      <span className="absolute inset-y-0 left-0 w-1/2" style={{ background: SWATCH_BASE }} />
      <span
        className="absolute inset-y-0 right-0 w-1/2"
        style={{ background: SWATCH_BASE, filter: cssFilter(f) }}
      />
    </>
  );
}

/** A live preview of the grade, filling its (relative) container: the element's
 *  own image when it has one, else the reference gradient. */
function Preview({ src, f }: { src: string | null; f: Required<Filters> }) {
  const filter = cssFilter(f);
  return src ? (
    <img src={src} alt="" className="absolute inset-0 w-full h-full object-cover" style={{ filter }} />
  ) : (
    <span className="absolute inset-0" style={{ background: REFERENCE, filter }} />
  );
}

function lookFilters(f: Filters): Required<Filters> {
  return {
    brightness: f.brightness ?? 1,
    contrast: f.contrast ?? 1,
    saturation: f.saturation ?? 1,
    hue_rotate: f.hue_rotate ?? 0,
  };
}
