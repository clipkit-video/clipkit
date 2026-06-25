// Layers tree (EDITORS B8) — the document's element structure as a
// flat-style tree: nesting via group expansion, rename (double-click),
// visibility (the protocol's `visible` field — a DOCUMENT knob),
// paint-order reorder (▲▼ swap `layer` values — the protocol's actual
// ordering mechanism; same-layer pairs swap array positions), and
// group / ungroup. Grouping wraps the selection in a COORDINATE-
// IDENTITY group (x 0, y 0, anchors 0, time 0) so children render
// byte-identically; ungroup is enabled ONLY when that exact inverse
// holds — the tree never silently moves pixels.

'use client';

import { useMemo, useState } from 'react';
import type { Element, GroupElement, Source } from '@clipkit/protocol';
import {
  elementLayer,
  useEditor,
  useEditorStore,
} from '@clipkit/editor-core';
import {
  Type, Square, Image as ImageIcon, Film, Music, Folder, Captions, Sparkles,
  PenTool, Eye, EyeOff, ChevronUp, ChevronDown, Ungroup, Group,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '../lib/utils.js';

const TYPE_ICON: Record<string, LucideIcon> = {
  text: Type, shape: Square, image: ImageIcon, video: Film, audio: Music,
  group: Folder, caption: Captions, particles: Sparkles, svg: PenTool,
};

export function LayersTree() {
  const actions = useEditor();
  const source = useEditorStore((s) => s.source);
  const selection = useEditorStore((s) => s.selection);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [renaming, setRenaming] = useState<string | null>(null);

  // Topmost first: layer ascending (layer 1 = front/on top), array order as tiebreak.
  const top = useMemo(
    () =>
      [...source.elements].sort(
        (a, b) =>
          elementLayer(a) - elementLayer(b) ||
          source.elements.indexOf(a) - source.elements.indexOf(b),
      ),
    [source],
  );

  const writeElements = (next: Element[]): void =>
    actions.patchSource({ elements: next });

  // ── Reorder: swap the paint-order carriers of two elements ────────
  const swapPaint = (a: Element, b: Element): void => {
    // Layers are unique per container, so a and b always differ — swap their
    // layer values. (No array-position fallback: there are no layer ties.)
    const la = elementLayer(a);
    const lb = elementLayer(b);
    const next = source.elements.map((el) =>
      el === a ? { ...el, layer: lb } : el === b ? { ...el, layer: la } : el,
    );
    writeElements(next as Element[]);
  };

  // ── Group / ungroup ────────────────────────────────────────────────
  const selectedTop = top.filter((el) => el.id && selection.includes(el.id));
  const canGroup = selectedTop.length >= 2;

  const groupSelection = (): void => {
    if (!canGroup) return;
    const ids = new Set(selectedTop.map((el) => el.id));
    const children = source.elements.filter((el) => el.id && ids.has(el.id));
    const rest = source.elements.filter((el) => !el.id || !ids.has(el.id));
    const group: GroupElement = {
      type: 'group',
      id: `group-${Date.now().toString(36)}`,
      // Coordinate identity: local space == composition space, child
      // times stay absolute. Children render byte-identically.
      x: 0, y: 0, x_anchor: 0, y_anchor: 0, time: 0,
      layer: Math.max(...children.map((el) => elementLayer(el))),
      elements: children,
    } as GroupElement;
    writeElements([...rest, group] as Element[]);
    actions.selectOne(group.id!);
  };

  /** Exact-inverse check: ungrouping must not move pixels. */
  const isIdentityGroup = (g: Element): boolean => {
    if (g.type !== 'group') return false;
    const zeroish = (v: unknown): boolean => v === undefined || v === 0;
    return (
      zeroish(g.x) && zeroish(g.y) &&
      zeroish(g.x_anchor) && zeroish(g.y_anchor) &&
      zeroish(g.time) &&
      g.rotation === undefined && g.scale === undefined &&
      g.opacity === undefined && (g as GroupElement).clip !== true &&
      (g as GroupElement).mask === undefined &&
      (g as GroupElement).time_remap === undefined
    );
  };

  const ungroup = (g: GroupElement): void => {
    const next: Element[] = [];
    for (const el of source.elements) {
      if (el === (g as Element)) next.push(...(g.elements as Element[]));
      else next.push(el);
    }
    writeElements(next);
    actions.setSelection(
      (g.elements as Element[]).map((el) => el.id).filter((id): id is string => !!id),
    );
  };

  // ── Rows ───────────────────────────────────────────────────────────
  const renderRow = (
    el: Element,
    depth: number,
    siblings: readonly Element[],
    index: number,
  ): React.ReactNode => {
    const id = el.id ?? `__anon_${depth}_${index}`;
    const sel = el.id ? selection.includes(el.id) : false;
    const isGroup = el.type === 'group';
    const open = isGroup && expanded.has(id);
    const hidden = el.visible === false;
    const children = isGroup ? ((el as GroupElement).elements as readonly Element[]) : [];
    const TypeIcon = TYPE_ICON[el.type] ?? Square;

    return (
      <div key={id}>
        <div
          className={cn(
            'group/row flex items-center gap-1 h-7 pr-1 border-b border-border/30 cursor-default',
            sel ? 'bg-primary/12' : 'hover:bg-card',
            hidden && 'opacity-50',
          )}
          style={{ paddingLeft: 6 + depth * 12 }}
          onClick={() => el.id && actions.selectOne(el.id)}
          onDoubleClick={() => el.id && setRenaming(el.id)}
        >
          {isGroup ? (
            <button
              type="button"
              className="w-3 shrink-0 text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation();
                setExpanded((prev) => {
                  const next = new Set(prev);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                });
              }}
              aria-expanded={open}
            >
              <svg width="6" height="6" viewBox="0 0 8 8" aria-hidden="true" className={cn('transition-transform', open && 'rotate-90')}>
                <path d="M2 1 L6 4 L2 7 Z" fill="currentColor" />
              </svg>
            </button>
          ) : (
            <span className="w-3 shrink-0" />
          )}
          <span className="w-4 shrink-0 grid place-items-center text-muted-foreground">
            <TypeIcon size={12} />
          </span>
          {renaming === el.id ? (
            <input
              autoFocus
              className="flex-1 min-w-0 h-5 bg-transparent border border-primary/50 rounded px-1 text-[11px] outline-none"
              defaultValue={el.name ?? ''}
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => {
                if (el.id) {
                  actions.updateElement(el.id, {
                    name: e.target.value || undefined,
                  } as Partial<Element>);
                }
                setRenaming(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') setRenaming(null);
              }}
            />
          ) : (
            <span className="flex-1 min-w-0 truncate text-[11px] text-foreground/90">
              {el.name ?? el.id ?? el.type}
            </span>
          )}
          {/* Row actions (hover). */}
          <span className="hidden group-hover/row:flex items-center gap-0.5">
            {depth === 0 && (
              <>
                <RowBtn
                  label="Raise (swap paint order)"
                  disabled={index === 0}
                  onClick={() => swapPaint(el, siblings[index - 1]!)}
                >
                  <ChevronUp size={12} />
                </RowBtn>
                <RowBtn
                  label="Lower (swap paint order)"
                  disabled={index === siblings.length - 1}
                  onClick={() => swapPaint(el, siblings[index + 1]!)}
                >
                  <ChevronDown size={12} />
                </RowBtn>
              </>
            )}
            {isGroup && (
              <RowBtn
                label={
                  isIdentityGroup(el)
                    ? 'Ungroup'
                    : 'Ungroup disabled — this group transforms its children (ungrouping would move pixels)'
                }
                disabled={!isIdentityGroup(el)}
                onClick={() => ungroup(el as GroupElement)}
              >
                <Ungroup size={12} />
              </RowBtn>
            )}
          </span>
          <button
            type="button"
            className={cn(
              'w-5 shrink-0 grid place-items-center',
              hidden
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
            title={hidden ? 'Show (writes visible)' : 'Hide (writes visible: false)'}
            onClick={(e) => {
              e.stopPropagation();
              if (el.id) {
                actions.updateElement(el.id, {
                  visible: hidden ? undefined : false,
                } as Partial<Element>);
              }
            }}
          >
            {hidden ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
        {open &&
          children.map((child, ci) => renderRow(child, depth + 1, children, ci))}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="flex items-center justify-between h-7 px-2 border-b border-border shrink-0">
        <span className="text-[10px] text-muted-foreground">
          {source.elements.length} elements
        </span>
        <button
          type="button"
          className="h-5 px-1.5 rounded inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground hover:bg-card transition disabled:opacity-30"
          disabled={!canGroup}
          title="Group selection (coordinate-identity wrapper)"
          onClick={groupSelection}
        >
          <Group size={11} /> Group
        </button>
      </div>
      {top.map((el, i) => renderRow(el, 0, top, i))}
    </div>
  );
}

function RowBtn({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="w-4 h-4 grid place-items-center text-[8px] text-muted-foreground/60 hover:text-foreground disabled:opacity-20"
      title={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}

// Keep Source import meaningful for the writeElements signature.
export type { Source };
