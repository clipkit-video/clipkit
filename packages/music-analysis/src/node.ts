// Node-only entry for @clipkit/music-analysis.
//
// analyzeAudio reads audio files from disk (node:fs/promises), so it can't be
// part of the browser-safe barrel (index.ts) — importing the barrel for a pure
// helper like beatGrid would otherwise drag node:fs into client bundles and
// break the web build. Authoring-time / CLI / MCP code imports it from here:
//
//   import { analyzeAudio } from '@clipkit/music-analysis/node';

export { analyzeAudio, type AnalyzeOptions } from './analyze.js';
