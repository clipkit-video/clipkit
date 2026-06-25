// The default knob for an animatable numeric / length property.
//
// Layout:  [ label ]   [ inputinput…  unit▾ ]   [ ◆ ]
//                       └─ the dropdown is PART of the input well (right segment,
//                          rounded, looks continuous). It picks the input TYPE:
//                          px / %  (units) or  Expression. NEVER keyframes.
// The plain label scrubs on drag. The keyframe diamond is its own affordance and
// shows in value mode (hidden for expressions) — keyframing is the diamond, not a
// dropdown option.
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Element } from '@clipkit/protocol';
import { elementTime, useEditor, useEditorContext, useEditorStore, type FieldSpec } from '@clipkit/editor-core';
import { compileExpr } from '@clipkit/runtime';
import { findElementById, sampleAnimation, setKeyframeValueAt } from '../lib/keyframes.js';
import { KeyframeDiamond } from './KeyframeDiamond.js';
import { cn } from '../lib/utils.js';

const UNITS = ['px', '%'] as const; // the units we actually read in the editor

const isExprVal = (v: unknown): v is { expr: string } =>
  typeof v === 'object' && v !== null && typeof (v as { expr?: unknown }).expr === 'string';

/** Split a length value into number + unit ("50%" → {n:50,u:'%'}, 100 → {n:100,u:'px'}). */
function splitLen(v: unknown): { n: number; u: string } {
  if (typeof v === 'number') return { n: v, u: 'px' };
  if (typeof v === 'string') {
    const m = /^(-?\d*\.?\d+)\s*(px|%)?$/.exec(v.trim());
    if (m) return { n: parseFloat(m[1]!), u: m[2] ?? 'px' };
    const num = parseFloat(v);
    if (Number.isFinite(num)) return { n: num, u: 'px' };
  }
  return { n: 0, u: 'px' };
}
const joinLen = (n: number, u: string): number | string => (u === 'px' ? n : `${n}${u}`);

