// Public entry point for @clipkit/editor — the configurable editor.
//
//   import { Editor, BASIC_CONFIGURATION } from '@clipkit/editor';
//   <Editor initialSource={source} configuration={BASIC_CONFIGURATION} />
//
// The data layer (store, hooks, registry, configurations) comes from
// @clipkit/editor-core and is re-exported so embedders need one import.

export { Editor } from './Editor.js';
export { ExportDialog } from './ExportDialog.js';
export type {
  EditorProps,
  ExportFormatOption,
  ExportRequest,
  ExportResolution,
  ExportQuality,
} from './types.js';

export { EDITOR_COMMANDS } from './commands.js';
export type { EditorCommand } from './commands.js';
export { Section, FieldRow } from './frame/Section.js';

export {
  ADVANCED_CONFIGURATION,
  BASIC_CONFIGURATION,
  useEditor,
  useEditorStore,
  createLocalAssetStore,
  createMemoryAssetStore,
} from '@clipkit/editor-core';
export type {
  EditorConfiguration,
  EditorViewsConfiguration,
  AssetStore,
  ClipkitAsset,
  AssetKind,
} from '@clipkit/editor-core';
