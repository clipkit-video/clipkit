// ShapePresetControl — the inspector's shape picker. Picking a preset patches
// the selected element between primitive (rectangle/ellipse) and path form
// (triangle/star/line/…) in one undoable edit. Geometry lives in
// lib/shape-presets (shared with the add-bar's Shape dropdown).

'use client';

import type { Element, ShapeElement } from '@clipkit/protocol';
import { useEditor, useEditorStore } from '@clipkit/editor-core';
import { SelectControl } from './primitives.js';
import { SHAPE_PRESETS, presetFields, detectPreset } from '../lib/shape-presets.js';

const LABELS = SHAPE_PRESETS.map((p) => p.label);

export function ShapePresetControl({ fluid }: { fluid?: boolean }) {
  const { updateElement } = useEditor();
  const selId = useEditorStore((s) => s.selection[0]);
  const el = useEditorStore((s) => s.source.elements.find((e) => e.id === selId)) as ShapeElement | undefined;

  const color =
    (typeof el?.fill_color === 'string' && el.fill_color) ||
    (typeof el?.paths?.[0]?.fill === 'string' && el.paths[0]!.fill) ||
    '#6366f1';

  const currentId = detectPreset(el);
  const currentLabel = SHAPE_PRESETS.find((p) => p.id === currentId)?.label ?? 'Rectangle';

  const onChange = (label: string) => {
    if (!selId) return;
    const p = SHAPE_PRESETS.find((x) => x.label === label);
    if (!p) return;
    updateElement(selId, presetFields(p, color) as Partial<Element>);
  };

  return <SelectControl value={currentLabel} options={LABELS} fluid={fluid} onChange={onChange} />;
}
