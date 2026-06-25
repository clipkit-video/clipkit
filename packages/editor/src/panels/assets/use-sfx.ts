// Shared SFX actions for the Assets tab: render a catalog entry, preview it,
// and drop it on the timeline as a runtime-native `audio` element.
//
// "Drop on the timeline" = render the (finished) SFX → encode a WAV object-URL
// → addElement({ type:'audio', source:url, … }) at the playhead, on a fresh
// lane. The runtime mixes it in preview/export like any other audio — no
// special-casing, no ffmpeg.

'use client';

import { useCallback } from 'react';
import type { Element } from '@clipkit/protocol';
import { useEditor, useEditorStore } from '@clipkit/editor-core';
import { renderSfx, type SfxEntry } from '@clipkit/sfx';
import { playSfx, sfxDuration, sfxToObjectUrl } from '../../lib/sfx-preview.js';

let dropCounter = 0;

export function useSfxActions() {
  const { addElement } = useEditor();
  const playheadTime = useEditorStore((s) => s.playback.time);
  const elements = useEditorStore((s) => s.source.elements);

  /** Render + preview a catalog entry. Returns its duration (0 if not playable). */
  const preview = useCallback((entry: SfxEntry): number => {
    const sfx = renderSfx(entry.name);
    if (!sfx) return 0;
    return playSfx(sfx);
  }, []);

  /** Drop a catalog entry on the timeline at the playhead. Returns the new id. */
  const addToTimeline = useCallback(
    (entry: SfxEntry): string | null => {
      const sfx = renderSfx(entry.name);
      if (!sfx) return null;

      const url = sfxToObjectUrl(sfx);
      const duration = sfxDuration(sfx);
      const id = `sfx-${entry.name}-${(dropCounter++).toString(36)}`;

      addElement({
        type: 'audio',
        id,
        name: entry.label,
        source: url,
        time: Math.max(0, playheadTime),
        duration,
        volume: 100,
        layer: 1,
      } as Element);
      return id;
    },
    [addElement, elements, playheadTime],
  );

  return { preview, addToTimeline };
}
