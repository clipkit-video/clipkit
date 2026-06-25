// PieCard — a vertical card with an animated pie chart on top, percentage
// + supporting count, optional trend pill, optional logo placeholder,
// and a label at the bottom. The unit used in the Mux "Top browsers"
// scene.
//
// The pie chart uses the path shape stroke-evolution trick: a circle path
// with stroke_progress animated 0 → percentage/100 and a stroke width
// equal to the circle's radius (so the "stroke" fills the entire disc as
// a growing pie slice).

import type { Element } from '@clipkit/protocol';
import { getFonts, getPalette, type ColorName, type ThemeName } from './theme.js';
import { trendPct, trendPill } from './trend-pill.js';

export interface PieCardProps {
  id: string;
  /** Raw value backing the percentage + count display. */
  value: number;
  /** Total used to compute the displayed percentage. */
  total: number;
  /** Previous-period value. If set, a trend pill is rendered. */
  previous?: number;
  /** Bottom label (e.g. "Chrome"). */
  label: string;
  /**
   * Optional logo image URL. If supplied, an image element is layered
   * over the white logo background. The image is sized 100 × 100.
   */
  logoUrl?: string;
  /**
   * Color slot — drives the trend pill colors. The pie itself is drawn
   * in white over a colored body background.
   */
  color: ColorName;
  theme?: ThemeName;
  /** Center x of the card. */
  cx: number;
  time: number;
  duration: number;
  /**
   * Index used to stagger the entrance across multiple cards in a row.
   */
  staggerIndex?: number;
  layerBase: number;
}

const FRAME = 1 / 30;

// One decimal, trailing ".0" stripped (e.g. 64.2 → "64.2", 50 → "50").
function formatPct(p: number): string {
  return p.toFixed(1).replace(/\.0$/, '');
}

export function pieCard(props: PieCardProps): Element[] {
  const {
    id, value, total, previous, label, logoUrl, color, cx, time, duration, layerBase,
  } = props;
  const theme = props.theme ?? 'mux';
  const palette = getPalette(theme, color);
  const fonts = getFonts(theme);
  const i = props.staggerIndex ?? 0;
  const stagger = (10 + 5 * i) * FRAME;
  const pct = total > 0 ? (value / total) * 100 : 0;

  const out: Element[] = [];

  // Pie chart — circle path with growing stroke. ViewBox is 20 × 20 so
  // stroke-width 10 fills the entire disc when stroke_progress = 1.
  out.push({
    id: `${id}-pie`,
    type: 'shape',
    layer: layerBase,
    time: time + stagger,
    duration: duration - stagger,
    x: cx,
    y: 460,
    x_anchor: '50%',
    y_anchor: '50%',
    width: 320,
    height: 320,
    view_box: [0, 0, 20, 20],
    paths: [
      {
        // Circle starting at top (12 o'clock), sweeping clockwise.
        d: 'M 10 5 A 5 5 0 1 0 10 15 A 5 5 0 1 0 10 5 Z',
        stroke: palette.measure,
        stroke_width: 10,
        stroke_progress: [
          { time: 0, value: 0 },
          { time: 0.8, value: pct / 100, easing: 'ease-out-cubic' },
        ],
      },
    ],
  });

  // Percentage centered on the pie.
  out.push({
    id: `${id}-pct`,
    type: 'text',
    layer: layerBase + 1,
    time: time + stagger,
    duration: duration - stagger,
    text: `${formatPct(pct)}%`,
    x: cx,
    y: 440,
    x_anchor: '50%',
    y_anchor: '50%',
    font_family: fonts.sans,
    font_size: 64,
    font_weight: '400',
    fill_color: palette.text,
    animations: [{ type: 'fade-in', duration: 0.4 }],
  });

  // Supporting view count under the percentage.
  out.push({
    id: `${id}-count`,
    type: 'text',
    layer: layerBase + 2,
    time: time + stagger + 5 * FRAME,
    duration: duration - (stagger + 5 * FRAME),
    text: `${new Intl.NumberFormat('en-US').format(value)} views`,
    x: cx,
    y: 510,
    x_anchor: '50%',
    y_anchor: '50%',
    font_family: fonts.sans,
    font_size: 32,
    font_weight: '400',
    fill_color: palette.text,
    animations: [{ type: 'fade-in', duration: 0.4 }],
  });

  // Trend pill.
  if (typeof previous === 'number') {
    out.push(
      ...trendPill({
        id: `${id}-pill`,
        layerBase: layerBase + 4,
        time: time + stagger + 10 * FRAME,
        duration: duration - (stagger + 10 * FRAME),
        cx,
        cy: 700,
        color,
        theme,
        delta: trendPct(value, previous),
        width: 380,
        height: 50,
      }),
    );
  }

  // White rounded-square background for the logo.
  out.push({
    id: `${id}-logo-bg`,
    type: 'shape',
    layer: layerBase + 8,
    time: time + stagger + 15 * FRAME,
    duration: duration - (stagger + 15 * FRAME),
    shape: 'rectangle',
    x: cx,
    y: 850,
    x_anchor: '50%',
    y_anchor: '50%',
    width: 132,
    height: 132,
    fill_color: '#ffffff',
    border_radius: 16,
    animations: [
      { type: 'fade-in', duration: 0.4 },
      { type: 'scale-in', duration: 0.5, easing: 'ease-out-back' },
    ],
  });

  // Logo image (if URL given).
  if (logoUrl) {
    out.push({
      id: `${id}-logo`,
      type: 'image',
      layer: layerBase + 9,
      time: time + stagger + 17 * FRAME,
      duration: duration - (stagger + 17 * FRAME),
      source: logoUrl,
      x: cx,
      y: 850,
      x_anchor: '50%',
      y_anchor: '50%',
      width: 100,
      height: 100,
      animations: [
        { type: 'fade-in', duration: 0.4 },
        { type: 'scale-in', duration: 0.5, easing: 'ease-out-back' },
      ],
    });
  }

  // Card label at bottom.
  out.push({
    id: `${id}-label`,
    type: 'text',
    layer: layerBase + 10,
    time: time + stagger + 18 * FRAME,
    duration: duration - (stagger + 18 * FRAME),
    text: label,
    x: cx,
    y: 980,
    x_anchor: '50%',
    y_anchor: '50%',
    font_family: fonts.sans,
    font_size: 36,
    font_weight: '400',
    fill_color: palette.text,
    animations: [{ type: 'fade-in', duration: 0.4 }],
  });

  return out;
}
