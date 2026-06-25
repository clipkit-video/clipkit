// Public entry point. The shared data layer under every editor shell:
// document store (undo/redo, selection), session context, engine-sync
// hook, source diffing, and the pure stage/timeline math. UI-free —
// shells own all chrome.

export { createEditorStore } from './store.js';
export type {
  EditorState,
  EditorStore,
  EditorPlaybackState,
  EditorUiState,
} from './store.js';

export { EditorContext, useEditorContext } from './context.js';
export type { EditorContextValue } from './context.js';

export { createLocalAssetStore, createMemoryAssetStore } from './asset-store.js';
export type { AssetStore, ClipkitAsset, AssetKind } from './asset-store.js';

export { useEditor } from './useEditor.js';
export type { UseEditorReturn } from './useEditor.js';
export { useEditorStore } from './useEditorStore.js';

export { usePlaybackSession } from './usePlaybackSession.js';
export type { PlaybackSessionOptions } from './usePlaybackSession.js';

export { computeElementPatches } from './source-diff.js';

export type { ToolId } from './types.js';

export * from './timeline-utils.js';
export * from './stage-utils.js';

// Registry — derive → override → configuration (EDITORS-PLAN D2).
export { buildEditorRegistry } from './registry/build.js';
export {
  ADVANCED_CONFIGURATION,
  BASIC_CONFIGURATION,
  configurationView,
  exposedKnobs,
  isKnobExposed,
} from './registry/configuration.js';
export type {
  EditorConfiguration,
  EditorViewsConfiguration,
} from './registry/configuration.js';
export type {
  CompositeSpec,
  ControlKind,
  EditorRegistry,
  FieldOverride,
  FieldSpec,
  ScopeRegistry,
} from './registry/types.js';
