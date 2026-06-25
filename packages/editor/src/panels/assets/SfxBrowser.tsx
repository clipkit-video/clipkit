// SfxBrowser — the "see all" SFX library: search, category filter, preview on
// click, drop on the timeline. Driven entirely by the @clipkit/sfx catalog
// (listSfx / sfxCategories / renderSfx). Every entry is synth — click to
// preview, + to drop it at the playhead.

'use client';

import { useMemo, useState } from 'react';
import { Play, Plus } from 'lucide-react';
import { listSfx, sfxCategories, type SfxEntry } from '@clipkit/sfx';
import { cn } from '../../lib/utils.js';
import { useSfxActions } from './use-sfx.js';

export function SfxBrowser() {
  const { preview, addToTimeline } = useSfxActions();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);

  const categories = useMemo(() => sfxCategories(), []);
  const all = useMemo(() => listSfx(), []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((e) => {
      if (category && e.category !== category) return false;
      if (!q) return true;
      return (
        e.label.toLowerCase().includes(q) ||
        e.name.toLowerCase().includes(q) ||
        e.category.includes(q) ||
        e.tags.some((t) => t.includes(q))
      );
    });
  }, [all, query, category]);

  const onPreview = (e: SfxEntry): void => {
    setPlaying(e.name);
    preview(e);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="px-2 py-2 border-b border-border shrink-0">
        <input
          value={query}
          onChange={(ev) => setQuery(ev.target.value)}
          placeholder="Search sound effects…"
          className="w-full h-7 bg-card border border-border rounded px-2 text-[11px] text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-primary/50"
        />
        {/* Category chips */}
        <div className="flex flex-wrap gap-1 mt-2">
          <Chip active={category === null} onClick={() => setCategory(null)}>
            All
          </Chip>
          {categories.map((c) => (
            <Chip key={c} active={category === c} onClick={() => setCategory(c)}>
              {c}
            </Chip>
          ))}
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {results.length === 0 ? (
          <div className="h-full grid place-items-center">
            <span className="text-[11px] text-muted-foreground/60">No matches</span>
          </div>
        ) : (
          results.map((e) => (
            <div
              key={e.name}
              className={cn(
                'group/sfx flex items-center gap-2 h-9 px-2 border-b border-border/30 hover:bg-card cursor-default',
                playing === e.name && 'bg-primary/10',
              )}
              onClick={() => onPreview(e)}
            >
              {/* Preview */}
              <button
                type="button"
                title="Preview"
                className="w-5 h-5 shrink-0 grid place-items-center rounded text-muted-foreground hover:text-foreground hover:bg-primary/15"
                onClick={(ev) => {
                  ev.stopPropagation();
                  onPreview(e);
                }}
              >
                <Play size={11} fill="currentColor" />
              </button>

              {/* Label + meta */}
              <div className="flex-1 min-w-0">
                <div className="truncate text-[11px] text-foreground/90">{e.label}</div>
                <div className="truncate text-[9px] text-muted-foreground/70">{e.category}</div>
              </div>

              {/* Add to timeline */}
              <button
                type="button"
                title="Add at playhead"
                className="w-5 h-5 shrink-0 grid place-items-center rounded text-muted-foreground/50 opacity-0 group-hover/sfx:opacity-100 hover:text-foreground hover:bg-primary/15 transition"
                onClick={(ev) => {
                  ev.stopPropagation();
                  addToTimeline(e);
                }}
              >
                <Plus size={12} />
              </button>
            </div>
          ))
        )}
      </div>

      {/* Footer count + honest split */}
      <div className="flex items-center justify-between h-6 px-2 border-t border-border text-[9px] text-muted-foreground/60 shrink-0">
        <span>{results.length} sounds</span>
        <span>click to preview · + to add</span>
      </div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'h-5 px-1.5 rounded text-[9px] capitalize transition-colors',
        active
          ? 'bg-primary/20 text-foreground'
          : 'text-muted-foreground hover:text-foreground hover:bg-card',
      )}
    >
      {children}
    </button>
  );
}
