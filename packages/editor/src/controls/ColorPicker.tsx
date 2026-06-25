// ColorPicker popover (ruled by Ian 2026-06-12) — opens from any
// color swatch. Layout per spec: SV box → hue slider + eyedropper →
// alpha slider + alpha % → format dropdown + value field → two rows
// of swatches harvested from the document.
//
// Colors stay PROTOCOL-LITERAL hex strings: #rrggbb, or #rrggbbaa
// when alpha < 100% (the schema's color format). Drags ride the
// standard one-undo-step contract when scrub handlers are provided.

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Source } from '@clipkit/protocol';
import { useEditorStore } from '@clipkit/editor-core';
import { cn } from '../lib/utils.js';

// ── Color math ──────────────────────────────────────────────────────

export interface Rgba {
  r: number; // 0..255
  g: number;
  b: number;
  a: number; // 0..1
}

export function parseHexColor(hex: string): Rgba | null {
  const m = /^#([0-9a-fA-F]{3,8})$/.exec(hex.trim());
  if (!m) return null;
  let h = m[1]!;
  if (h.length === 3 || h.length === 4) {
    h = [...h].map((c) => c + c).join('');
  }
  if (h.length !== 6 && h.length !== 8) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
    a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
  };
}

export function toHexColor({ r, g, b, a }: Rgba): string {
  const c = (n: number): string =>
    Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');
  const base = `#${c(r)}${c(g)}${c(b)}`;
  return a >= 0.999 ? base : `${base}${c(a * 255)}`;
}

interface Hsv {
  h: number; // 0..360
  s: number; // 0..1
  v: number; // 0..1
}

function rgbToHsv(r: number, g: number, b: number): Hsv {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === rn) h = 60 * (((gn - bn) / d) % 6);
    else if (max === gn) h = 60 * ((bn - rn) / d + 2);
    else h = 60 * ((rn - gn) / d + 4);
  }
  if (h < 0) h += 360;
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

function hsvToRgb({ h, s, v }: Hsv): { r: number; g: number; b: number } {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let rp = 0;
  let gp = 0;
  let bp = 0;
  if (h < 60) [rp, gp, bp] = [c, x, 0];
  else if (h < 120) [rp, gp, bp] = [x, c, 0];
  else if (h < 180) [rp, gp, bp] = [0, c, x];
  else if (h < 240) [rp, gp, bp] = [0, x, c];
  else if (h < 300) [rp, gp, bp] = [x, 0, c];
  else [rp, gp, bp] = [c, 0, x];
  return { r: (rp + m) * 255, g: (gp + m) * 255, b: (bp + m) * 255 };
}

// ── Document color harvesting ───────────────────────────────────────

function collectDocumentColors(source: Source): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (
          typeof v === 'string' &&
          /^#[0-9a-fA-F]{3,8}$/.test(v) &&
          (k === 'color' || k.endsWith('color'))
        ) {
          const key = v.toLowerCase();
          if (!seen.has(key)) {
            seen.add(key);
            out.push(v);
          }
        } else if (v && typeof v === 'object') {
          visit(v);
        }
      }
    }
  };
  visit(source);
  return out.slice(0, 16); // two rows of eight
}

// ── Shared drag helper ──────────────────────────────────────────────

