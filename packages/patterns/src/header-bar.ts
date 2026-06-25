// HeaderBar — the scene framing used in dashboard-style videos: a
// colored body fill, a white header strip with a left-aligned logo, a
// centered title, and a right-aligned date range.
//
// The pattern emits the body fill + header background + title + date.
// The logo is BYO — pass an SVG definition (viewBox + paths + optional
// gradients) and the pattern lays it out on the left of the header.

import type { Element, PathGradient, PathDef } from '@clipkit/protocol';
import { getFonts, getPalette, type ColorName, type ThemeName } from './theme.js';

export interface HeaderBarProps {
  /** Used as the id prefix for every produced element. */
  id: string;
  /** Scene title shown in the header center-left. */
  title: string;
  /** Optional right-aligned date range string. */
  dateRange?: string;
  /** Body fill color slot (drives the lower 80% of the canvas). */
  bodyColor: ColorName;
  theme?: ThemeName;
  /** Composition width + height. */
  canvasWidth: number;
  canvasHeight: number;
  /**
   * Optional logo definition. If supplied, the pattern emits an SVG
   * element on the left of the header.
   */
  logo?: {
    viewBox: [number, number, number, number];
    paths: PathDef[];
    gradients?: PathGradient[];
    /** Logo width in canvas px. Default 220. */
    width?: number;
  };
  time: number;
  duration: number;
  /**
   * Starting layer index. The pattern uses layerBase..layerBase+4 (body,
   * header bg, logo, title, date).
   */
  layerBase: number;
}

export function headerBar(props: HeaderBarProps): Element[] {
  const {
    id, title, dateRange, bodyColor, canvasWidth: W, canvasHeight: H,
    logo, time, duration, layerBase,
  } = props;
  const theme = props.theme ?? 'mux';
  const palette = getPalette(theme, bodyColor);
  const grayPalette = getPalette(theme, 'gray');
  const fonts = getFonts(theme);

  const HEADER_H = 216; // 20 % of a 1080-tall canvas; tweak if scaling
  const out: Element[] = [];

  // Colored body fill (below the header).
  out.push({
    id: `${id}-body`,
    type: 'shape',
    layer: layerBase,
    time,
    duration,
    shape: 'rectangle',
    x: W / 2,
    y: HEADER_H + (H - HEADER_H) / 2,
    x_anchor: '50%',
    y_anchor: '50%',
    width: W,
    height: H - HEADER_H,
    fill_color: palette.bg,
  });

  // White header background.
  out.push({
    id: `${id}-header-bg`,
    type: 'shape',
    layer: layerBase + 1,
    time,
    duration,
    shape: 'rectangle',
    x: W / 2,
    y: HEADER_H / 2,
    x_anchor: '50%',
    y_anchor: '50%',
    width: W,
    height: HEADER_H,
    fill_color: '#ffffff',
  });

  // Logo on the left of the header.
  if (logo) {
    const logoW = logo.width ?? 220;
    const logoAspect = logo.viewBox[3] / logo.viewBox[2];
    out.push({
      id: `${id}-logo`,
      type: 'shape',
      layer: layerBase + 2,
      time,
      duration,
      x: 80,
      y: HEADER_H / 2,
      x_anchor: 0,
      y_anchor: 0.5,
      width: logoW,
      height: logoW * logoAspect,
      view_box: logo.viewBox,
      paths: logo.paths,
      ...(logo.gradients ? { gradients: logo.gradients } : {}),
    });
  }

  // Scene title — left-aligned, sits right of the logo.
  out.push({
    id: `${id}-title`,
    type: 'text',
    layer: layerBase + 3,
    time,
    duration,
    text: title,
    x: 380,
    y: HEADER_H / 2,
    x_anchor: 0,
    font_family: fonts.sans,
    font_size: 36,
    font_weight: '400',
    fill_color: '#383838',
    animations: [{ type: 'fade-in', duration: 1.0 }],
  });

  // Date range — right-aligned.
  if (dateRange) {
    out.push({
      id: `${id}-date`,
      type: 'text',
      layer: layerBase + 4,
      time,
      duration,
      text: dateRange,
      x: W - 80,
      y: HEADER_H / 2,
      x_anchor: 1,
      font_family: fonts.sans,
      font_size: 28,
      font_weight: '400',
      fill_color: grayPalette.accent,
      animations: [{ type: 'fade-in', duration: 1.0 }],
    });
  }

  return out;
}
