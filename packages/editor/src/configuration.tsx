// ConfigurationContext — the EditorConfiguration for this editor
// instance, plus the resolved registry it filters. Provided once by
// the root; every panel reads it instead of hard-coding what exists.

import { createContext, useContext } from 'react';
import {
  buildEditorRegistry,
  type EditorConfiguration,
  type EditorRegistry,
} from '@clipkit/editor-core';

export interface ConfigurationContextValue {
  configuration: EditorConfiguration;
  registry: EditorRegistry;
}

export const ConfigurationContext =
  createContext<ConfigurationContextValue | null>(null);

export function useConfiguration(): ConfigurationContextValue {
  const ctx = useContext(ConfigurationContext);
  if (!ctx) {
    throw new Error('useConfiguration must be used inside <Editor>.');
  }
  return ctx;
}

/** The registry is pure data derived from the protocol — build once
 * per module, shared by every editor instance. */
let cachedRegistry: EditorRegistry | null = null;
export function getRegistry(): EditorRegistry {
  cachedRegistry ??= buildEditorRegistry();
  return cachedRegistry;
}
