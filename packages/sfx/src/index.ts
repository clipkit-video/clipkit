// @clipkit/sfx — standalone procedural sound-effects engine.
//
//   • synthesis primitives (whoosh, impact, riser, pop, glitch, …)
//   • a pro finishing chain (finish) — transient/air/anti-alias/comp/width
//   • a browsable named catalog (listSfx / renderSfx) — for an editor audio tab
//
// Pure DSP, no dependencies. Used by @clipkit/score (sound design) and the editor.

export {
  whoosh, impact, riser, subDrop, pop, tick, braam, downlifter, sweep, glitch, shimmer, glueBus,
  type Sfx, type Pan,
  type WhooshOptions, type ImpactOptions, type RiserOptions, type SubDropOptions, type PopOptions,
  type TickOptions, type BraamOptions, type DownlifterOptions, type SweepOptions, type GlitchOptions, type ShimmerOptions,
} from './sfx.js';
export { finish, type FinishOptions } from './finish.js';
export { encodeWav } from './encode-wav.js';
export {
  SFX_CATALOG, listSfx, sfxCategories, renderSfx,
  type SfxEntry, type RenderSfxOptions,
} from './catalog.js';
