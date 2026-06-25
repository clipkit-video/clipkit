// Media-bin actions for the Assets tab. Reads/writes through the injected
// AssetStore (local IndexedDB by default), and drops an asset on the timeline
// as the matching element (image/video/audio) at the playhead.

'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Element } from '@clipkit/protocol';
import {
  useEditor,
  useEditorContext,
  useEditorStore,
  type ClipkitAsset,
} from '@clipkit/editor-core';

function num(v: unknown, d: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : d;
}

let dropCounter = 0;

export function useAssets() {
  const { assetStore } = useEditorContext();
  const { addElement } = useEditor();
  const playheadTime = useEditorStore((s) => s.playback.time);
  const elements = useEditorStore((s) => s.source.elements);
  const compW = useEditorStore((s) => num(s.source.width, 1920));
  const compH = useEditorStore((s) => num(s.source.height, 1080));

  const [assets, setAssets] = useState<ClipkitAsset[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setAssets(await assetStore.list());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load media');
    }
  }, [assetStore]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const importFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      if (list.length === 0) return;
      setBusy(true);
      setError(null);
      try {
        for (const f of list) await assetStore.upload(f);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Upload failed');
      } finally {
        setBusy(false);
      }
    },
    [assetStore, refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      try {
        await assetStore.remove(id);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not remove');
      }
    },
    [assetStore, refresh],
  );

  const addToTimeline = useCallback(
    (asset: ClipkitAsset): string => {
      const id = `${asset.kind}-${(dropCounter++).toString(36)}`;
      const time = Math.max(0, playheadTime);
      // layer is assigned on add — the store places new elements on top (layer 1).
      const base = { id, name: asset.name, time, layer: 1 };

      let el: Element;
      if (asset.kind === 'audio') {
        el = { ...base, type: 'audio', source: asset.url, duration: asset.duration ?? 5, volume: 100 } as Element;
      } else {
        // image/video: fit intrinsic size inside the composition, keep aspect.
        const iw = num(asset.width, compW), ih = num(asset.height, compH);
        const scale = Math.min(1, compW / iw, compH / ih);
        const width = Math.round(iw * scale), height = Math.round(ih * scale);
        const duration = asset.kind === 'video' ? asset.duration ?? 5 : 3;
        // Centre the asset in the comp explicitly (x/y at the centre with a
        // centre anchor). Without an explicit anchor the runtime now places
        // x/y at the top-left corner, so a bare drop would land off-centre.
        el = { ...base, type: asset.kind, source: asset.url, x: compW / 2, y: compH / 2, x_anchor: '50%', y_anchor: '50%', width, height, duration } as Element;
      }
      addElement(el);
      return id;
    },
    [addElement, elements, playheadTime, compW, compH],
  );

  return { assets, busy, error, importFiles, remove, addToTimeline, refresh };
}
