// Data-viz SCENES — full-frame compositions that turn the element-level
// data patterns (headerBar + statBlock / barChartRow / rankedList / pieCard)
// into single `group` scenes the promo() composer can sequence, the same shape
// as introCard / heroReveal. This is what makes "make me a stats / chart /
// top-10 video" reachable: the caller supplies data, these handle the layout.
//
// Each returns ONE full-frame identity group (x:W/2, y:H/2, W×H) whose children
// use canvas coordinates — exactly like introCard — so the data patterns' own
// absolute x/y land correctly. headerBar frames every scene (white header strip
// + colored body); the data sits in the body area below it.
//
// Tuned for a 1920×1080 canvas (the create_promo default). pieScene in
// particular relies on pieCard's 1080-based vertical layout.

import type { Element } from '@clipkit/protocol';
import { headerBar } from './header-bar.js';
import { statBlock } from './stat-block.js';
import { barChartRow } from './bar-chart-row.js';
import { rankedList, type RankedListItem } from './ranked-list.js';
import { pieCard } from './pie-card.js';
import { assignLayers } from './layers.js';
import type { ColorName, ThemeName } from './theme.js';

const HEADER_H = 216; // matches headerBar
const MARGIN = 80;

interface SceneBase {
  /** Id prefix for every produced element. */
  id: string;
  /** Accent / body color slot. */
  color: ColorName;
  theme?: ThemeName;
  canvasWidth: number;
  canvasHeight: number;
  time: number;
  duration: number;
  layer: number;
  /** Header title (e.g. "Top 10 videos"). */
  title?: string;
  /** Optional right-aligned date range in the header. */
  dateRange?: string;
}

/** Wrap composed children in a full-frame identity group (cf. introCard). */
function sceneGroup(base: SceneBase, children: Element[]): Element {
  const W = base.canvasWidth;
  const H = base.canvasHeight;
  return {
    id: base.id,
    type: 'group',
    layer: base.layer,
    time: base.time,
    duration: base.duration,
    x: 0,
    y: 0,
    width: W,
    height: H,
    animations: [{ type: 'fade-out', time: 'end', duration: 0.5 }],
    // The composer owns layer assignment: `children` is built back-to-front
    // (frame behind, data pushed on top), so stamp dense layers with the
    // front-most = layer 1. This overrides the builders' relative layerBase
    // offsets with a correct, unique-per-container ordering (layer 1 = top).
    elements: assignLayers(children),
  };
}

/** The white header strip + colored body fill that frames every data scene. */
function frame(base: SceneBase): Element[] {
  return headerBar({
    id: `${base.id}-hdr`,
    title: base.title ?? '',
    ...(base.dateRange ? { dateRange: base.dateRange } : {}),
    bodyColor: base.color,
    ...(base.theme ? { theme: base.theme } : {}),
    canvasWidth: base.canvasWidth,
    canvasHeight: base.canvasHeight,
    time: 0,
    duration: base.duration,
    layerBase: 1,
  });
}

export interface StatItem {
  label: string;
  /** Counts 0 → this over ~1s. */
  current: number;
  /** Previous-period value; if set, a trend pill is shown. */
  previous?: number;
}

export interface StatsSceneProps extends SceneBase {
  /** 1–4 hero stats, laid out in a centered 1- or 2-column grid. */
  stats: StatItem[];
}

/** Hero-stat scene: headerBar + a centered grid of spring-counted statBlocks. */
export function statsScene(props: StatsSceneProps): Element {
  const { canvasWidth: W, canvasHeight: H, color, theme, duration } = props;
  const contentX = MARGIN;
  const contentW = W - 2 * MARGIN;
  const bodyTop = HEADER_H;
  const bodyH = H - HEADER_H;

  const children: Element[] = [...frame(props)];

  const n = props.stats.length;
  const cols = n === 1 ? 1 : 2;
  const rows = Math.ceil(n / cols);
  const colGap = 80;
  const rowStride = 340;
  const blockW = cols === 1 ? contentW : (contentW - colGap) / 2;
  const gridH = rows * rowStride;
  const startY = bodyTop + (bodyH - gridH) / 2;

  props.stats.forEach((s, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    children.push(
      ...statBlock({
        id: `${props.id}-stat${i}`,
        current: s.current,
        ...(s.previous !== undefined ? { previous: s.previous } : {}),
        label: s.label,
        color,
        ...(theme ? { theme } : {}),
        x: contentX + col * (blockW + colGap),
        y: startY + row * rowStride,
        width: blockW,
        time: 0,
        duration,
        layerBase: 20 + i * 10,
      }),
    );
  });

  return sceneGroup(props, children);
}

