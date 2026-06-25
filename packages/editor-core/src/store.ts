// useEditorStore — the canonical state for an editing session.
//
// Sections (one store, organized internally):
//   source     — the canonical Source being edited
//   history    — past + future Source snapshots for undo/redo
//   selection  — selected element ids
//   tool       — active dock tool, or null
//   ui         — panel layout + transient interaction state
//   playback   — mirror of PlaybackEngine state (time, playing, …)
//
// Mutator actions are underscore-prefixed; they're low-level and don't
// know about the engine. The `useEditor()` facade wraps them with the
// engine-aware behavior (e.g., updateElement triggers engine.setSource
// via the Editor root's useEffect on source).

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { current } from 'immer';
import type { Source, Element } from '@clipkit/protocol';
import type { ToolId } from './types.js';
import { elementLayer } from './timeline-utils.js';

const HISTORY_LIMIT = 50;

export interface EditorPlaybackState {
  time: number;
  duration: number;
  playing: boolean;
  ready: boolean;
  error: string | null;
}

export interface EditorUiState {
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  jsonViewOpen: boolean;
  timelineHeight: number;
  timelineScale: number;
  isScrubbing: boolean;
  /** When true, playback wraps to 0 at the end instead of pausing. */
  loop: boolean;
  /** Toggleable perf HUD (engine stats overlay). Bound to Shift+P. */
  perfHudOpen: boolean;
  /**
   * The animated property whose curve is open in the graph drawer
   * (editor state — the lens rule). Null = drawer closed.
   */
  curveTarget: { elementId: string; property: string } | null;
  /**
   * Color theme. The Editor's `theme` prop is the initial value;
   * after mount the user can toggle via the header button and the
   * store becomes the live source of truth.
   */
  theme: 'light' | 'dark';
  /**
   * Stage preview projection (CKP/1.0 camera). 'camera' renders through
   * the scene camera (true framing); 'flat' ignores it for orthographic,
   * gizmo-correct editing — AE's Camera vs Front view. The LENS RULE:
   * preview-only, NEVER serialized; the stored source keeps its camera.
   * Only meaningful when the source declares a `camera`.
   */
  stageView: 'camera' | 'flat';
  /** Active stage tool: 'select' (click/marquee) or 'hand' (drag to pan). */
  tool: 'select' | 'hand';
  /** Group drill-down: ids of the groups entered (breadcrumb trail, root = []).
   *  The timeline scopes to the deepest entered group's children. */
  groupPath: string[];
  /** A group id to briefly flash on the stage (set on enter, auto-cleared). */
  groupFlashId: string | null;
  /** Stage zoom factor — 1.0 = 1px source pixel = 1 screen pixel. */
  stageZoom: number;
  /** Stage pan offset, in screen pixels relative to the viewport top-left. */
  stagePan: { x: number; y: number };
  /**
   * Preview-only audio mute/solo (element ids). The LENS RULE: these
   * compute engine preview gains and are NEVER serialized. Shared by
   * the mixer rail and the inspector's volume knob.
   */
  audioMuted: readonly string[];
  audioSolo: readonly string[];
}

export interface EditorState {
  source: Source;
  history: {
    past: Source[];
    future: Source[];
  };
  selection: string[];
  tool: ToolId | null;
  ui: EditorUiState;
  playback: EditorPlaybackState;

  // ── Low-level mutators (use via useEditor() facade) ─────────────────

  _setSource: (source: Source, opts?: { skipHistory?: boolean }) => void;
  _updateElement: (id: string, patch: Partial<Element>) => void;
  /**
   * Patch SOURCE-LEVEL fields (width, duration, background_color,
   * camera, …). `skipHistory` follows the _moveElements contract for
   * live scrubs that snapshotted once via `_pushHistory()`.
   */
  _patchSource: (
    patch: Record<string, unknown>,
    opts?: { skipHistory?: boolean },
  ) => void;
  _addElement: (element: Element) => void;
  _removeElement: (id: string) => void;
  /**
   * Batched element update. When `opts.skipHistory` is true, history
   * is not pushed — used during live drag dispatches after the caller
   * has already snapshotted once via `_pushHistory()`.
   */
  _moveElements: (
    updates: ReadonlyArray<{ id: string; patch: Partial<Element> }>,
    opts?: { skipHistory?: boolean },
  ) => void;
  /**
   * Snapshot the current source into history.past — used at the start
   * of a multi-tick interactive operation (drag, etc.) so the whole
   * operation collapses into a single undoable entry.
   */
  _pushHistory: () => void;
  _setSelection: (ids: string[]) => void;
  _setTool: (tool: ToolId | null) => void;
  _undo: () => void;
  _redo: () => void;
  _setPlaybackState: (patch: Partial<EditorPlaybackState>) => void;
  _setUiState: (patch: Partial<EditorUiState>) => void;
}