function useSliderDrag(
  onMove: (fx: number, fy: number) => void,
  onStart?: () => void,
  onEnd?: () => void,
) {
  return (e: React.PointerEvent<HTMLDivElement>): void => {
    e.preventDefault();
    const el = e.currentTarget;
    onStart?.();
    const apply = (clientX: number, clientY: number): void => {
      const r = el.getBoundingClientRect();
      onMove(
        Math.min(1, Math.max(0, (clientX - r.left) / r.width)),
        Math.min(1, Math.max(0, (clientY - r.top) / r.height)),
      );
    };
    apply(e.clientX, e.clientY);
    const move = (ev: PointerEvent): void => apply(ev.clientX, ev.clientY);
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      onEnd?.();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
}

const CHECKER =
  'repeating-conic-gradient(rgba(255,255,255,0.18) 0% 25%, transparent 0% 50%) 0 0 / 10px 10px';

// ── The popover ─────────────────────────────────────────────────────

const WIDTH = 232;

export function ColorPickerPopover({
  anchor,
  value,
  onChange,
  onClose,
  onScrubStart,
  onScrubEnd,
}: {
  anchor: HTMLElement;
  value: string;
  onChange: (next: string, live?: boolean) => void;
  onClose: () => void;
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
}) {
  const source = useEditorStore((s) => s.source);
  const ref = useRef<HTMLDivElement>(null);

  // HSV is the editing model (keeps hue stable at s=0 / v=0); the hex
  // prop re-syncs it only when it genuinely diverges (external edits).
  const [hsv, setHsv] = useState<Hsv>(() => {
    const rgb = parseHexColor(value) ?? { r: 255, g: 255, b: 255, a: 1 };
    return rgbToHsv(rgb.r, rgb.g, rgb.b);
  });
  const [alpha, setAlpha] = useState(() => parseHexColor(value)?.a ?? 1);
  const [format, setFormat] = useState<'hex' | 'rgb' | 'hsl'>('hex');
  const [draft, setDraft] = useState<string | null>(null);
  const [alphaDraft, setAlphaDraft] = useState<string | null>(null);
  const draggingRef = useRef(false);

  const current = useMemo(() => {
    const rgb = hsvToRgb(hsv);
    return toHexColor({ ...rgb, a: alpha });
  }, [hsv, alpha]);

  useEffect(() => {
    if (draggingRef.current) return;
    const rgb = parseHexColor(value);
    if (!rgb) return;
    if (toHexColor(rgb).toLowerCase() === current.toLowerCase()) return;
    setHsv(rgbToHsv(rgb.r, rgb.g, rgb.b));
    setAlpha(rgb.a);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Position: below the anchor, clamped to the viewport.
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    const r = anchor.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const height = 330; // approximate; clamped below
    const left = Math.min(Math.max(8, r.left), vw - WIDTH - 8);
    const top = r.bottom + 6 + height > vh ? Math.max(8, r.top - height - 6) : r.bottom + 6;
    setPos({ left, top });
  }, [anchor]);

  // Close on outside pointerdown / Escape.
  useEffect(() => {
    const down = (e: PointerEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node) && e.target !== anchor && !anchor.contains(e.target as Node)) {
        onClose();
      }
    };
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key);
    };
  }, [anchor, onClose]);

  const emit = (next: Hsv, nextAlpha: number, live: boolean): void => {
    const rgb = hsvToRgb(next);
    onChange(toHexColor({ ...rgb, a: nextAlpha }), live);
  };

  const startDrag = (): void => {
    draggingRef.current = true;
    onScrubStart?.();
  };
  const endDrag = (): void => {
    draggingRef.current = false;
    onScrubEnd?.();
    // Commit the final value (non-live) so the edit is one undo step.
    emit(hsvRef.current, alphaRef.current, false);
  };
  // Refs mirror state for the end-of-drag commit.
  const hsvRef = useRef(hsv);
  hsvRef.current = hsv;
  const alphaRef = useRef(alpha);
  alphaRef.current = alpha;

  const onSvDown = useSliderDrag(
    (fx, fy) => {
      const next = { ...hsvRef.current, s: fx, v: 1 - fy };
      setHsv(next);
      emit(next, alphaRef.current, true);
    },
    startDrag,
    endDrag,
  );
  const onHueDown = useSliderDrag(
    (fx) => {
      const next = { ...hsvRef.current, h: Math.min(359.9, fx * 360) };
      setHsv(next);
      emit(next, alphaRef.current, true);
    },
    startDrag,
    endDrag,
  );
  const onAlphaDown = useSliderDrag(
    (fx) => {
      const a = Math.round(fx * 100) / 100;
      setAlpha(a);
      emit(hsvRef.current, a, true);
    },
    startDrag,
    endDrag,
  );

  const commitAlphaText = (raw: string): void => {
    setAlphaDraft(null);
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n)) return;
    const a = Math.min(100, Math.max(0, n)) / 100;
    setAlpha(a);
    emit(hsvRef.current, a, false);
  };

  const pickEyedropper = async (): Promise<void> => {
    const ED = (window as unknown as { EyeDropper?: new () => { open(): Promise<{ sRGBHex: string }> } }).EyeDropper;
    if (!ED) return;
    try {
      const result = await new ED().open();
      const rgb = parseHexColor(result.sRGBHex);
      if (rgb) {
        setHsv(rgbToHsv(rgb.r, rgb.g, rgb.b));
        onChange(toHexColor({ ...rgb, a: alphaRef.current }), false);
      }
    } catch {
      /* user cancelled */
    }
  };

  const hasEyedropper =
    typeof window !== 'undefined' && 'EyeDropper' in window;

  // Format display + parse.
  const rgbNow = hsvToRgb(hsv);
  const formatted = (() => {
    if (format === 'hex') return current;
    const r = Math.round(rgbNow.r);
    const g = Math.round(rgbNow.g);
    const b = Math.round(rgbNow.b);
    if (format === 'rgb') return `${r}, ${g}, ${b}`;
    // hsl
    const l = hsv.v * (1 - hsv.s / 2);
    const sl = l === 0 || l === 1 ? 0 : (hsv.v - l) / Math.min(l, 1 - l);
    return `${Math.round(hsv.h)}, ${Math.round(sl * 100)}%, ${Math.round(l * 100)}%`;
  })();

  const commitText = (raw: string): void => {
    setDraft(null);
    const t = raw.trim();
    if (format === 'hex') {
      const rgb = parseHexColor(t.startsWith('#') ? t : `#${t}`);
      if (rgb) {
        setHsv(rgbToHsv(rgb.r, rgb.g, rgb.b));
        setAlpha(rgb.a);
        onChange(toHexColor(rgb), false);
      }
      return;
    }
    const nums = t.match(/-?\d*\.?\d+/g)?.map(Number);
    if (!nums || nums.length < 3 || nums.some((n) => !Number.isFinite(n))) return;
    if (format === 'rgb') {
      const rgb = { r: nums[0]!, g: nums[1]!, b: nums[2]!, a: alpha };
      setHsv(rgbToHsv(rgb.r, rgb.g, rgb.b));
      onChange(toHexColor(rgb), false);
    } else {
      // hsl → rgb
      const h = ((nums[0]! % 360) + 360) % 360;
      const sl = Math.min(1, Math.max(0, nums[1]! / 100));
      const l = Math.min(1, Math.max(0, nums[2]! / 100));
      const v = l + sl * Math.min(l, 1 - l);
      const s = v === 0 ? 0 : 2 * (1 - l / v);
      const next = { h, s, v };
      setHsv(next);
      emit(next, alpha, false);
    }
  };

  // Harvested ONCE when the popover opens (useState initializer). If
  // we recomputed on every edit, applying a swatch would rewrite the
  // document and re-dedupe the list in a new order — the swatches
  // would shuffle under the cursor. A stable snapshot stays put.
  const [docColors] = useState(() => collectDocumentColors(source));

  if (!pos) return null;
  const hueColor = toHexColor({ ...hsvToRgb({ h: hsv.h, s: 1, v: 1 }), a: 1 });
  const opaque = toHexColor({ ...rgbNow, a: 1 });

  return (
    <div
      ref={ref}
      className="fixed z-50 rounded-lg border bg-popover shadow-2xl p-2 flex flex-col gap-2 select-none"
      style={{
        left: pos.left,
        top: pos.top,
        width: WIDTH,
        borderColor: 'var(--color-popover-border)',
      }}
      role="dialog"
      aria-label="Color picker"
    >
      {/* SV box. */}
      <div
        className="relative h-32 rounded-md cursor-crosshair touch-none"
        style={{
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hueColor})`,
        }}
        onPointerDown={onSvDown}
      >
        <div
          className="absolute w-3 h-3 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.6)] -translate-x-1/2 -translate-y-1/2 pointer-events-none"
          style={{
            left: `${hsv.s * 100}%`,
            top: `${(1 - hsv.v) * 100}%`,
            background: opaque,
          }}
        />
      </div>

      {/* Hue + eyedropper. */}
      <div className="flex items-center gap-2">
        <div
          className="relative flex-1 h-3 rounded-full cursor-ew-resize touch-none"
          style={{
            background:
              'linear-gradient(90deg, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)',
          }}
          onPointerDown={onHueDown}
        >
          <div
            className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.6)] pointer-events-none"
            // Inset travel by the thumb width so the knob stays fully
            // inside the track at both ends (no overhang past the edge).
            style={{ left: `calc(${hsv.h / 360} * (100% - 14px))`, background: hueColor }}
          />
        </div>
        {hasEyedropper && (
          <button
            type="button"
            className="w-7 h-7 grid place-items-center rounded-md bg-field hover:bg-field-hover text-muted-foreground hover:text-foreground transition-colors shrink-0"
            title="Pick a color from the screen"
            aria-label="Eyedropper"
            onClick={() => void pickEyedropper()}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M13.7 2.3a2 2 0 0 0-2.83 0l-1.6 1.6-.59-.58L7.27 4.73l.58.59-4.6 4.6a1 1 0 0 0-.25.41l-.7 2.32a.5.5 0 0 0 .62.62l2.32-.7a1 1 0 0 0 .41-.24l4.6-4.61.59.58 1.41-1.41-.58-.59 1.6-1.6a2 2 0 0 0 0-2.82ZM8.83 6.93l-4.36 4.36-1.06.32.32-1.06 4.36-4.36.74.74Z"
                fill="currentColor"
              />
            </svg>
          </button>
        )}
      </div>

      {/* Alpha + editable %. */}
      <div className="flex items-center gap-2">
        <div
          className="relative flex-1 h-3 cursor-ew-resize touch-none"
          onPointerDown={onAlphaDown}
        >
          {/* The TRACK clips to its rounded shape; the THUMB lives in
              the unclipped wrapper so it never gets cut off at 0/100%. */}
          <div className="absolute inset-0 rounded-full overflow-hidden">
            <div className="absolute inset-0" style={{ background: CHECKER }} />
            <div
              className="absolute inset-0"
              style={{ background: `linear-gradient(90deg, transparent, ${opaque})` }}
            />
          </div>
          <div
            className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.6)] pointer-events-none"
            style={{ left: `calc(${alpha} * (100% - 14px))`, background: current }}
          />
        </div>
        <input
          className="h-6 w-12 ml-1 shrink-0 bg-field hover:bg-field-hover focus:ring-1 focus:ring-ring rounded-md px-1 text-[11px] font-mono tabular-nums text-foreground/90 text-right outline-none transition-colors"
          value={alphaDraft ?? `${Math.round(alpha * 100)}`}
          aria-label="Opacity percent"
          inputMode="numeric"
          onChange={(e) => {
            if (/^\d{0,3}$/.test(e.target.value)) setAlphaDraft(e.target.value);
          }}
          onBlur={(e) => {
            if (alphaDraft !== null) commitAlphaText(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') {
              setAlphaDraft(null);
              (e.target as HTMLInputElement).blur();
            }
            e.stopPropagation();
          }}
          spellCheck={false}
        />
      </div>

      {/* Format + value. */}
      <div className="flex items-center gap-2">
        <select
          className="h-6 w-14 shrink-0 bg-field hover:bg-field-hover rounded-md px-1 text-[11px] text-foreground outline-none cursor-pointer transition-colors uppercase"
          value={format}
          onChange={(e) => setFormat(e.target.value as 'hex' | 'rgb' | 'hsl')}
        >
          <option value="hex">Hex</option>
          <option value="rgb">RGB</option>
          <option value="hsl">HSL</option>
        </select>
        <input
          className="h-6 flex-1 min-w-0 bg-field hover:bg-field-hover focus:ring-1 focus:ring-ring rounded-md px-1.5 text-[11px] font-mono text-foreground/90 outline-none transition-colors"
          value={draft ?? formatted}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => draft !== null && commitText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') {
              setDraft(null);
              (e.target as HTMLInputElement).blur();
            }
            e.stopPropagation(); // keep Escape-from-input from closing
          }}
          spellCheck={false}
        />
      </div>

      {/* Document colors — two rows. */}
      {docColors.length > 0 && (
        <div className="flex flex-col gap-1 pt-0.5">
          <span className="text-[10px] text-muted-foreground/70">Current colors</span>
          <div className="grid grid-cols-8 gap-1">
          {docColors.map((c) => (
            <button
              key={c}
              type="button"
              className={cn(
                'relative h-5 rounded border overflow-hidden transition-transform hover:scale-110',
                c.toLowerCase() === current.toLowerCase()
                  ? 'border-foreground'
                  : 'border-border/60',
              )}
              title={c}
              aria-label={`Use ${c}`}
              onClick={() => {
                const rgb = parseHexColor(c);
                if (!rgb) return;
                setHsv(rgbToHsv(rgb.r, rgb.g, rgb.b));
                setAlpha(rgb.a);
                onChange(toHexColor(rgb), false);
              }}
            >
              <span className="absolute inset-0" style={{ background: CHECKER }} />
              <span className="absolute inset-0" style={{ background: c }} />
            </button>
          ))}
          </div>
        </div>
      )}
    </div>
  );
}
