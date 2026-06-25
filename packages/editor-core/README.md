# @clipkit/editor-core

The shared data layer under every Clipkit editor shell ("three lenses,
one document" — see EDITORS-PLAN.md). UI-free.

- `createEditorStore` — the document store: Source, 50-step undo/redo,
  selection, tool, ui + playback state (Zustand + Immer).
- `EditorContext` / `useEditorContext` — session context (store +
  engine + theme) shells provide and components consume.
- `useEditor` / `useEditorStore` — the action facade and the
  state-selector hook.
- `usePlaybackSession` — constructs the PlaybackEngine against a
  mounted canvas and wires it to the store (event mirroring, rAF-
  coalesced two-tier source dispatch via `computeElementPatches`,
  loop forwarding).
- Pure math: timeline helpers (time↔px, snapping, overlap detection)
  and stage helpers (hit testing, source↔screen transforms).

Shells: `@clipkit/basic-editor` (the approachable editor),
`@clipkit/advanced-editor` (the full-protocol studio shell).
