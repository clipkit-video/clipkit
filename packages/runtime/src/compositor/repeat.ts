// Walk-time normalization: generated sets (§3.7) and styles (§2.3).
//
// Generated sets — `repeat` (N identical copies) or `repeat_data` (one copy
// per row; the row is "a partial element patch + a variable scope"):
//   - row keys that name element fields patch the copy (time, duration,
//     text, fill_color, …; structural keys are blocked and rejected
//     protocol-side);
//   - every row key is also in scope for the copy AND its descendants —
//     in strings as `{key}` (with `{i}`/`{i1}` always available) and in
//     expressions as bare identifiers (numeric values only);
//   - group copies deep-clone their subtree so each copy's children carry
//     the copy's scope.
// Styles — an element's `style: "name"` merges the Source-level bundle
// UNDER the element's own fields (defaults < style < element). No cascade.
//
// Both are pure structural expansions: `template + rows ≡ element list` and
// `style + reference ≡ inlined fields` — two encodings of the same scene,
// like expr ≡ keyframes. Expansion returns the input array untouched (same
// reference) when nothing in it repeats or is styled.

import type { Element, Source } from '@clipkit/protocol';

type Row = Record<string, string | number>;
type Styles = NonNullable<Source['styles']>;
interface SetScope { i: number; n: number; vars?: Row }

const scopes = new WeakMap<object, SetScope>();
const NO_SET: SetScope = { i: 0, n: 1 };

/** The (i, n, row) expression scope for an element — (0, 1) outside a set. */
export function setScopeOf(el: object): SetScope {
  return scopes.get(el) ?? NO_SET;
}

const REPEATABLE = new Set<string>(['image', 'text', 'shape', 'group']);
// Structural keys a row may never patch (also rejected protocol-side).
const ROW_BLOCKED = new Set<string>(['id', 'type', 'layer', 'elements', 'repeat', 'repeat_data', 'repeat_stagger', 'style']);

function subst(s: string, i: number, vars?: Row): string {
  if (!s.includes('{')) return s;
  let out = s.replaceAll('{i}', String(i)).replaceAll('{i1}', String(i + 1));
  if (vars) for (const k of Object.keys(vars)) out = out.replaceAll(`{${k}}`, String(vars[k]));
  return out;
}

function mergeStyle(el: Element, styles: Styles | undefined): Element {
  const name = (el as { style?: string }).style;
  const patch = name && styles ? styles[name] : undefined;
  if (!patch) return el;
  const merged = { ...patch, ...el } as Element;
  // A merged wrapper must keep the original's set scope (i/n/row vars).
  const s = scopes.get(el);
  if (s) scopes.set(merged, s);
  return merged;
}

/** One copy of `el` for slot `i` of `n`: style-merged, row-patched, string-
 *  substituted, scope-registered — recursing into group children so the
 *  whole subtree shares the copy's scope. */
function makeCopy(el: Element, i: number, n: number, vars: Row | undefined, styles: Styles | undefined, patchRow: boolean): Element {
  // Style is merged here, once — cleared so downstream walks don't re-merge
  // into a fresh (scope-less) wrapper.
  const copy = { ...mergeStyle(el, styles), repeat: undefined, repeat_data: undefined, style: undefined } as Element & Record<string, unknown>;
  if (patchRow && vars) {
    for (const k of Object.keys(vars)) if (!ROW_BLOCKED.has(k)) copy[k] = vars[k];
  }
  if (el.id) copy.id = `${el.id}#${i}`;
  // {i}/{i1}/{row-key} placeholders substitute in every top-level
  // string field of the copy (text, source, colors, …) — identity and
  // reference keys excluded.
  for (const k of Object.keys(copy)) {
    const v = copy[k];
    if (typeof v === 'string' && k !== 'id' && k !== 'type' && k !== 'style') copy[k] = subst(v, i, vars);
  }
  // …and inside gradient stop colors (the one nested string surface).
  for (const gk of ['gradient', 'stroke_gradient'] as const) {
    const g = copy[gk] as { stops?: Array<{ color?: unknown }> } | undefined;
    if (g && Array.isArray(g.stops) && g.stops.some((st) => typeof st.color === 'string' && st.color.includes('{'))) {
      copy[gk] = { ...g, stops: g.stops.map((st) => (typeof st.color === 'string' ? { ...st, color: subst(st.color, i, vars) } : st)) };
    }
  }
  const children = (copy as { elements?: readonly Element[] }).elements;
  if (Array.isArray(children)) {
    (copy as { elements?: readonly Element[] }).elements = children.map((ch) => makeCopy(ch, i, n, vars, styles, false));
  }
  scopes.set(copy, { i, n, vars });
  return copy;
}

/**
 * Expand generated sets and merge styles across a walk list. The common
 * path (no repeat, no style anywhere) allocates nothing beyond the scan.
 */
export function normalizeWalk(elements: readonly Element[], styles: Styles | undefined): readonly Element[] {
  let out: Element[] | null = null;
  for (let idx = 0; idx < elements.length; idx++) {
    const el = elements[idx]!;
    const rows = (el as { repeat_data?: Row[] }).repeat_data;
    const rep = (el as { repeat?: number }).repeat;
    const count = REPEATABLE.has(el.type)
      ? Array.isArray(rows) ? Math.min(rows.length, 500) : typeof rep === 'number' && rep >= 2 ? Math.min(Math.floor(rep), 500) : 0
      : 0;
    const styled = (el as { style?: string }).style !== undefined && styles !== undefined;

    if (count === 0 && !styled) {
      if (out) out.push(el);
      continue;
    }
    if (!out) out = elements.slice(0, idx);

    if (count === 0) {
      out.push(mergeStyle(el, styles));
      continue;
    }
    const stagger = (el as { repeat_stagger?: number }).repeat_stagger ?? 0;
    const baseTime = typeof el.time === 'number' ? el.time : el.time === undefined ? 0 : null;
    for (let i = 0; i < count; i++) {
      const vars = rows?.[i];
      const copy = makeCopy(el, i, count, vars, styles, true);
      // Stagger applies unless the row set the copy's time outright.
      if (stagger > 0 && baseTime !== null && (vars === undefined || vars.time === undefined)) {
        copy.time = baseTime + i * stagger;
      }
      out.push(copy);
    }
  }
  return out ?? elements;
}

/** Back-compat alias for the pre-styles name. */
export const expandRepeats = (elements: readonly Element[]): readonly Element[] => normalizeWalk(elements, undefined);
