# @clipkit/editor

> One configurable React editor over the Source schema, spanning BASIC to ADVANCED modes.

```bash
npm install @clipkit/editor
```

The ClipKit editor is a single component tree—two modes (BASIC and ADVANCED) are just different configurations of the same `<Editor>`. The editor renders a four-panel layout (assets/layers on the left, canvas center, inspector right, timeline bottom) and is powered by `@clipkit/editor-core`. Storage is an injected `AssetStore` port, so you wire your own backend (or use the included in-memory and IndexedDB options). It requires React 19 and a stylesheet import.

## Usage

```jsx
import { Editor, BASIC_CONFIGURATION } from '@clipkit/editor';
import '@clipkit/editor/styles.css';

export function MyEditor({ source }) {
  return (
    <Editor
      initialSource={source}
      configuration={BASIC_CONFIGURATION}
      onSourceChange={(updated) => console.log(updated)}
    />
  );
}
```

## API

**Components**
- `Editor` — Main editor component. Takes `initialSource` (required), `configuration`, `assetStore`, `onSourceChange`, `onRender`, and render/theme props.
- `ExportDialog` — Modal for export format/resolution/quality selection. Consumer calls `onConfirm` with the user's choice; the editor has no knowledge of how to render it.

**Configurations**
- `BASIC_CONFIGURATION`, `ADVANCED_CONFIGURATION` — Pre-built editor layouts controlling visible panels (assets, layers, timeline).

**Hooks**
- `useEditor()` — Returns actions (play, seek, undo, select, etc.) and current playback state.
- `useEditorStore()` — Direct access to the editor's Zustand store.

**Storage**
- `createLocalAssetStore()` — IndexedDB-backed media bin (persists in browser, no backend).
- `createMemoryAssetStore()` — In-memory media bin (loses assets on reload).

**Other**
- `EDITOR_COMMANDS` — Keyboard command registry (play/pause, undo/redo, frame stepping).
- `Section`, `FieldRow` — UI components for building custom inspector panels.

## License

Apache-2.0 · part of [ClipKit](https://clipkit.dev) · [source](https://github.com/clipkit-video/clipkit)
