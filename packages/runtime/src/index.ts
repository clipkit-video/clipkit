// @clipkit/runtime — public surface.

export { ClipkitRuntime } from './runtime.js';
export { setLogger, getLogger, type Logger } from './logger.js';

// Pure projection helpers for editor camera-view gizmos (§item 6) —
// render-consistent (reuse the compositor's camera + resolve + matrix).
export {
  projectElementQuad,
  unprojectToPlane,
  elementDepthZ,
  type Pt,
} from './compositor/project.js';

// Composition-time → media-time mapping, shared with the playback
// engine (video pump sync + audio scheduling for video tracks).
export {
  mapToMediaTime,
  trimWindow,
  rateOf,
  timeRemapOf,
  trimDurationOf,
  type MediaTiming,
} from './assets/media-time.js';

// Audio fade envelope, shared with the playback engine's scheduler so
// preview and export gains are identical.
export { fadeBreakpoints, fadeGainAt, type FadePoint } from './audio/fades.js';

// Master output limiter, shared with the playback engine's scheduler so the
// preview master bus and the export master bus apply identical clip protection.
export { createMasterLimiter } from './audio/limiter.js';

// The normative easing evaluator — shared with the editors' curve
// display so the drawn curve IS the curve that renders.
export { applyEasing } from './animation/easings.js';
// Tier-A expression evaluator (editors/tools use compileExpr for live validity).
export { compileExpr, evalExpr, isExpr, type ExprScope } from './animation/expr.js';

// Encoder (still callable directly for advanced use).
export {
  ClipkitExporter,
  resolveRenderResolution,
  type ExportOptions,
  type FrameProducer,
  type RenderResolution,
} from './encoder/exporter.js';

// Re-export schema types so consumers can write
//   `import type { Source } from '@clipkit/runtime'`
// without an extra @clipkit/protocol import for the common case.
export type { Source, Element } from '@clipkit/protocol';

// Caption windowing — split a caption's words into chunks (max_length) and pick
// the chunk active at time t. Shared with the editor timeline so its chunk
// blocks match what the renderer shows.
export { chunkCaptionWords, activeCaptionChunk, type CaptionChunk } from './text/caption-chunk.js';
