// CropControl — the inspector's "Crop" widget for image + video. Label-left
// rows (matching the panel rhythm): a "Crop" summary row with a swatch that
// opens a FLY-OUT (modeled on the color picker) showing the media with a
// draggable / resizable crop frame, plus "Offset" and "Size" rows holding the
// numeric crop fields. Self-managed: reads the selected element + patches it
// directly (like GradeControl / ShapePresetControl).
//
// Writes the protocol crop_x / crop_y / crop_width / crop_height fields
// (normalized 0..1, origin top-left). The runtime applies the crop as a source
// sub-rectangle BEFORE `fit` (§5.3); identity (0,0,1,1) is a no-op.

'use client';

import { useEffect, useRef, useState } from 'react';
import type { Element } from '@clipkit/protocol';
import { useEditor, useEditorStore } from '@clipkit/editor-core';
import { NumberControl } from './primitives.js';
import { FieldRow } from '../frame/Section.js';

interface Crop {
  crop_x?: number;
  crop_y?: number;
  crop_width?: number;
  crop_height?: number;
}

const MIN = 0.02; // smallest crop edge, so the frame never collapses to a line

function num(v: unknown, d: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : d;
}
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

type Rect = { x: number; y: number; width: number; height: number };

export function CropControl() {
  const selId = useEditorStore((s) => s.selection[0]);
  const el = useEditorStore((s) => s.source.elements.find((e) => e.id === selId)) as
    | (Element & Crop & { source?: unknown })
    | undefined;
  const { updateElement, moveElements, pushHistory } = useEditor();
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  if (!el || !selId || (el.type !== 'image' && el.type !== 'video')) return null;

  const rect: Rect = {
    x: num(el.crop_x, 0),
    y: num(el.crop_y, 0),
    width: num(el.crop_width, 1),
    height: num(el.crop_height, 1),
  };
  const cropped = rect.x !== 0 || rect.y !== 0 || rect.width !== 1 || rect.height !== 1;
  const src = typeof el.source === 'string' ? el.source : null;
  const isVideo = el.type === 'video';

  // live=true → skip-history scrub write; live=false → committed edit.
  const patch = (r: Rect, live: boolean): void => {
    const p: Crop = { crop_x: r.x, crop_y: r.y, crop_width: r.width, crop_height: r.height };
    if (live) moveElements([{ id: selId, patch: p as Partial<Element> }], { skipHistory: true });
    else updateElement(selId, p as Partial<Element>);
  };
  const reset = (): void =>
    updateElement(selId, {
      crop_x: undefined, crop_y: undefined, crop_width: undefined, crop_height: undefined,
    } as Partial<Element>);

  // One numeric field (stored 0..1, shown as a percentage). Editing one edge
  // clamps it against the opposite so the rect stays valid.
  const field = (key: keyof Rect, glyph: string): React.ReactNode => {
    const set = (pct: number, live: boolean): void => {
      const v = clamp(pct / 100, 0, 1);
      const next: Rect = { ...rect };
      if (key === 'x') next.x = clamp(v, 0, 1 - rect.width);
      else if (key === 'y') next.y = clamp(v, 0, 1 - rect.height);
      else if (key === 'width') next.width = clamp(v, MIN, 1 - rect.x);
      else next.height = clamp(v, MIN, 1 - rect.y);
      patch(next, live);
    };
    return (
      <NumberControl
        value={Math.round(rect[key] * 100)}
        min={0}
        max={100}
        step={1}
        suffix="%"
        prefix={glyph}
        fluid
        onChange={set}
        onScrubStart={pushHistory}
      />
    );
  };

  return (
    <>
      <FieldRow label="Crop">
        <button
          ref={btnRef}
          type="button"
          aria-expanded={open}
          title="Edit crop frame"
          onClick={() => setOpen((o) => !o)}
          className="relative w-[18px] h-[18px] rounded border border-border overflow-hidden cursor-pointer shrink-0 bg-black/40"
        >
          <CropThumb src={src} isVideo={isVideo} rect={rect} />
        </button>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="h-6 flex-1 min-w-0 truncate bg-field hover:bg-field-hover rounded-md px-1.5 text-[11px] text-left text-foreground/90 outline-none transition-colors"
        >
          {cropped ? 'Cropped' : 'Edit frame'}
        </button>
        {cropped && (
          <button
            type="button"
            onClick={reset}
            title="Remove crop"
            className="h-6 px-1.5 rounded-md text-[10px] text-muted-foreground hover:text-foreground hover:bg-field transition-colors shrink-0"
          >
            Reset
          </button>
        )}
      </FieldRow>
      <FieldRow label="Offset">
        <div className="flex-1 grid grid-cols-2 gap-2 min-w-0">
          {field('x', 'X')}
          {field('y', 'Y')}
        </div>
      </FieldRow>
      <FieldRow label="Size">
        <div className="flex-1 grid grid-cols-2 gap-2 min-w-0">
          {field('width', 'W')}
          {field('height', 'H')}
        </div>
      </FieldRow>
      {open && btnRef.current && (
        <CropPopover
          anchor={btnRef.current}
          src={src}
          isVideo={isVideo}
          rect={rect}
          onChange={patch}
          onStart={pushHistory}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

// The fly-out — the media at its natural aspect with a draggable / resizable
// crop frame. Outside the frame is dimmed; the body moves, the four edge
// handles resize. Handles live in a NON-clipped layer so they read on the
// frame border even when the crop is flush with the media edge.
function CropPopover({
  anchor, src, isVideo, rect, onChange, onStart, onClose,
}: {
  anchor: HTMLElement;
  src: string | null;
  isVideo: boolean;
  rect: Rect;
  onChange: (r: Rect, live: boolean) => void;
  onStart: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [aspect, setAspect] = useState(16 / 9);

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
  const WIDTH = 260;
  const left = Math.max(8, r.left - WIDTH - 8);
  const top = Math.max(8, Math.min(r.top, window.innerHeight - 320));

  type Mode = 'move' | 'n' | 's' | 'e' | 'w';
  const startDrag = (mode: Mode) => (e: React.PointerEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    const box = boxRef.current;
    if (!box) return;
    const b = box.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY;
    const s = { ...rect };
    onStart();
    const onMove = (ev: PointerEvent): void => {
      const dx = (ev.clientX - sx) / b.width;
      const dy = (ev.clientY - sy) / b.height;
      let next: Rect;
      if (mode === 'move') {
        next = {
          x: clamp(s.x + dx, 0, 1 - s.width),
          y: clamp(s.y + dy, 0, 1 - s.height),
          width: s.width,
          height: s.height,
        };
      } else {
        let l = s.x, t = s.y, rr = s.x + s.width, bb = s.y + s.height;
        if (mode === 'w') l = clamp(s.x + dx, 0, rr - MIN);
        else if (mode === 'e') rr = clamp(s.x + s.width + dx, l + MIN, 1);
        else if (mode === 'n') t = clamp(s.y + dy, 0, bb - MIN);
        else bb = clamp(s.y + s.height + dy, t + MIN, 1);
        next = { x: l, y: t, width: rr - l, height: bb - t };
      }
      onChange(next, true);
    };
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const pctRect = {
    left: `${rect.x * 100}%`,
    top: `${rect.y * 100}%`,
    width: `${rect.width * 100}%`,
    height: `${rect.height * 100}%`,
  };
  // Edge handles — white bars centered on each edge midpoint, with a dark ring
  // so they read on any image. -translate centers them ON the border.
  const handle =
    'absolute bg-white border border-black/50 rounded-sm shadow-[0_0_0_1px_rgba(0,0,0,0.35)] -translate-x-1/2 -translate-y-1/2';

  // Rendered INLINE (not portaled) — same as the color picker — so theme tokens
  // resolve and `fixed` still escapes the inspector's scroll clip.
  return (
    <div
      ref={ref}
      className="fixed z-50 rounded-lg border bg-popover shadow-2xl p-2 flex flex-col gap-2 select-none"
      style={{ left, top, width: WIDTH, borderColor: 'var(--color-popover-border)' }}
      role="dialog"
      aria-label="Crop"
    >
      <div
        ref={boxRef}
        className="relative w-full rounded-md bg-[repeating-conic-gradient(#2a2a2a_0%_25%,#1d1d1d_0%_50%)] bg-[length:16px_16px] touch-none"
        style={{ aspectRatio: String(aspect) }}
      >
        {/* Media + dim — clipped to the rounded box so the image corners are
            crisp; the frame/handles layer above is NOT clipped. */}
        <div className="absolute inset-0 overflow-hidden rounded-md">
          {src && !isVideo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={src}
              alt=""
              draggable={false}
              onLoad={(e) => {
                const im = e.currentTarget;
                if (im.naturalWidth > 0 && im.naturalHeight > 0) setAspect(im.naturalWidth / im.naturalHeight);
              }}
              className="absolute inset-0 w-full h-full object-fill pointer-events-none"
            />
          )}
          {src && isVideo && (
            <video
              src={src}
              muted
              playsInline
              preload="metadata"
              onLoadedMetadata={(e) => {
                const v = e.currentTarget;
                if (v.videoWidth > 0 && v.videoHeight > 0) setAspect(v.videoWidth / v.videoHeight);
              }}
              className="absolute inset-0 w-full h-full object-fill pointer-events-none"
            />
          )}

          {/* Dim everything outside the crop frame (four bands). */}
          <div className="absolute inset-x-0 top-0 bg-black/55 pointer-events-none" style={{ height: pctRect.top }} />
          <div className="absolute inset-x-0 bottom-0 bg-black/55 pointer-events-none" style={{ top: `${(rect.y + rect.height) * 100}%` }} />
          <div className="absolute bg-black/55 pointer-events-none" style={{ left: 0, width: pctRect.left, top: pctRect.top, height: pctRect.height }} />
          <div className="absolute bg-black/55 pointer-events-none" style={{ right: 0, left: `${(rect.x + rect.width) * 100}%`, top: pctRect.top, height: pctRect.height }} />
        </div>

        {/* Frame + handles — not clipped, so handles sit on the border. */}
        <div
          className="absolute border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)] cursor-move"
          style={pctRect}
          onPointerDown={startDrag('move')}
        >
          {/* Rule-of-thirds guides. */}
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-1/3 inset-x-0 border-t border-white/25" />
            <div className="absolute top-2/3 inset-x-0 border-t border-white/25" />
            <div className="absolute left-1/3 inset-y-0 border-l border-white/25" />
            <div className="absolute left-2/3 inset-y-0 border-l border-white/25" />
          </div>
          {/* Mid-edge handles. */}
          <div className={`${handle} w-4 h-2 left-1/2 top-0 cursor-ns-resize`} onPointerDown={startDrag('n')} />
          <div className={`${handle} w-4 h-2 left-1/2 top-full cursor-ns-resize`} onPointerDown={startDrag('s')} />
          <div className={`${handle} w-2 h-4 left-0 top-1/2 cursor-ew-resize`} onPointerDown={startDrag('w')} />
          <div className={`${handle} w-2 h-4 left-full top-1/2 cursor-ew-resize`} onPointerDown={startDrag('e')} />
        </div>
      </div>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground tabular-nums">
        <span>{Math.round(rect.width * 100)}% × {Math.round(rect.height * 100)}%</span>
        <button
          type="button"
          onClick={() => onChange({ x: 0, y: 0, width: 1, height: 1 }, false)}
          className="hover:text-foreground transition-colors"
        >
          Reset
        </button>
      </div>
    </div>
  );
}

// The 18px panel swatch — the media with the crop region punched out of a dim
// overlay, so the row previews what's kept at a glance.
function CropThumb({ src, isVideo, rect }: { src: string | null; isVideo: boolean; rect: Rect }) {
  const frame = {
    left: `${rect.x * 100}%`,
    top: `${rect.y * 100}%`,
    width: `${rect.width * 100}%`,
    height: `${rect.height * 100}%`,
  };
  return (
    <>
      {src && !isVideo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" draggable={false} className="absolute inset-0 w-full h-full object-cover opacity-50" />
      )}
      {src && isVideo && (
        <video src={src} muted playsInline preload="metadata" className="absolute inset-0 w-full h-full object-cover opacity-50" />
      )}
      <span className="absolute border border-white/80 box-border" style={frame} />
    </>
  );
}
