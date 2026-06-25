// Shape presets shared by the inspector's shape selector (ShapePresetControl)
// and the add-bar's Shape dropdown. Rectangle/ellipse are SDF primitives; the
// rest are the shape's path form, each with a TIGHT bounding-box `view_box` so
// the geometry fills the element box (no inset).

import type { ReactElement } from 'react';
import type { ShapeElement } from '@clipkit/protocol';
import { cn } from './utils.js';

type Pt = [number, number];
const r0 = (n: number) => Math.round(n);
function geom(pts: Pt[]): { d: string; vb: [number, number, number, number] } {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const d = `M ${pts.map((p) => `${r0(p[0])} ${r0(p[1])}`).join(' L ')} Z`;
  return { d, vb: [r0(minX), r0(minY), r0(maxX - minX), r0(maxY - minY)] };
}
function polyPts(n: number, rotDeg = -90, r = 50): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = ((rotDeg + (i * 360) / n) * Math.PI) / 180;
    out.push([50 + r * Math.cos(a), 50 + r * Math.sin(a)]);
  }
  return out;
}
function starPts(points = 5, rotDeg = -90, ro = 50, ri = 23): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? ri : ro;
    const a = ((rotDeg + (i * 180) / points) * Math.PI) / 180;
    out.push([50 + r * Math.cos(a), 50 + r * Math.sin(a)]);
  }
  return out;
}
const ARROW: Pt[] = [[10, 38], [58, 38], [58, 20], [92, 50], [58, 80], [58, 62], [10, 62]];

export type ShapePreset = { id: string; label: string } & (
  | { form: 'rect'; radius: number }
  | { form: 'ellipse' }
  | { form: 'fill'; d: string; vb: [number, number, number, number] }
  | { form: 'stroke'; d: string; vb: [number, number, number, number] }
);

const fill = (pts: Pt[]) => geom(pts);
export const SHAPE_PRESETS: ShapePreset[] = [
  { id: 'rectangle', label: 'Rectangle', form: 'rect', radius: 0 },
  { id: 'rounded', label: 'Rounded', form: 'rect', radius: 32 },
  { id: 'ellipse', label: 'Ellipse', form: 'ellipse' },
  { id: 'triangle', label: 'Triangle', form: 'fill', ...fill(polyPts(3)) },
  { id: 'diamond', label: 'Diamond', form: 'fill', ...fill(polyPts(4)) },
  { id: 'pentagon', label: 'Pentagon', form: 'fill', ...fill(polyPts(5)) },
  { id: 'hexagon', label: 'Hexagon', form: 'fill', ...fill(polyPts(6, 0)) },
  { id: 'star', label: 'Star', form: 'fill', ...fill(starPts(5)) },
  { id: 'arrow', label: 'Arrow', form: 'fill', ...fill(ARROW) },
  { id: 'line', label: 'Line', form: 'stroke', d: 'M 0 50 L 100 50', vb: [0, 46.5, 100, 7] },
];

/** The shape-specific fields for a preset — primitive (`shape`) or path form. */
export function presetFields(p: ShapePreset, color: string): Partial<ShapeElement> {
  if (p.form === 'rect') return { shape: 'rectangle', border_radius: p.radius, fill_color: color, paths: undefined, view_box: undefined };
  if (p.form === 'ellipse') return { shape: 'ellipse', fill_color: color, paths: undefined, view_box: undefined };
  if (p.form === 'stroke') return { paths: [{ d: p.d, stroke: color, stroke_width: 7, stroke_linecap: 'round' }], view_box: p.vb, shape: undefined, border_radius: undefined };
  return { paths: [{ d: p.d, fill: color }], view_box: p.vb, shape: undefined, border_radius: undefined };
}

/** Detect a shape element's current preset id (by `shape` or matching path `d`). */
export function detectPreset(el: { shape?: string; border_radius?: unknown; paths?: Array<{ d?: unknown }> } | undefined): string {
  if (!el) return 'rectangle';
  const d = el.paths?.[0]?.d;
  if (typeof d === 'string') return SHAPE_PRESETS.find((p) => 'd' in p && p.d === d)?.id ?? 'rectangle';
  if (el.shape === 'ellipse') return 'ellipse';
  return typeof el.border_radius === 'number' && el.border_radius > 0 ? 'rounded' : 'rectangle';
}

// Hand-tuned icons on a 24 grid — crisp at small sizes (unlike the raw element
// geometry, which is built for a 100-unit viewBox).
const ICONS: Record<string, ReactElement> = {
  rectangle: <rect x="4" y="4" width="16" height="16" rx="2.5" />,
  rounded: <rect x="4" y="4" width="16" height="16" rx="6" />,
  ellipse: <ellipse cx="12" cy="12" rx="9" ry="6.5" />,
  triangle: <path d="M12 4 L20 19 L4 19 Z" />,
  diamond: <path d="M12 3 L21 12 L12 21 L3 12 Z" />,
  pentagon: <path d="M12 3 L20.6 9.2 L17.3 20 L6.7 20 L3.4 9.2 Z" />,
  hexagon: <path d="M8 3.8 L16 3.8 L21 12 L16 20.2 L8 20.2 L3 12 Z" />,
  star: <path d="M12 2.5 L14.5 9 L21.5 9.2 L16 13.5 L17.8 20.3 L12 16.3 L6.2 20.3 L8 13.5 L2.5 9.2 L9.5 9 Z" />,
  arrow: <path d="M3.5 12 H16 M11 6.5 L17 12 L11 17.5" />,
  line: <path d="M4 18 L20 6" />,
};

/** A clean designed icon for the preset (24 grid, stroked). */
export function PresetIcon({ p, className }: { p: ShapePreset; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" className={cn('shrink-0', className ?? 'size-4')}>
      {ICONS[p.id] ?? ICONS.rectangle}
    </svg>
  );
}
