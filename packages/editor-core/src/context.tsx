// EditorContext — wires the Zustand store and the PlaybackEngine into a
// single value the component tree consumes. Editor.tsx provides; every
// other component (and `useEditor()`) reads.
//
// Two things share the context because they're tied to the same session
// lifecycle. Splitting them would let components subscribe to the
// engine without the store, which is exactly what we're trying to
// prevent — engine access must always go through the store-aware
// facade.

import { createContext, useContext } from 'react';
import type { PlaybackEngine } from '@clipkit/playback';
import type { AssetStore } from './asset-store.js';
import type { EditorStore } from './store.js';

export interface EditorContextValue {
  store: EditorStore;
  engine: PlaybackEngine | null;
  theme: 'light' | 'dark';
  /** Where the media bin reads/writes. Local IndexedDB default unless injected. */
  assetStore: AssetStore;
}

export const EditorContext = createContext<EditorContextValue | null>(null);

/**
 * Read the editor session. Throws if used outside an `<Editor>` root
 * (programming error, not user error — fail loudly).
 */
export function useEditorContext(): EditorContextValue {
  const ctx = useContext(EditorContext);
  if (!ctx) {
    throw new Error(
      'useEditorContext / useEditor / useEditorStore must be used inside <Editor>.',
    );
  }
  return ctx;
}
