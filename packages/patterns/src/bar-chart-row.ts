// BarChartRow — single horizontal data row with an animated background
// "measure" bar, top border, value, and optional icon + trend pill. The
// unit used in data-dashboard "views by device" scenes and similar.
//
// The measure bar animates its width property over 1.6s with
// ease-out-quart, approximating a heavily-overdamped
// spring({damping: 60}) — fast start, long slow tail. The value is plain
// text (the protocol has no text-content count-up).

import type { Element, PathDef } from '@clipkit/protocol';
import { getFonts, getPalette, type ColorName, type ThemeName } from './theme.js';
import { trendPct, trendPill } from './trend-pill.js';

export interface BarChartRowProps {
  id: string;
  /** Numeric value driving the count-up + bar width. */
  value: number;
  /** Maximum across the dataset — bar width = value/max × row width. */
  max: number;
  /**
   * Previous-period value. If set, a trend pill is rendered to the right.
   */
  previous?: number;
  /** Right-side label (e.g. "Phone"). */
  label: string;
  /**
   * Optional icon definition rendered on the left. Pass `{ viewBox, paths }`
   * — typically the source data for an path shape.
   */
  icon?: { viewBox: [number, number, number, number]; paths: PathDef[] };
  color: ColorName;
  theme?: ThemeName;
  /** Top-left x of the row. */
  x: number;
  /** Top-left y of the row. */
  y: number;
  /** Row width — usually the body content width. */
  width: number;
  /** Row height (defaults to 168 to match the Mux look). */
  height?: number;
  time: number;
  duration: number;
  /**
   * Index used for the cascading entrance stagger (row 0 enters first,
   * row 1 a couple frames later, etc.). Pass i for the i-th row in a list.
   */
  staggerIndex?: number;
  layerBase: number;
}

const FRAME = 1 / 30; // seconds per frame at 30 fps

export function barChartRow(props: BarChartRowProps): Element[] {
  const {
    id, value, max, previous, label, icon, color, x, y, width, time, duration, layerBase,
  } = props;
  const theme = props.theme ?? 'mux';
  const palette = getPalette(theme, color);
  const fonts = getFonts(theme);
  const height = props.height ?? 168;
  const i = props.staggerIndex ?? 0;
  const stagger = (10 + 8 * i) * FRAME;

  const slide = [
    { type: 'fade-in' as const, duration: 0.33, time: stagger },
    { type: 'slide-up-in' as const, duration: 0.6, easing: 'ease-out-cubic' as const, time: stagger },
  ];

  const out: Element[] = [];

  // Animated measure bar — width grows 0 → (value/max) × row width.
  const measurePct = max > 0 ? (value / max) * 100 : 0;
  const measureFullW = (width * measurePct) / 100;
  out.push({
    id: `${id}-measure`,
    type: 'shape',
    layer: layerBase,
    time: time + stagger + 10 * FRAME,
    duration: duration - (stagger + 10 * FRAME),
    shape: 'rectangle',
    x,
    y,
    x_anchor: 0,
    y_anchor: 0,
    width: measureFullW,
    height,
    fill_color: palette.measure,
    keyframe_animations: [
      {
        property: 'width',
        keyframes: [
          { time: 0, value: 0 },
          { time: 1.6, value: measureFullW, easing: 'ease-out-quart' },
        ],
      },
    ],
  });

  // Top border line.
  out.push({
    id: `${id}-border`,
    type: 'shape',
    layer: layerBase + 1,
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
    animations: slide,
  });

  // Icon on the left, if provided.
  if (icon) {
    const iconAspect = icon.viewBox[2] / icon.viewBox[3];
    const iconHeight = 70;
    const iconWidth = iconHeight * iconAspect;
    out.push({
      id: `${id}-icon`,
      type: 'shape',
      layer: layerBase + 2,
      time,
      duration,
      x: x + 70,
      y: y + height / 2,
      x_anchor: '50%',
      y_anchor: '50%',
      width: iconWidth,
      height: iconHeight,
      view_box: icon.viewBox,
      paths: icon.paths,
      animations: slide,
    });
  }

  // Value (plain text; the protocol has no text-content count-up).
  out.push({
    id: `${id}-value`,
    type: 'text',
    layer: layerBase + 3,
    time: time + stagger,
    duration: duration - stagger,
    text: new Intl.NumberFormat('en-US').format(value),
    x: x + 200,
    y: y + height / 2,
    x_anchor: 0,
    font_family: fonts.sans,
    font_size: 80,
    font_weight: '300',
    fill_color: palette.text,
    animations: [{ type: 'fade-in', duration: 0.4 }],
  });

  // Right-side label.
  out.push({
    id: `${id}-label`,
    type: 'text',
    layer: layerBase + 4,
    time: time + stagger + 5 * FRAME,
    duration: duration - (stagger + 5 * FRAME),
    text: label,
    x: x + 900,
    y: y + height / 2,
    x_anchor: 0,
    font_family: fonts.sans,
    font_size: 36,
    font_weight: '400',
    fill_color: palette.text,
    animations: [{ type: 'fade-in', duration: 0.4 }],
  });

  // Optional trend pill.
  if (typeof previous === 'number') {
    out.push(
      ...trendPill({
        id: `${id}-pill`,
        layerBase: layerBase + 5,
        time: time + stagger + 8 * FRAME,
        duration: duration - (stagger + 8 * FRAME),
        cx: x + width - 240,
        cy: y + height / 2,
        color,
        theme,
        delta: trendPct(value, previous),
        width: 440,
        height: 56,
      }),
    );
  }

  return out;
}
