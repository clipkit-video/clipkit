// useEditorStore — public state-reading hook. Components select the
// slices they need; Zustand handles fine-grained subscriptions.
//
//   const source = useEditorStore((s) => s.source);
//   const selection = useEditorStore((s) => s.selection);
//   const time = useEditorStore((s) => s.playback.time);
//
// Pair with `useEditor()` for dispatching actions.

import { useStore } from 'zustand';
import { useEditorContext } from './context.js';
import type { EditorState } from './store.js';

export function useEditorStore<T>(selector: (state: EditorState) => T): T {
  const { store } = useEditorContext();
  return useStore(store, selector);
}
