// Group drill-down breadcrumbs — a floating box on the stage's bottom-LEFT
// (mirrors the zoom box on the bottom-right). Shows the path into nested groups,
// e.g. "Composition › Group". Click any crumb to pop back out to that level.
// Only renders while inside a group.

'use client';

import { useEffect } from 'react';
import type { Element } from '@clipkit/protocol';
import { resolveGroupPath, useEditor, useEditorStore } from '@clipkit/editor-core';
import { cn } from '../lib/utils.js';

export function Breadcrumbs() {
  const groupPath = useEditorStore((s) => s.ui.groupPath);
  const elements = useEditorStore((s) => s.source.elements);
  const groupFlashId = useEditorStore((s) => s.ui.groupFlashId);
  const { setUiState, clearSelection } = useEditor();

  // On entering a group, flash this control's border, then clear the flag.
  useEffect(() => {
    if (!groupFlashId) return;
    const t = setTimeout(() => setUiState({ groupFlashId: null }), 1000);
    return () => clearTimeout(t);
  }, [groupFlashId, setUiState]);

  if (groupPath.length === 0) return null;

  const { crumbs } = resolveGroupPath(elements, groupPath);
  const go = (depth: number) => {
    setUiState({ groupPath: groupPath.slice(0, depth) });
    clearSelection();
  };
  const label = (g: Element): string => (typeof (g as { name?: unknown }).name === 'string' && (g as { name: string }).name) || (typeof g.id === 'string' ? g.id : 'Group');

  return (
    <div
      key={groupFlashId ?? 'crumbs'}
      style={groupFlashId ? { animation: 'clipkit-crumb-flash 1s ease-out' } : undefined}
      className="flex items-center gap-1 h-7 px-2 bg-background/90 backdrop-blur-sm border border-border rounded-md text-[11px]"
    >
      <button type="button" onClick={() => go(0)} className="text-muted-foreground hover:text-foreground transition-colors">
        Composition
      </button>
      {crumbs.map((g, i) => (
        <span key={typeof g.id === 'string' ? g.id : i} className="flex items-center gap-1">
          <span className="text-muted-foreground/50">›</span>
          <button
            type="button"
            onClick={() => go(i + 1)}
            className={cn('transition-colors', i === crumbs.length - 1 ? 'text-foreground font-medium' : 'text-muted-foreground hover:text-foreground')}
          >
            {label(g)}
          </button>
        </span>
      ))}
    </div>
  );
}
