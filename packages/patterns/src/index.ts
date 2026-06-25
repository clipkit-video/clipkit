// @clipkit/patterns — authoring-time pattern library.
//
// Patterns are TypeScript functions that take params + a theme and emit
// arrays of primitive Clipkit Source elements. They are NOT a runtime
// concept: the resulting Source JSON references only the primitives
// declared in @clipkit/protocol. The runtime never sees a "pattern".
//
// Model mirrors shadcn/ui — copy the pattern source if you need a custom
// look, don't pile on parameters.

export { headerBar, type HeaderBarProps } from './header-bar.js';
export { statBlock, type StatBlockProps } from './stat-block.js';
export { barChartRow, type BarChartRowProps } from './bar-chart-row.js';
export { rankedList, type RankedListItem, type RankedListProps } from './ranked-list.js';
export { pieCard, type PieCardProps } from './pie-card.js';

// Data-viz SCENES — full-frame compositions (headerBar + data patterns) that
// promo() can sequence, so "make me a stats / chart / top-10 video" works.
export {
  statsScene,
  barsScene,
  rankingScene,
  pieScene,
  type StatsSceneProps,
  type BarsSceneProps,
  type RankingSceneProps,
  type PieSceneProps,
  type StatItem,
  type BarItem,
  type PieItem,
} from './data-scenes.js';

// liquidMorph — shape → travelling path → shape, with liquid blob in-betweens
// (the Transition Tour morph, generalized).
export { liquidMorph, type LiquidMorphProps, type MorphShape } from './liquid-morph.js';

// Component patterns — each returns ONE `group` element (move / animate /
// time-remap the whole unit) that expands to plain primitives. This is
// the protocol's "pre-comp" answer: reuse lives in authoring functions,
// not in a schema element.
export { introCard, type IntroCardProps } from './intro-card.js';
export { lowerThird, type LowerThirdProps } from './lower-third.js';
export { tiltedShowcase, type TiltedShowcaseProps } from './tilted-showcase.js';
export { cameraOrbit, type CameraOrbitProps } from './camera-orbit.js';
export { litSurface, type LitSurfaceProps } from './lit-surface.js';

// Cinematic patterns (dark theme) + the Source-level composer.
export { heroReveal, type HeroRevealProps } from './hero-reveal.js';
export { glassPanel, type GlassPanelProps } from './glass-panel.js';
export { ctaOutro, type CtaOutroProps } from './cta-outro.js';
export { kineticHeadline, type KineticHeadlineProps } from './kinetic-headline.js';
export { promo, type PromoOptions, type Scene, type SceneCtx } from './promo.js';

// Internal helper, exported so callers can use it directly when they
// don't want a full StatBlock / BarChartRow.
export { trendPill, trendPct, type TrendPillProps } from './trend-pill.js';

// Beat-sync — map a @clipkit/music-analysis BeatMap onto motion.
export {
  pulseToTempo,
  accentOnBeats,
  snapToBeat,
  revealOnBeat,
  slideOnBeat,
  type PulseToTempoOptions,
  type AccentOnBeatsOptions,
  type RevealOnBeatOptions,
  type SlideOnBeatOptions,
} from './beat-sync.js';

// Theme primitives.
export {
  THEMES,
  getPalette,
  getFonts,
  type ThemeName,
  type ColorName,
  type ColorPalette,
  type Theme,
} from './theme.js';
