// Assets tab — the "stuff you can put on the timeline" hub. Organized into
// sections (Your media / Sound effects / Music…), each a compact inline preview
// with a "See all" that expands to a full browser. This matches how common
// editors present a media area: a project bin alongside libraries you
// pull from. Your media is backed by the injected AssetStore; Sound effects is
// the @clipkit/sfx catalog (drops runtime-native `audio` elements).

'use client';

import { useRef, useState, type DragEvent, type RefObject } from 'react';
import { Play, Upload, X, Film, Music, Image as ImageIcon } from 'lucide-react';
import { listSfx, type SfxEntry } from '@clipkit/sfx';
import type { AssetKind, ClipkitAsset } from '@clipkit/editor-core';
import { cn } from '../lib/utils.js';
import { SfxBrowser } from './assets/SfxBrowser.js';
import { useSfxActions } from './assets/use-sfx.js';
import { useAssets } from './assets/use-assets.js';

// A spread of categories for the inline strip (the full list lives behind "See all").
const FEATURED = ['whoosh', 'impact', 'riser', 'pop', 'ding-correct', 'shimmer'];
// Media tiles shown inline before "See all" takes over (3 rows of 3).
const MEDIA_CAP = 9;

export function AssetsPanel() {
  const [view, setView] = useState<'home' | 'sfx' | 'media'>('home');

  if (view === 'media') {
    return <MediaBrowser onBack={() => setView('home')} />;
  }

  if (view === 'sfx') {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-1.5 h-7 px-2 border-b border-border shrink-0">
          <button
            type="button"
            onClick={() => setView('home')}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            ‹ Assets
          </button>
          <span className="text-[11px] text-foreground/90">Sound effects</span>
        </div>
        <div className="flex-1 min-h-0">
          <SfxBrowser />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Your media — the project bin (injected AssetStore) */}
      <MediaSection onSeeAll={() => setView('media')} />

      {/* Sound effects — featured strip + See all */}
      <Section
        title="Sound effects"
        action={{ label: 'See all', onClick: () => setView('sfx') }}
      >
        <SfxStrip />
      </Section>
    </div>
  );
}

// ── Media bin ─────────────────────────────────────────────────────────────────

/** Drag-and-drop import handlers + the dragging highlight flag. */
function useDropImport(importFiles: (files: FileList | File[]) => void) {
  const [dragOver, setDragOver] = useState(false);
  const handlers = {
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      setDragOver(true);
    },
    onDragLeave: () => setDragOver(false),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.files.length) importFiles(e.dataTransfer.files);
    },
  };
  return { dragOver, handlers };
}

function FilePicker({
  inputRef,
  onFiles,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  onFiles: (files: FileList) => void;
}) {
  return (
    <input
      ref={inputRef}
      type="file"
      multiple
      accept="image/*,video/*,audio/*"
      className="hidden"
      onChange={(e) => {
        if (e.target.files) onFiles(e.target.files);
        e.target.value = '';
      }}
    />
  );
}

function UploadButton({ onClick, label }: { onClick: () => void; label?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Import media"
      className="flex items-center gap-1 h-5 px-1.5 rounded text-[10px] text-muted-foreground hover:text-foreground hover:bg-card transition-colors"
    >
      <Upload size={11} />
      {label && 'Upload'}
    </button>
  );
}

function Dropzone({
  dragOver,
  busy,
  onClick,
}: {
  dragOver: boolean;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full grid place-items-center gap-1 h-20 rounded border border-dashed transition-colors',
        dragOver ? 'border-primary/60 bg-primary/5' : 'border-popover-border hover:border-primary/40',
      )}
    >
      <Upload size={14} className="text-muted-foreground" />
      <span className="text-[10px] text-muted-foreground/70">
        {busy ? 'Importing…' : 'Drop or click — image · video · audio'}
      </span>
    </button>
  );
}

/** The inline "Your media" section — preview tiles capped at MEDIA_CAP. */
function MediaSection({ onSeeAll }: { onSeeAll: () => void }) {
  const { assets, busy, error, importFiles, remove, addToTimeline } = useAssets();
  const inputRef = useRef<HTMLInputElement>(null);
  const { dragOver, handlers } = useDropImport(importFiles);
  const pick = () => inputRef.current?.click();

  const shown = assets.slice(0, MEDIA_CAP);
  const overflow = assets.length - shown.length;

  return (
    <div className="px-2 py-2.5 border-b border-border/40" {...handlers}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Your media
        </span>
        <div className="flex items-center gap-1">
          <UploadButton onClick={pick} />
          {assets.length > MEDIA_CAP && (
            <button
              type="button"
              onClick={onSeeAll}
              className="text-[10px] text-primary/80 hover:text-primary transition-colors"
            >
              See all ›
            </button>
          )}
        </div>
      </div>

      <FilePicker inputRef={inputRef} onFiles={importFiles} />

      {assets.length === 0 ? (
        <Dropzone dragOver={dragOver} busy={busy} onClick={pick} />
      ) : (
        <div className="grid grid-cols-3 gap-1.5">
          {shown.map((a) => (
            <AssetTile key={a.id} asset={a} onAdd={() => addToTimeline(a)} onRemove={() => void remove(a.id)} />
          ))}
        </div>
      )}

      {overflow > 0 && (
        <button
          type="button"
          onClick={onSeeAll}
          className="mt-1.5 text-[9px] text-muted-foreground/60 hover:text-foreground transition-colors"
        >
          +{overflow} more
        </button>
      )}
      {busy && assets.length > 0 && (
        <div className="mt-1.5 text-[9px] text-muted-foreground/60">Importing…</div>
      )}
      {error && <div className="mt-1.5 text-[9px] text-red-400/80">{error}</div>}
    </div>
  );
}