export interface BarItem {
  label: string;
  value: number;
  previous?: number;
}

export interface BarsSceneProps extends SceneBase {
  /** 1–6 rows; bar widths normalize to the largest value. */
  bars: BarItem[];
}

/** Bar-chart scene: headerBar + a centered vertical stack of barChartRows. */
export function barsScene(props: BarsSceneProps): Element {
  const { canvasWidth: W, canvasHeight: H, color, theme, duration } = props;
  const contentX = MARGIN;
  const contentW = W - 2 * MARGIN;
  const bodyTop = HEADER_H;
  const bodyH = H - HEADER_H;

  const children: Element[] = [...frame(props)];

  const n = props.bars.length;
  const max = Math.max(...props.bars.map((b) => b.value), 1);
  const rowH = 168;
  const gap = 48;
  const rowStride = rowH + gap;
  const totalH = n * rowStride - gap;
  const startY = bodyTop + (bodyH - totalH) / 2;

  props.bars.forEach((b, i) => {
    children.push(
      ...barChartRow({
        id: `${props.id}-bar${i}`,
        value: b.value,
        max,
        ...(b.previous !== undefined ? { previous: b.previous } : {}),
        label: b.label,
        color,
        ...(theme ? { theme } : {}),
        x: contentX,
        y: startY + i * rowStride,
        width: contentW,
        height: rowH,
        time: 0,
        duration,
        staggerIndex: i,
        layerBase: 20 + i * 10,
      }),
    );
  });

  return sceneGroup(props, children);
}

export interface RankingSceneProps extends SceneBase {
  /** Ranked entries; 1 column up to 6, then 2 columns. */
  items: RankedListItem[];
}

/** Ranked-list scene: headerBar + a centered rankedList (auto 1/2 columns). */
export function rankingScene(props: RankingSceneProps): Element {
  const { canvasWidth: W, canvasHeight: H, color, theme, duration } = props;
  const contentX = MARGIN;
  const contentW = W - 2 * MARGIN;
  const bodyTop = HEADER_H;
  const bodyH = H - HEADER_H;

  const children: Element[] = [...frame(props)];

  const n = props.items.length;
  const cols: 1 | 2 = n > 6 ? 2 : 1;
  const rowH = 130;
  const itemsPerCol = cols === 2 ? Math.ceil(n / 2) : n;
  const totalH = itemsPerCol * rowH;
  const startY = bodyTop + (bodyH - totalH) / 2;

  children.push(
    ...rankedList({
      id: `${props.id}-rank`,
      items: props.items,
      color,
      ...(theme ? { theme } : {}),
      x: contentX,
      y: startY,
      width: contentW,
      columns: cols,
      rowHeight: rowH,
      time: 0,
      duration,
      layerBase: 20,
    }),
  );

  return sceneGroup(props, children);
}

export interface PieItem {
  label: string;
  value: number;
  /** Total the value is a share of (drives the displayed percentage). */
  total: number;
  previous?: number;
  /** Optional logo image URL shown under the pie. */
  logoUrl?: string;
}

export interface PieSceneProps extends SceneBase {
  /** 1–4 pie cards laid out in a row. Assumes a ~1080-tall canvas. */
  cards: PieItem[];
}

/** Pie-card scene: headerBar + a row of pieCards. Tuned for H≈1080. */
export function pieScene(props: PieSceneProps): Element {
  const { canvasWidth: W, color, theme, duration } = props;
  const contentX = MARGIN;
  const contentW = W - 2 * MARGIN;

  const children: Element[] = [...frame(props)];

  const m = props.cards.length;
  const slot = contentW / m;

  props.cards.forEach((c, i) => {
    children.push(
      ...pieCard({
        id: `${props.id}-pie${i}`,
        value: c.value,
        total: c.total,
        ...(c.previous !== undefined ? { previous: c.previous } : {}),
        ...(c.logoUrl ? { logoUrl: c.logoUrl } : {}),
        label: c.label,
        color,
        ...(theme ? { theme } : {}),
        cx: contentX + slot * (i + 0.5),
        time: 0,
        duration,
        staggerIndex: i,
        layerBase: 20 + i * 20,
      }),
    );
  });

  return sceneGroup(props, children);
}