const defaultUi: EditorUiState = {
  leftPanelOpen: true,
  rightPanelOpen: true,
  jsonViewOpen: true,
  timelineHeight: 280,
  timelineScale: 100,
  isScrubbing: false,
  loop: true,
  perfHudOpen: false,
        curveTarget: null,
  theme: 'dark',
  // 0 sentinel for stageZoom means "auto-fit on first viewport measurement";
  // the Stage's mount effect computes a real number once it has dimensions.
  stageView: 'camera',
  tool: 'select',
  groupPath: [],
  groupFlashId: null,
  stageZoom: 0,
  stagePan: { x: 0, y: 0 },
  audioMuted: [],
  audioSolo: [],
};

const defaultPlayback: EditorPlaybackState = {
  time: 0,
  duration: 0,
  playing: false,
  ready: false,
  error: null,
};

/**
 * Create an editor store. Callers (the `Editor` root) construct one per
 * editing session and pass it through context. Components read it via
 * the `useEditorStore` hook re-exported by the root.
 */
export function createEditorStore(
  initialSource: Source,
  initialTheme: 'light' | 'dark' = 'dark',
) {
  return create<EditorState>()(
    immer((set) => ({
      source: initialSource,
      history: { past: [], future: [] },
      selection: [],
      tool: null,
      ui: { ...defaultUi, theme: initialTheme },
      playback: defaultPlayback,

      _setSource: (source, opts) =>
        set((state) => {
          if (!opts?.skipHistory) pushHistory(state);
          state.source = source as never;
          // External source swap clears selection — ids may no longer
          // exist in the new tree.
          state.selection = [];
        }),

      _updateElement: (id, patch) =>
        set((state) => {
          const el = findElementById(state.source.elements as Element[], id);
          if (!el) return;
          pushHistory(state);
          Object.assign(el, patch);
          alignSourceDuration(state);
        }),

      _patchSource: (patch, opts) =>
        set((state) => {
          if (!opts?.skipHistory) pushHistory(state);
          Object.assign(state.source as Record<string, unknown>, patch);
          alignSourceDuration(state);
        }),

      _addElement: (element) =>
        set((state) => {
          pushHistory(state);
          const els = state.source.elements as Element[];
          // New elements (incl. duplicates) go ON TOP — layer 1 — and the
          // existing siblings renumber to 2..N+1 so the container stays
          // uniquely layered. Correct-by-construction at EDIT time (not a
          // load-time normalize); element array order is preserved.
          [...els]
            .sort((a, b) => elementLayer(a) - elementLayer(b))
            .forEach((el, i) => { el.layer = i + 2; });
          element.layer = 1;
          els.push(element);
          if (element.id) state.selection = [element.id];
          alignSourceDuration(state);
        }),

      _removeElement: (id) =>
        set((state) => {
          const elements = state.source.elements as Element[];
          const idx = elements.findIndex((e) => e.id === id);
          if (idx < 0) return;
          pushHistory(state);
          elements.splice(idx, 1);
          state.selection = state.selection.filter((s) => s !== id);
          alignSourceDuration(state);
        }),

      _moveElements: (updates, opts) =>
        set((state) => {
          if (updates.length === 0) return;
          if (!opts?.skipHistory) pushHistory(state);
          for (const { id, patch } of updates) {
            const el = findElementById(state.source.elements as Element[], id);
            if (!el) continue;
            Object.assign(el, patch);
          }
          alignSourceDuration(state);
        }),

      _pushHistory: () =>
        set((state) => {
          pushHistory(state);
        }),

      _setSelection: (ids) =>
        set((state) => {
          state.selection = ids;
        }),

      _setTool: (tool) =>
        set((state) => {
          state.tool = tool;
        }),

      _undo: () =>
        set((state) => {
          const previous = state.history.past.shift();
          if (!previous) return;
          // current() unwraps the Immer draft to a plain snapshot
          // suitable for storing in the future stack.
          state.history.future.unshift(current(state.source) as Source);
          state.source = previous as never;
          // Preserve selection. Selection state is UI state, not
          // source state, and undo/redo should only roll the Source.
          // Drop any ids that no longer exist in the restored source
          // (e.g. undoing an addElement that the selection pointed at)
          // so the panel doesn't try to render a missing element.
          pruneStaleSelection(state);
        }),

      _redo: () =>
        set((state) => {
          const next = state.history.future.shift();
          if (!next) return;
          state.history.past.unshift(current(state.source) as Source);
          state.source = next as never;
          pruneStaleSelection(state);
        }),

      _setPlaybackState: (patch) =>
        set((state) => {
          Object.assign(state.playback, patch);
        }),

      _setUiState: (patch) =>
        set((state) => {
          Object.assign(state.ui, patch);
        }),
    })),
  );
}

