// @clipkit/music-analysis — audio → beat map.
//
// Produces an authoring-time beat map (tempo, downbeats, onsets, sections) that
// AI agents and @clipkit/patterns helpers read to sync motion to music. The
// beat map is NOT part of the rendered protocol; consumers bake it down to
// ordinary keyframes/expressions so renders stay deterministic.

// analyzeAudio reads files (node:fs) — it lives behind the Node-only
// '@clipkit/music-analysis/node' subpath so importing the browser-safe helpers
// below (beatGrid etc.) doesn't drag node:fs into client bundles. Mirrors the
// node/browser export split in @clipkit/speech-to-text.
export { beatGrid, type BeatGridOptions } from './grid.js';
export { decodeWav, type DecodedAudio } from './decode-wav.js';
export { analyzePcm, type PcmAnalysis } from './dsp.js';
export type * from './beat-map.js';
