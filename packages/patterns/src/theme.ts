// Pattern theming.
//
// Each pattern accepts a `theme` (named bundle) + a `color` (named accent
// inside that theme) and reads its palette via getPalette(theme, color).
// Patterns DON'T accept arbitrary color overrides; if you need a custom
// look, copy the pattern source and tweak it. Same model as shadcn.
//
// To add a theme, extend THEMES below. To add a color within a theme,
// extend that theme's palette map. Patterns will pick it up automatically
// as long as the color name is listed in ColorName.

import type { FontFace } from '@clipkit/protocol';

export type ThemeName = 'mux' | 'minimal' | 'cinematic';
export type ColorName =
  | 'pink'
  | 'green'
  | 'blue'
  | 'lavender'
  | 'purple'
  | 'yellow'
  | 'gray';

export interface ColorPalette {
  /** Light background tint — used for body fills and pill interiors. */
  bg: string;
  /** Mid-weight accent — borders, dividers, secondary text. */
  accent: string;
  /** Dark accent — top borders, big headline text, pill borders + text. */
  accentDark: string;
  /** Color of the foreground "measure" bar (white in Mux). */
  measure: string;
  /** Primary body text color (black-ish). */
  text: string;
  /** Secondary / muted text. */
  textMuted: string;
}

export interface Theme {
  sansFont: string;
  monoFont: string;
  /** Display/serif face for big hero wordmarks (falls back to sansFont). */
  displayFont?: string;
  /** Webfonts to register on the Source so non-system faces actually load. */
  fontFaces?: FontFace[];
  /** When true, the theme's canvas is dark — patterns pick light defaults. */
  dark?: boolean;
  palettes: Record<ColorName, ColorPalette>;
}

const MUX_BLACK = '#252525';
const MUX_GRAY = '#8e8e8e';
const WHITE = '#ffffff';

// Cinematic webfonts (fontsource CDN) — Inter for UI, Playfair for the wordmark.
const INTER = (w: number) => `https://cdn.jsdelivr.net/npm/@fontsource/inter/files/inter-latin-${w}-normal.woff2`;
const PLAYFAIR = (w: number) => `https://cdn.jsdelivr.net/npm/@fontsource/playfair-display/files/playfair-display-latin-${w}-normal.woff2`;
const CINE_BG = '#0a0e16', CINE_TEXT = '#f2f5fb', CINE_MUTE = '#8a98b8';
const cinePalette = (accent: string, accentDark: string): ColorPalette =>
  ({ bg: CINE_BG, accent, accentDark, measure: WHITE, text: CINE_TEXT, textMuted: CINE_MUTE });

export const THEMES: Record<ThemeName, Theme> = {
  mux: {
    sansFont: 'Helvetica Neue, Helvetica, Arial, sans-serif',
    monoFont: 'Menlo, Monaco, Consolas, monospace',
    palettes: {
      pink: { bg: '#ffecf6', accent: '#fb2491', accentDark: '#d91377', measure: WHITE, text: MUX_BLACK, textMuted: MUX_GRAY },
      green: { bg: '#eaf9e4', accent: '#1FC3A8', accentDark: '#17A089', measure: WHITE, text: MUX_BLACK, textMuted: MUX_GRAY },
      blue: { bg: '#e5f4ff', accent: '#1CA0FD', accentDark: '#0B85DB', measure: WHITE, text: MUX_BLACK, textMuted: MUX_GRAY },
      lavender: { bg: '#f5e4ff', accent: '#9620D8', accentDark: '#6e15a0', measure: WHITE, text: MUX_BLACK, textMuted: MUX_GRAY },
      purple: { bg: '#f5e4ff', accent: '#9620D8', accentDark: '#6e15a0', measure: WHITE, text: MUX_BLACK, textMuted: MUX_GRAY },
      yellow: { bg: '#FFF8E0', accent: '#FED32F', accentDark: '#E99001', measure: WHITE, text: MUX_BLACK, textMuted: MUX_GRAY },
      gray: { bg: '#f5f5f5', accent: '#8e8e8e', accentDark: '#383838', measure: WHITE, text: MUX_BLACK, textMuted: MUX_GRAY },
    },
  },
  minimal: {
    sansFont: 'system-ui, -apple-system, sans-serif',
    monoFont: 'monospace',
    palettes: {
      pink: { bg: '#fafafa', accent: '#d4d4d4', accentDark: '#525252', measure: WHITE, text: '#0a0a0a', textMuted: '#737373' },
      green: { bg: '#fafafa', accent: '#d4d4d4', accentDark: '#525252', measure: WHITE, text: '#0a0a0a', textMuted: '#737373' },
      blue: { bg: '#fafafa', accent: '#d4d4d4', accentDark: '#525252', measure: WHITE, text: '#0a0a0a', textMuted: '#737373' },
      lavender: { bg: '#fafafa', accent: '#d4d4d4', accentDark: '#525252', measure: WHITE, text: '#0a0a0a', textMuted: '#737373' },
      purple: { bg: '#fafafa', accent: '#d4d4d4', accentDark: '#525252', measure: WHITE, text: '#0a0a0a', textMuted: '#737373' },
      yellow: { bg: '#fafafa', accent: '#d4d4d4', accentDark: '#525252', measure: WHITE, text: '#0a0a0a', textMuted: '#737373' },
      gray: { bg: '#fafafa', accent: '#d4d4d4', accentDark: '#525252', measure: WHITE, text: '#0a0a0a', textMuted: '#737373' },
    },
  },
  cinematic: {
    sansFont: 'Inter',
    monoFont: 'Menlo, Monaco, monospace',
    displayFont: 'Playfair Display',
    dark: true,
    fontFaces: [
      { family: 'Inter', weight: 400, src: INTER(400) },
      { family: 'Inter', weight: 700, src: INTER(700) },
      { family: 'Inter', weight: 800, src: INTER(800) },
      { family: 'Playfair Display', weight: 700, src: PLAYFAIR(700) },
    ],
    palettes: {
      pink: cinePalette('#ff5fae', '#c93d84'),
      green: cinePalette('#2fe6b0', '#17a085'),
      blue: cinePalette('#5fd0ff', '#2a93d4'),
      lavender: cinePalette('#b58cff', '#7d54d4'),
      purple: cinePalette('#9b6cff', '#6e3fd0'),
      yellow: cinePalette('#f0c987', '#c79a4f'),
      gray: cinePalette('#9fb0d8', '#5a6b8f'),
    },
  },
};

export function getPalette(theme: ThemeName, color: ColorName): ColorPalette {
  return THEMES[theme].palettes[color];
}

export function getFonts(theme: ThemeName): { sans: string; mono: string; display: string } {
  const t = THEMES[theme];
  return { sans: t.sansFont, mono: t.monoFont, display: t.displayFont ?? t.sansFont };
}