export type EditorStore = ReturnType<typeof createEditorStore>;

// ── Invariant: source.duration === max(element.time + element.duration) ─
//
// The schema treats source.duration as the authoritative playback
// duration (engine pauses there; the runtime stops rendering past it).
// Without an invariant, the timeline UI's derived extent and the
// engine's source.duration can disagree — the user drags a clip past
// the original end, hits play, and playback pauses where the source
// USED to end while the ruler/clip both say there's more.
//
// Solution: every editor mutation re-syncs source.duration to the
// authored content extent (bumping up AND shrinking down). One number,
// one truth, no UI/engine drift. If the user wants empty trailing
// time, they add a transparent element to fill it; explicit-duration
// authoring is still possible via `duration: 'auto'` (leaves it
// derived) or via direct JSON edits between mutations.
//
// Composition recursion: nested elements contribute to the parent's
// extent only via the composition's own time + duration, which the
// composition author controls explicitly. We still walk into
// compositions to find the top-level extent in case the top-level
// container is a composition.
function alignSourceDuration(state: EditorState): void {
  let maxExtent = 0;
  for (const el of state.source.elements as Element[]) {
    const t = typeof el.time === 'number' ? el.time : 0;
    const d = typeof el.duration === 'number' ? el.duration : 0;
    if (t + d > maxExtent) maxExtent = t + d;
  }
  if (typeof state.source.duration === 'number') {
    state.source.duration = maxExtent;
  }
  // 'auto' / unset: engine already derives from elements; leave it.
}

// ── History helpers ──────────────────────────────────────────────────

function pushHistory(state: EditorState): void {
  // `state.source` is an Immer draft proxy. structuredClone can't
  // clone proxies; `current()` unwraps to a plain immutable snapshot
  // that's safe to keep in history.
  state.history.past.unshift(current(state.source) as Source);
  if (state.history.past.length > HISTORY_LIMIT) {
    state.history.past.length = HISTORY_LIMIT;
  }
  // Any forward history is invalidated by a new mutation.
  state.history.future = [];
}

/**
 * Drop any selected ids that don't exist in the current source. Used
 * after undo/redo to avoid showing the Edit panel for an element that
 * was just un-added.
 */
function pruneStaleSelection(state: EditorState): void {
  if (state.selection.length === 0) return;
  const next = state.selection.filter(
    (id) => findElementById(state.source.elements as Element[], id) !== null,
  );
  if (next.length !== state.selection.length) state.selection = next;
}

// ── Element lookup (recurses into compositions) ──────────────────────

function findElementById(elements: Element[], id: string): Element | null {
  for (const el of elements) {
    if (el.id === id) return el;
    if (el.type === 'group') {
      const nested = findElementById(el.elements as Element[], id);
      if (nested) return nested;
    }
  }
  return null;
}