export function ValueField({
  spec,
  value,
  elementId,
  animated,
  onScrubStart,
  onScrubEnd,
}: {
  spec: FieldSpec;
  value: unknown;
  elementId: string | null;
  animated: boolean;
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
}) {
  const { store } = useEditorContext();
  const actions = useEditor();
  const path = spec.path;
  const hasUnits = spec.control === 'length';
  const isPercent = spec.control === 'percent';
  const isExpr = isExprVal(value);

  // Sampled value at the playhead (when keyframed).
  const sampled = useEditorStore((s) => {
    if (!animated || !elementId) return undefined;
    const el = findElementById(s.source.elements, elementId);
    const anim = el?.keyframe_animations?.find((a) => a.property === path);
    if (!el || !anim) return undefined;
    const v = sampleAnimation(anim, Math.max(0, s.playback.time - elementTime(el)));
    return Array.isArray(v) ? undefined : v;
  });

  const shown = sampled !== undefined ? sampled : value;
  const curUnit = hasUnits ? splitLen(shown).u : 'px';
  const asNumber = (): number =>
    typeof shown === 'number' ? shown
      : typeof shown === 'string' ? splitLen(shown).n
      : isExprVal(shown) ? (parseFloat(shown.expr) || 0)
      : 0;

  // ── write the VALUE (keyframe-aware: write the keyframe when animated) ───────
  const writeValue = (v: number | string, live: boolean): void => {
    if (!elementId) return;
    if (animated) {
      const st = store.getState();
      const el = findElementById(st.source.elements, elementId);
      const anims = el?.keyframe_animations ?? [];
      const ai = anims.findIndex((a) => a.property === path);
      if (el && ai >= 0) {
        const local = Math.round(Math.max(0, st.playback.time - elementTime(el)) * 1000) / 1000;
        const patch = { keyframe_animations: setKeyframeValueAt(anims, ai, local, v) } as Partial<Element>;
        if (live) actions.moveElements([{ id: elementId, patch }], { skipHistory: true });
        else actions.updateElement(elementId, patch);
        return;
      }
    }
    const patch = { [path]: v } as Partial<Element>;
    if (live) actions.moveElements([{ id: elementId, patch }], { skipHistory: true });
    else actions.updateElement(elementId, patch);
  };

  // ── dropdown: pick the input TYPE (unit, or Expression) ─────────────────────
  const toValue = (unit: string): void => {
    if (!elementId) return;
    const num = asNumber();
    actions.updateElement(elementId, { [path]: hasUnits ? joinLen(num, unit) : num } as Partial<Element>);
  };
  const toExpression = (): void => {
    if (!elementId) return;
    const st = store.getState();
    const el = findElementById(st.source.elements, elementId);
    const anims = (el?.keyframe_animations ?? []).filter((a) => a.property !== path);
    actions.updateElement(elementId, { keyframe_animations: anims, [path]: { expr: String(asNumber()) } } as Partial<Element>);
  };

  // ── label scrub (drag the LABEL; number tracks live) ────────────────────────
  const drag = useRef<{ x: number; v: number; on: boolean } | null>(null);
  const labelScrub = !isExpr ? {
    onPointerDown: (e: React.PointerEvent) => { drag.current = { x: e.clientX, v: asNumber(), on: false }; e.currentTarget.setPointerCapture(e.pointerId); },
    onPointerMove: (e: React.PointerEvent) => {
      const d = drag.current; if (!d) return;
      const dx = e.clientX - d.x;
      if (!d.on && Math.abs(dx) < 3) return;
      if (!d.on) { d.on = true; onScrubStart?.(); }
      const step = spec.step ?? 1;
      const next = Math.round((d.v + (dx / 2) * step) / step) * step;
      writeValue(hasUnits ? joinLen(next, curUnit) : next, true);
    },
    onPointerUp: () => { if (drag.current?.on) onScrubEnd?.(); drag.current = null; },
  } : {};

  // ── input + dropdown well ────────────────────────────────────────────────────
  const [text, setText] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const inputCls = 'flex-1 min-w-0 w-full bg-transparent text-[11px] font-mono tabular-nums text-foreground/90 outline-none px-1.5';

  // the dropdown button label: current unit, or "fx" in expression mode
  const token = isExpr ? 'fx' : hasUnits ? curUnit : isPercent ? '%' : '';
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const openMenu = (): void => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, right: Math.max(4, window.innerWidth - r.right) });
    setMenu((m) => !m);
  };
  const dropdown = (
    <div className="shrink-0 self-stretch flex">
      <button
        ref={btnRef}
        type="button"
        onClick={openMenu}
        className="flex items-center gap-0.5 pl-1.5 pr-1 border-l border-border/60 text-[10px] text-muted-foreground hover:text-foreground hover:bg-field-hover rounded-r-md transition-colors"
        title="px / % / expression"
      >
        {token && <span className="tabular-nums">{token}</span>}
        <svg width="7" height="7" viewBox="0 0 8 8" className="opacity-60"><path d="M1 2.5 4 5.5 7 2.5" stroke="currentColor" fill="none" strokeWidth="1.2" /></svg>
      </button>
      {menu && pos && createPortal(
        <>
          <div className="fixed inset-0 z-[60]" onPointerDown={() => setMenu(false)} />
          <div className="fixed z-[61] w-28 rounded-md border border-border bg-popover shadow-md py-1 text-[11px]" style={{ top: pos.top, right: pos.right }}>
            {(hasUnits ? UNITS : (['value'] as const)).map((u) => (
              <button key={u} type="button" onClick={() => { toValue(u === 'value' ? 'px' : u); setMenu(false); }}
                className={cn('w-full text-left px-2 py-1 hover:bg-field-hover', !isExpr && (u === 'value' || u === curUnit) && 'text-primary')}>
                {u === 'value' ? 'Value' : u}
              </button>
            ))}
            <div className="my-1 border-t border-border" />
            <button type="button" onClick={() => { toExpression(); setMenu(false); }}
              className={cn('w-full text-left px-2 py-1 hover:bg-field-hover', isExpr && 'text-primary')}>
              Expression
            </button>
          </div>
        </>,
        document.body,
      )}
    </div>
  );

  let well: React.ReactNode;
  if (isExpr) {
    const exprStr = isExprVal(value) ? value.expr : '';
    const valid = exprStr.trim() === '' || compileExpr(exprStr) !== null;
    well = (
      <div className="h-6 flex items-center bg-field hover:bg-field-hover focus-within:ring-1 focus-within:ring-ring rounded-md transition-colors flex-1 min-w-0">
        <span className={cn('text-[10px] shrink-0 pl-1.5', valid ? 'text-green-500' : 'text-red-500')} title={valid ? 'valid' : 'parse error'}>●</span>
        <input
          className={cn(inputCls, 'text-left')}
          spellCheck={false}
          placeholder="960 + sin(t*PI)*40"
          value={text ?? exprStr}
          onChange={(e) => { setText(e.target.value); if (elementId) actions.moveElements([{ id: elementId, patch: { [path]: { expr: e.target.value } } as Partial<Element> }], { skipHistory: true }); }}
          onBlur={(e) => { if (elementId) actions.updateElement(elementId, { [path]: { expr: e.target.value } } as Partial<Element>); setText(null); }}
        />
        {dropdown}
      </div>
    );
  } else {
    const { n } = splitLen(shown);
    const display = text ?? String(Math.round(n * 1000) / 1000);
    well = (
      <div className="h-6 flex items-center bg-field hover:bg-field-hover focus-within:ring-1 focus-within:ring-ring rounded-md transition-colors flex-1 min-w-0">
        <input
          className={cn(inputCls, 'text-right')}
          inputMode="decimal"
          value={display}
          onChange={(e) => { if (/^-?\d*\.?\d*$/.test(e.target.value)) setText(e.target.value); }}
          onFocus={() => setText(String(n))}
          onBlur={(e) => { const p = parseFloat(e.target.value); if (Number.isFinite(p)) writeValue(hasUnits ? joinLen(p, curUnit) : p, false); setText(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setText(null); (e.target as HTMLInputElement).blur(); } }}
        />
        {dropdown}
      </div>
    );
  }

  // ── row: label · input-with-dropdown · keyframe diamond (value mode only) ────
  return (
    <div className="flex items-center gap-2 h-8">
      <span
        className={cn('w-16 shrink-0 text-[11px] text-muted-foreground truncate select-none', !isExpr && 'cursor-ew-resize')}
        {...labelScrub}
        title={!isExpr ? 'drag to scrub' : undefined}
      >
        {spec.label}
      </span>
      <div className="flex-1 flex items-center gap-1 min-w-0">
        {well}
        {!isExpr && spec.animatable && elementId ? (
          <KeyframeDiamond elementId={elementId} property={path} animated={animated} current={shown} />
        ) : null}
      </div>
    </div>
  );
}
