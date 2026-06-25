// RankedList — a list of N entries with rank numbers, names, animated
// measure bars, and values. Renders as 1 or 2 columns. Composes on top
// of the same primitives BarChartRow uses, but the rendering is
// simpler (no icon, no trend pill, no count-up) since this is meant
// for "top-10" style scenes.
//
// Used in the Mux "Top 10 videos" and "Top 5 states" scenes.

import type { Element } from '@clipkit/protocol';
import { getFonts, getPalette, type ColorName, type ThemeName } from './theme.js';

export interface RankedListItem {
  /** Label shown after the rank number. */
  label: string;
  /** Numeric value driving the measure-bar width + the displayed value. */
  value: number;
}

export interface RankedListProps {
  id: string;
  items: RankedListItem[];
  /**
   * Maximum used to normalize bar widths. Defaults to items[0].value.
   * Pass explicitly if the list is sorted by some other metric.
   */
  max?: number;
  color: ColorName;
  theme?: ThemeName;
  /** Top-left x of the list (the leftmost column starts here). */
  x: number;
  /** Top y of the list. */
  y: number;
  /** Total width available across all columns. */
  width: number;
  /** Number of columns. Default 1; 2 splits items left half / right half. */
  columns?: 1 | 2;
  /** Gap between columns when columns=2. Default 40. */
  columnGap?: number;
  /** Row height. Default 130. */
  rowHeight?: number;
  /** Font size for rank, name, value. Default 46. */
  fontSize?: number;
  time: number;
  duration: number;
  layerBase: number;
}

const FRAME = 1 / 30;

export function rankedList(props: RankedListProps): Element[] {
  const {
    id, items, color, x, y, width, time, duration, layerBase,
  } = props;
  const theme = props.theme ?? 'mux';
  const palette = getPalette(theme, color);
  const fonts = getFonts(theme);
  const cols = props.columns ?? 1;
  const colGap = props.columnGap ?? 40;
  const rowH = props.rowHeight ?? 130;
  const fontSize = props.fontSize ?? 46;
  const max = props.max ?? (items.length > 0 ? items[0]!.value : 1);
  const colW = cols === 2 ? (width - colGap) / 2 : width;

  const out: Element[] = [];
  const itemsPerCol = cols === 2 ? Math.ceil(items.length / 2) : items.length;

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const colIdx = i < itemsPerCol ? 0 : 1;
    const rowIdx = i % itemsPerCol;
    const rowTop = y + rowIdx * rowH;
    const rowX = x + colIdx * (colW + colGap);
    const rowRight = rowX + colW;
    const rowLayer = layerBase + i * 10;
    const stagger = (10 + 6 * i) * FRAME;

    // Animated measure bar.
    const measurePct = max > 0 ? (item.value / max) * 100 : 0;
    const measureFullW = (colW * measurePct) / 100;
    out.push({
      id: `${id}-measure-${i}`,
      type: 'shape',
      layer: rowLayer,
      time: time + stagger,
      duration: duration - stagger,
      shape: 'rectangle',
      x: rowX,
      y: rowTop,
      x_anchor: 0,
      y_anchor: 0,
      width: measureFullW,
      height: rowH,
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

    // Top border.
    out.push({
      id: `${id}-border-${i}`,
      type: 'shape',
      layer: rowLayer + 1,
      time,
      duration,
      shape: 'rectangle',
      x: rowX + colW / 2,
      y: rowTop,
      x_anchor: '50%',
      y_anchor: '50%',
      width: colW,
      height: 3,
      fill_color: palette.accent,
    });

    // Rank ("01.", "02.", ...).
    const rankStr = items.length >= 10 ? `${i + 1}.` : `0${i + 1}.`;
    out.push({
      id: `${id}-rank-${i}`,
      type: 'text',
      layer: rowLayer + 2,
      time: time + stagger,
      duration: duration - stagger,
      text: rankStr,
      x: rowX + 30,
      y: rowTop + rowH / 2,
      x_anchor: 0,
      font_family: fonts.sans,
      font_size: fontSize,
      font_weight: '400',
      fill_color: palette.accentDark,
      animations: [{ type: 'fade-in', duration: 0.4 }],
    });

    // Label.
    out.push({
      id: `${id}-label-${i}`,
      type: 'text',
      layer: rowLayer + 3,
      time: time + stagger + 2 * FRAME,
      duration: duration - (stagger + 2 * FRAME),
      text: item.label,
      x: rowX + 100,
      y: rowTop + rowH / 2,
      x_anchor: 0,
      font_family: fonts.sans,
      font_size: fontSize,
      font_weight: '400',
      fill_color: palette.text,
      animations: [{ type: 'fade-in', duration: 0.4 }],
    });

    // Value (right-aligned).
    out.push({
      id: `${id}-value-${i}`,
      type: 'text',
      layer: rowLayer + 4,
      time: time + stagger + 4 * FRAME,
      duration: duration - (stagger + 4 * FRAME),
      text: new Intl.NumberFormat('en-US').format(item.value),
      x: rowRight - 30,
      y: rowTop + rowH / 2,
      x_anchor: 1,
      font_family: fonts.sans,
      font_size: fontSize,
      font_weight: '400',
      fill_color: palette.text,
      animations: [{ type: 'fade-in', duration: 0.4 }],
    });
  }

  return out;
}
