// Add-element bar — a floating, vertical toolbar centered on the LEFT of the
// stage.
//
// Tools: Select (click / marquee) and Hand (drag to pan) — the active one is
// highlighted. Below the divider: one button per element type you can add.
// Visual primitives add at the playhead; media (image / video / music) open a
// file picker and import through the AssetStore.
//
// Styling mirrors the stage's floating clusters: `bg-background/90 backdrop-blur
// border border-border rounded-md`, shadcn tokens, the editor `cn` helper.

'use client';

import { useCallback, useRef, type ChangeEvent, type ReactElement } from 'react';
import type { Element } from '@clipkit/protocol';
import { useEditor, useEditorContext, useEditorStore } from '@clipkit/editor-core';
import { cn } from '../lib/utils.js';

// ── icons (inline, currentColor, lucide-flavored 24-grid) ────────────────────
const ic = 'shrink-0';
const Cursor = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={cn(ic, 'size-4')}><path d="M6.75 5.97a1.12 1.12 0 0 1 1.81-.89l10.13 7.88c.85.66.38 2.01-.69 2.01h-5.14c-.38 0-.73.17-.97.47l-3.14 3.97c-.66.84-2.01.37-2.01-.7z" /></svg>
);
const sk = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
const Hand = () => <svg viewBox="0 0 24 24" {...sk} className={cn(ic, 'size-4')}><path d="M7 11V6.5a1.5 1.5 0 0 1 3 0V11m0-.5V5a1.5 1.5 0 0 1 3 0v6m0-.5V6a1.5 1.5 0 0 1 3 0v6.5m0-2.5a1.5 1.5 0 0 1 3 0V15a5 5 0 0 1-5 5h-1.5a5 5 0 0 1-4-2L7 14.5c-.8-1-.3-2 .8-2.2L10 12" /></svg>;
const Square = () => <svg viewBox="0 0 24 24" {...sk} className={cn(ic, 'size-4')}><rect x="4" y="4" width="16" height="16" rx="2.5" /></svg>;
const TypeI = () => <svg viewBox="0 0 24 24" {...sk} className={cn(ic, 'size-4')}><path d="M5 6.5V5h14v1.5M12 5v14M9 19h6" /></svg>;
const ImageI = () => <svg viewBox="0 0 24 24" {...sk} className={cn(ic, 'size-4')}><rect x="3" y="4" width="18" height="16" rx="2.5" /><circle cx="8.5" cy="9.5" r="1.5" /><path d="m4 18 5-5 4 4 3-3 4 4" /></svg>;
const VideoI = () => <svg viewBox="0 0 24 24" {...sk} className={cn(ic, 'size-4')}><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M10 9.5v5l4-2.5z" /></svg>;
const MusicI = () => <svg viewBox="0 0 24 24" {...sk} className={cn(ic, 'size-4')}><path d="M9 18V7l10-2v9" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="16.5" cy="16" r="2.5" /></svg>;
const CaptionI = () => <svg viewBox="0 0 24 24" {...sk} className={cn(ic, 'size-4')}><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M7 11h4M7 14h7M14 11h3" /></svg>;

type AddKind = 'shape' | 'text' | 'caption' | 'image' | 'video' | 'audio';
type MediaKind = 'image' | 'video' | 'audio';
const TOOLS: Array<{ kind: AddKind; label: string; Icon: () => ReactElement; media?: MediaKind }> = [
  { kind: 'shape', label: 'Shape', Icon: Square },
  { kind: 'text', label: 'Text', Icon: TypeI },
  { kind: 'caption', label: 'Captions', Icon: CaptionI },
  { kind: 'image', label: 'Image', Icon: ImageI, media: 'image' },
  { kind: 'video', label: 'Video', Icon: VideoI, media: 'video' },
  { kind: 'audio', label: 'Music', Icon: MusicI, media: 'audio' },
];

const FILL = '#6366f1';
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
let addCounter = 0;
const uid = (k: string) => `${k}-${(addCounter++).toString(36)}`;
const iconBtn = 'flex items-center justify-center w-7 h-7 rounded-sm text-muted-foreground transition-colors hover:text-foreground hover:bg-accent';
const activeBtn = 'flex items-center justify-center w-7 h-7 rounded-sm bg-primary text-primary-foreground transition-colors';

