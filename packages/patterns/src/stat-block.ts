// StatBlock — themed border line, a big number, label below, optional
// trend pill on the right.
//
// Used for hero stats in a dashboard-style scene. The number is rendered as
// plain comma-grouped text that fades + rises into place — the protocol has
// no text-content animation, so there is no per-digit count-up.

import type { Element } from '@clipkit/protocol';
import { getFonts, getPalette, type ColorName, type ThemeName } from './theme.js';
import { trendPct, trendPill } from './trend-pill.js';

export interface StatBlockProps {
  id: string;
  /** The number being revealed; counts from 0 → this over ~1s. */
  current: number;
  /** Previous-period value. If set, a trend pill is rendered to the right. */
  previous?: number;
  /** Sub-label under the number ("Total views"). */
  label: string;
  /** Color slot — drives the top border + trend pill. */
  color: ColorName;
  theme?: ThemeName;
  /** Top-left x of the block. */
  x: number;
  /** Top-left y of the block. */
  y: number;
  /** Block width — usually the body content width. */
  width: number;
  /** Scene-local start time + duration. */
  time: number;
  duration: number;
  layerBase: number;
}

export function statBlock(props: StatBlockProps): Element[] {
  const {
    id, current, previous, label, color, x, y, width, time, duration, layerBase,
  } = props;
  const theme = props.theme ?? 'mux';
  const palette = getPalette(theme, color);
  const fonts = getFonts(theme);

  const out: Element[] = [];

  // 3-px top border in the dark accent (the "rule" above each stat).
  out.push({
    id: `${id}-border`,
    type: 'shape',
    layer: layerBase,
    time,
    duration,
    shape: 'rectangle',
    x: x + width / 2,
    y,
    x_anchor: '50%',
    y_anchor: '50%',
    width,
    height: 3,
    fill_color: palette.accent,
  });

  // Big number, anchored top-left 50 px below the border; fades + rises in.
  out.push({
    id: `${id}-value`,
    type: 'text',
    layer: layerBase + 1,
    time,
    duration,
    text: new Intl.NumberFormat('en-US').format(current),
    x: x + 60,
    y: y + 50,
    x_anchor: 0,
    y_anchor: 0,
    font_family: fonts.sans,
    font_size: 160,
    font_weight: '300',
    fill_color: palette.text,
    animations: [{ type: 'fade-in', duration: 0.5 }],
    keyframe_animations: [
      {
        property: 'y',
        keyframes: [
          { time: 0, value: y + 50 + 30 },
          { time: 0.6, value: y + 50, easing: 'ease-out' },
        ],
      },
    ],
  });

  // Sub-label.
  out.push({
    id: `${id}-label`,
    type: 'text',
    layer: layerBase + 2,
    time: time + 10 / 30,
    duration: duration - 10 / 30,
    text: label,
    x: x + 60,
    y: y + 240,
    x_anchor: 0,
    y_anchor: 0,
    font_family: fonts.sans,
    font_size: 36,
    font_weight: '400',
    fill_color: palette.text,
    animations: [{ type: 'fade-in', duration: 0.4 }],
  });

  // Optional trend pill on the right.
  if (typeof previous === 'number') {
    out.push(
      ...trendPill({
        id: `${id}-pill`,
        layerBase: layerBase + 3,
        time: time + 15 / 30,
        duration: duration - 15 / 30,
        cx: x + width - 280,
        cy: y + 50,
        color,
        theme,
        delta: trendPct(current, previous),
      }),
    );
  }

  return out;
}
