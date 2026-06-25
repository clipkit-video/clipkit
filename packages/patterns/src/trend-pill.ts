// TrendPill — small "+X.X% FROM LAST MONTH" pill with a colored border.
//
// Renders as three stacked elements: an outer rectangle in the accent
// color, a slightly smaller inner rectangle in the body background, and
// uppercase monospace text on top. Animates in with fade + slide-up.

import type { Element } from '@clipkit/protocol';
import { getFonts, getPalette, type ColorName, type ThemeName } from './theme.js';

export interface TrendPillProps {
  /** Unique id prefix; pattern appends -border / -inner / -text. */
  id: string;
  /** Center x in canvas pixels. */
  cx: number;
  /** Center y in canvas pixels. */
  cy: number;
  /**
   * Signed percentage. Positive renders as "+X.X% FROM LAST MONTH",
   * negative as "-X.X% FROM LAST MONTH".
   */
  delta: number;
  /** Color slot — determines border, bg, and text colors. */
  color: ColorName;
  /** Theme bundle. Default 'mux'. */
  theme?: ThemeName;
  /** Pill width in pixels. Default 460. */
  width?: number;
  /** Pill height in pixels. Default 60. */
  height?: number;
  /** Scene-local start time in seconds. */
  time: number;
  /** Duration in seconds. */
  duration: number;
  /** Starting layer index; pattern uses layerBase..layerBase+2. */
  layerBase: number;
}

export function trendPill(props: TrendPillProps): Element[] {
  const {
    id, cx, cy, delta, color, time, duration, layerBase,
  } = props;
  const theme = props.theme ?? 'mux';
  const width = props.width ?? 460;
  const height = props.height ?? 60;

  const palette = getPalette(theme, color);
  const fonts = getFonts(theme);

  const sign = delta >= 0 ? '+' : '-';
  const text = `${sign}${Math.abs(delta).toFixed(1)}% FROM LAST MONTH`;

  const slide = [
    { type: 'fade-in' as const, duration: 0.4 },
    { type: 'slide-up-in' as const, duration: 0.6, easing: 'ease-out-cubic' as const },
  ];

  return [
    {
      id: `${id}-border`,
      type: 'shape',
      layer: layerBase,
      time,
      duration,
      shape: 'rectangle',
      x: cx,
      y: cy,
      x_anchor: '50%',
      y_anchor: '50%',
      width,
      height,
      fill_color: palette.accentDark,
      border_radius: 12,
      animations: slide,
    },
    {
      id: `${id}-inner`,
      type: 'shape',
      layer: layerBase + 1,
      time,
      duration,
      shape: 'rectangle',
      x: cx,
      y: cy,
      x_anchor: '50%',
      y_anchor: '50%',
      width: width - 6,
      height: height - 6,
      fill_color: palette.bg,
      border_radius: 10,
      animations: slide,
    },
    {
      id: `${id}-text`,
      type: 'text',
      layer: layerBase + 2,
      time,
      duration,
      text,
      x: cx,
      // Nudged 4 px so uppercase glyphs look optically centered (geometric
      // centering of uppercase text appears slightly too high).
      y: cy + 4,
      x_anchor: '50%',
      y_anchor: '50%',
      font_family: fonts.mono,
      font_size: 26,
      font_weight: '600',
      letter_spacing: 1.5,
      fill_color: palette.accentDark,
      animations: slide,
    },
  ];
}

/** Convenience — signed percentage change from previous → current. */
export function trendPct(current: number, previous: number): number {
  if (previous === 0) return current === 0 ? 0 : 100;
  return ((current - previous) / previous) * 100;
}
