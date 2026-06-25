// Shared editor-core types. Shell-specific types (component props,
// layout) live in the shells.

/**
 * The dock tools that add new elements. Keep this list narrow — adding
 * a tool means adding an `AddXView` panel and a default element shape.
 */
export type ToolId =
  | 'text'
  | 'shape'
  | 'image'
  | 'video'
  | 'audio'
  | 'caption';