export function AddElementBar() {
  const { addElement, setUiState } = useEditor();
  const { assetStore } = useEditorContext();
  const tool = useEditorStore((s) => s.ui.tool);
  const playhead = useEditorStore((s) => s.playback.time);
  const elements = useEditorStore((s) => s.source.elements);
  const compW = useEditorStore((s) => num(s.source.width, 1920));
  const compH = useEditorStore((s) => num(s.source.height, 1080));

  const fileRef = useRef<HTMLInputElement>(null);
  const pendingMedia = useRef<MediaKind>('image');

  const ctx = () => {
    const time = Math.max(0, playhead);
    // layer is assigned on add — the store places new elements on top (layer 1).
    return { time, layer: 1, cx: compW / 2, cy: compH / 2 };
  };
  const center = { x_anchor: '50%' as const, y_anchor: '50%' as const };

  const addByKind = useCallback(
    (kind: AddKind) => {
      const c = ctx();
      let el: Element | null = null;
      if (kind === 'shape') {
        el = { id: uid('shape'), name: 'Shape', type: 'shape', shape: 'rectangle', x: c.cx, y: c.cy, ...center, width: 400, height: 280, fill_color: FILL, border_radius: 8, time: c.time, duration: 3, layer: c.layer } as Element;
      } else if (kind === 'text') {
        el = { id: uid('text'), name: 'Text', type: 'text', text: 'Text', x: c.cx, y: c.cy, ...center, width: 600, height: 160, font_family: 'Inter', font_size: 'auto', font_weight: 700, fill_color: '#ffffff', text_align: 'center', time: c.time, duration: 3, layer: c.layer } as Element;
      } else if (kind === 'caption') {
        // A starter caption with an explicit box (like text) — transcribe a source
        // in the inspector to fill the words, or edit them by hand.
        el = { id: uid('caption'), name: 'Captions', type: 'caption', x: c.cx, y: c.cy, ...center, width: 900, height: 200, font_family: 'Inter', font_size: 72, font_weight: 800, fill_color: '#ffffff', text_align: 'center', style: 'tiktok_bounce', highlight_color: '#ffd60a', max_length: 16, words: [{ text: 'Caption', start: 0, end: 1 }], time: c.time, duration: 'auto', layer: c.layer } as Element;
      }
      if (el) addElement(el);
    },
    [addElement, elements, playhead, compW, compH],
  );

  const pickMedia = useCallback((media: MediaKind) => {
    pendingMedia.current = media;
    const input = fileRef.current;
    if (!input) return;
    input.accept = media === 'image' ? 'image/*' : media === 'video' ? 'video/*' : 'audio/*';
    input.click();
  }, []);

  const onFile = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      const asset = await assetStore.upload(file);
      const c = ctx();
      const media = pendingMedia.current;
      let el: Element;
      if (media === 'audio') {
        el = { id: uid('audio'), name: asset.name, type: 'audio', source: asset.url, duration: asset.duration ?? 5, volume: 100, time: c.time, layer: c.layer } as Element;
      } else {
        const iw = num(asset.width, compW), ih = num(asset.height, compH);
        const scale = Math.min(1, compW / iw, compH / ih);
        el = { id: uid(media), name: asset.name, type: media, source: asset.url, x: c.cx, y: c.cy, ...center, width: Math.round(iw * scale), height: Math.round(ih * scale), duration: media === 'video' ? asset.duration ?? 5 : 3, time: c.time, layer: c.layer } as Element;
      }
      addElement(el);
    },
    [assetStore, addElement, playhead, compW, compH, elements],
  );

  return (
    <div className="absolute left-3 top-1/2 -translate-y-1/2 z-10 flex flex-col items-center gap-1 bg-background/90 backdrop-blur-sm border border-border rounded-md p-1">
      {/* Tools: Select + Hand */}
      <button type="button" title="Select (click / marquee)" aria-pressed={tool === 'select'} onClick={() => setUiState({ tool: 'select' })} className={tool === 'select' ? activeBtn : iconBtn}>
        <Cursor />
      </button>
      <button type="button" title="Hand (drag to pan)" aria-pressed={tool === 'hand'} onClick={() => setUiState({ tool: 'hand' })} className={tool === 'hand' ? activeBtn : iconBtn}>
        <Hand />
      </button>

      <div className="h-px w-5 bg-border my-0.5" aria-orientation="horizontal" />

      {/* One button per addable element type */}
      {TOOLS.map((t) => (
        <button key={t.kind} type="button" title={`Add ${t.label.toLowerCase()}`} onClick={() => (t.media ? pickMedia(t.media) : addByKind(t.kind))} className={iconBtn}>
          <t.Icon />
        </button>
      ))}

      <input ref={fileRef} type="file" hidden onChange={onFile} />
    </div>
  );
}
