// useEditor — the facade hook every consumer (UI components,
// programmatic embedders) uses to drive the editor.
//
// Wraps the store's low-level mutators with engine-aware behavior and
// presents a clean action surface. Splits cleanly from state reads:
//
//   const { updateElement, play, undo } = useEditor();          // actions
//   const source = useEditorStore((s) => s.source);              // state
//
// Don't reach for `engineRef.current.foo()` in components. Add a
// method here instead.

import { useMemo } from 'react';
import type { Element, Source } from '@clipkit/protocol';
import { useEditorContext } from './context.js';
import { computeElementPatches } from './source-diff.js';
import type { EditorUiState } from './store.js';
import type { ToolId } from './types.js';

export interface UseEditorReturn {
  // ── Source mutation ─────────────────────────────────────────────────

  /** Patch one element by id. Merges; nested objects aren't recursed. */
  updateElement: (id: string, patch: Partial<Element>) => void;
  /** Append an element to the top-level `elements` array. */
  addElement: (element: Element) => void;
  /** Patch source-level fields (composition settings). */
  patchSource: (
    patch: Record<string, unknown>,
    opts?: { skipHistory?: boolean },
  ) => void;
  /**
   * Replace the WHOLE document (e.g. a JSON-pane commit). One history
   * entry; selection clears, since ids may no longer exist in the new
   * tree. The engine syncs through the normal source subscription.
   */
  replaceSource: (source: Source) => void;
  /** Remove an element by id. Clears it from selection if selected. */
  removeElement: (id: string) => void;
  /**
   * Batched element update — commit a multi-element edit as one undoable
   * action. When `opts.skipHistory` is true, no history entry is pushed
   * (used during live drag dispatches after `pushHistory()` was called
   * at drag start).
   */
  moveElements: (
    updates: ReadonlyArray<{ id: string; patch: Partial<Element> }>,
    opts?: { skipHistory?: boolean },
  ) => void;

  /**
   * Snapshot the current source into history. Call once at the start of
   * a live interactive operation (drag, resize, rotate) — the operation
   * dispatches with `{ skipHistory: true }` thereafter, so the whole
   * thing is one undoable action.
   */
  pushHistory: () => void;

  /**
   * Toggle the engine's interactive mode. While true, the engine renders
   * only the current frame on each setSource (no look-ahead buffering).
   * Wrap drag/resize/rotate with `setInteractive(true)` … `(false)` so
   * the canvas updates live but doesn't waste cycles producing frames
   * the next edit invalidates.
   */
  setInteractive: (value: boolean) => void;

  /**
   * Force-sync the engine with the current store source synchronously.
   * The Editor's normal subscription coalesces via rAF, which can leave
   * the engine one frame behind at the end of an interactive operation
   * (mouseup before the rAF fires). Call this at the end of a drag /
   * resize / rotate to guarantee the engine has the latest state before
   * `setInteractive(false)` resumes look-ahead production.
   */
  flushPendingSource: () => void;

  // ── Selection / tool ────────────────────────────────────────────────

  setSelection: (ids: string[]) => void;
  selectOne: (id: string) => void;
  clearSelection: () => void;

  /**
   * Set the active dock tool. Clicking the same tool twice toggles it
   * off. The Panel routes off this value.
   */
  setTool: (tool: ToolId | null) => void;

  // ── UI state ────────────────────────────────────────────────────────

  /** Patch the editor's UI state (panel layout, stage viewport, etc.). */
  setUiState: (patch: Partial<EditorUiState>) => void;

  // ── Transport (delegates to the engine) ─────────────────────────────

  play: () => Promise<void>;
  pause: () => void;
  seek: (time: number) => void;
  togglePlay: () => Promise<void>;

  // ── History ─────────────────────────────────────────────────────────

  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

export function useEditor(): UseEditorReturn {
  const { store, engine } = useEditorContext();

  // The store object reference is stable; getState/setState are stable.
  // We memoize the action surface so destructuring doesn't churn on
  // every render of the consuming component.
  return useMemo<UseEditorReturn>(
    () => ({
      updateElement: (id, patch) => store.getState()._updateElement(id, patch),
      addElement: (element) => store.getState()._addElement(element),
      patchSource: (patch, opts) => store.getState()._patchSource(patch, opts),
      replaceSource: (source) => store.getState()._setSource(source),
      removeElement: (id) => store.getState()._removeElement(id),
      moveElements: (updates, opts) =>
        store.getState()._moveElements(updates, opts),
      pushHistory: () => store.getState()._pushHistory(),
      setInteractive: (value) => engine?.setInteractive(value),
      flushPendingSource: () => {
        if (!engine) return;
        const state = store.getState();
        if (!state.playback.ready) return;
        const source = state.source;
        if (source === engine.source) return;
        const patches = computeElementPatches(engine.source, source);
        if (patches === null) {
          void engine.setSource(source);
        } else if (patches.length > 0) {
          engine.patchElements(source, patches);
        }
      },

      setSelection: (ids) => store.getState()._setSelection(ids),
      selectOne: (id) => store.getState()._setSelection([id]),
      clearSelection: () => store.getState()._setSelection([]),

      setTool: (tool) => {
        const current = store.getState().tool;
        store.getState()._setTool(current === tool ? null : tool);
      },

      setUiState: (patch) => store.getState()._setUiState(patch),

      play: async () => {
        if (engine) await engine.play();
      },
      pause: () => engine?.pause(),
      seek: (time) => engine?.seek(time),
      togglePlay: async () => {
        if (!engine) return;
        if (engine.playing) engine.pause();
        else await engine.play();
      },

      undo: () => store.getState()._undo(),
      redo: () => store.getState()._redo(),
      canUndo: () => store.getState().history.past.length > 0,
      canRedo: () => store.getState().history.future.length > 0,
    }),
    [store, engine],
  );
}