/** The full "See all" media view — every asset, searchable/filterable, scrollable. */
function MediaBrowser({ onBack }: { onBack: () => void }) {
  const { assets, busy, error, importFiles, remove, addToTimeline } = useAssets();
  const inputRef = useRef<HTMLInputElement>(null);
  const { dragOver, handlers } = useDropImport(importFiles);
  const pick = () => inputRef.current?.click();

  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<AssetKind | null>(null);
  const kinds = [...new Set(assets.map((a) => a.kind))] as AssetKind[];
  const q = query.trim().toLowerCase();
  const results = assets.filter(
    (a) => (!kind || a.kind === kind) && (!q || a.name.toLowerCase().includes(q)),
  );

  return (
    <div className="flex flex-col h-full" {...handlers}>
      <div className="flex items-center gap-1.5 h-7 px-2 border-b border-border shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          ‹ Assets
        </button>
        <span className="text-[11px] text-foreground/90">Your media</span>
        <span className="flex-1" />
        <UploadButton onClick={pick} label />
      </div>

      {/* Search + kind filter */}
      <div className="px-2 py-2 border-b border-border shrink-0">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search media…"
          className="w-full h-7 bg-card border border-border rounded px-2 text-[11px] text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-primary/50"
        />
        <div className="flex flex-wrap gap-1 mt-2">
          <FilterChip active={kind === null} onClick={() => setKind(null)}>
            All
          </FilterChip>
          {kinds.map((k) => (
            <FilterChip key={k} active={kind === k} onClick={() => setKind(k)}>
              {k}
            </FilterChip>
          ))}
        </div>
      </div>

      <FilePicker inputRef={inputRef} onFiles={importFiles} />

      <div className="flex-1 min-h-0 overflow-y-auto p-2">
        {assets.length === 0 ? (
          <Dropzone dragOver={dragOver} busy={busy} onClick={pick} />
        ) : results.length === 0 ? (
          <div className="grid place-items-center h-20">
            <span className="text-[11px] text-muted-foreground/60">No matches</span>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-1.5">
            {results.map((a) => (
              <AssetTile key={a.id} asset={a} onAdd={() => addToTimeline(a)} onRemove={() => void remove(a.id)} />
            ))}
          </div>
        )}
        {error && <div className="mt-1.5 text-[9px] text-red-400/80">{error}</div>}
      </div>

      <div className="flex items-center justify-between h-6 px-2 border-t border-border text-[9px] text-muted-foreground/60 shrink-0">
        <span>
          {results.length} item{results.length === 1 ? '' : 's'}
          {results.length !== assets.length && ` of ${assets.length}`}
        </span>
        <span>{busy ? 'importing…' : 'click to add · × to remove'}</span>
      </div>
    </div>
  );
}

function FilterChip({
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

const KIND_ICON = { image: ImageIcon, video: Film, audio: Music } as const;

function AssetTile({ asset, onAdd, onRemove }: { asset: ClipkitAsset; onAdd: () => void; onRemove: () => void }) {
  const Icon = KIND_ICON[asset.kind];
  return (
    <div
      className="group/tile relative aspect-square rounded border border-border bg-card overflow-hidden cursor-default"
      title={`${asset.name} — click to add at playhead`}
      onClick={onAdd}
    >
      {asset.kind === 'image' ? (
        <img src={asset.url} alt={asset.name} className="w-full h-full object-cover" />
      ) : asset.kind === 'video' ? (
        <video src={asset.url} className="w-full h-full object-cover" muted preload="metadata" />
      ) : (
        <div className="w-full h-full grid place-items-center">
          <Icon size={16} className="text-muted-foreground" />
        </div>
      )}
      {/* kind glyph + name overlay */}
      <div className="absolute inset-x-0 bottom-0 px-1 py-0.5 bg-background/70 flex items-center gap-1">
        <Icon size={8} className="shrink-0 text-muted-foreground" />
        <span className="truncate text-[8px] text-foreground/80">{asset.name}</span>
      </div>
      {/* remove */}
      <button
        type="button"
        title="Remove from media"
        className="absolute top-0.5 right-0.5 w-4 h-4 grid place-items-center rounded bg-background/70 text-muted-foreground/70 opacity-0 group-hover/tile:opacity-100 hover:text-foreground transition"
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
      >
        <X size={10} />
      </button>
    </div>
  );
}

function SfxStrip() {
  const { preview, addToTimeline } = useSfxActions();
  const [playing, setPlaying] = useState<string | null>(null);
  const byName = new Map(listSfx().map((e) => [e.name, e] as const));
  const items = FEATURED.map((n) => byName.get(n)).filter((e): e is SfxEntry => !!e);

  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((e) => (
        <button
          key={e.name}
          type="button"
          title={`Preview ${e.label} · double-click to add`}
          onClick={() => {
            setPlaying(e.name);
            preview(e);
          }}
          onDoubleClick={() => addToTimeline(e)}
          className={cn(
            'group/chip flex items-center gap-1 h-6 pl-1.5 pr-2 rounded border border-border bg-card text-[10px] text-foreground/80 hover:border-primary/50 transition-colors',
            playing === e.name && 'border-primary/60 text-foreground',
          )}
        >
          <Play size={9} fill="currentColor" className="text-muted-foreground group-hover/chip:text-foreground" />
          {e.label}
        </button>
      ))}
    </div>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: { label: string; onClick: () => void };
  children: React.ReactNode;
}) {
  return (
    <div className="px-2 py-2.5 border-b border-border/40">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </span>
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            className="text-[10px] text-primary/80 hover:text-primary transition-colors"
          >
            {action.label} ›
          </button>
        )}
      </div>
      {children}
    </div>
  );
}
