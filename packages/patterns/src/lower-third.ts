// LowerThird — the broadcast name/role strip: an accent bar, a white
// panel with the speaker's name and an optional role line, sliding in
// from the left and exiting before the element window closes.
//
// COMPONENT pattern: returns a single `group` element so the strip is
// positioned, animated, or time-remapped as one unit, and expands to
// plain primitives only (no nested-composition schema element exists —
// reuse is an authoring-function concern, §5.8.3 covers nested time).

import type { Element } from '@clipkit/protocol';
import { assignLayers, type UnlayeredElement } from './layers.js';
import { getFonts, getPalette, type ColorName, type ThemeName } from './theme.js';

export interface LowerThirdProps {
  /** Used as the id prefix for every produced element. */
  id: string;
  /** Speaker / subject name — the bold line. */
  name: string;
  /** Optional role / title line under the name. */
  role?: string;
  /** Accent color slot — drives the leading bar. */
  color: ColorName;
  theme?: ThemeName;
  /**
   * Position of the strip's LEFT EDGE / vertical center, in canvas px.
   * Typical: x = 80, y = canvasHeight - 180.
   */
  x: number;
  y: number;
  time: number;
  duration: number;
  layer: number;
  /** Panel width in px. Default 560. */
  width?: number;
}

export function lowerThird(props: LowerThirdProps): Element {
  const { id, name, role, color, x, y, time, duration, layer } = props;
  const theme = props.theme ?? 'mux';
  const palette = getPalette(theme, color);
  const fonts = getFonts(theme);

  const W = props.width ?? 560;
  const H = role ? 124 : 96;
  const BAR_W = 12;
  const PAD = 28;
  const SLIDE = 0.45;

  // Children are in group-local coordinates ((0,0) = panel top-left).
  const children: UnlayeredElement[] = [
    {
      id: `${id}-panel`,
      type: 'shape',
      shape: 'rectangle',
      x: W / 2,
      y: H / 2,
      x_anchor: '50%',
      y_anchor: '50%',
      width: W,
      height: H,
      fill_color: '#ffffff',
      border_radius: 8,
    },
    {
      id: `${id}-bar`,
      type: 'shape',
      shape: 'rectangle',
      x: BAR_W / 2,
      y: H / 2,
      x_anchor: '50%',
      y_anchor: '50%',
      width: BAR_W,
      height: H,
      fill_color: palette.accent,
      border_radius: 4,
    },
    {
      id: `${id}-name`,
      type: 'text',
      time: 0.15,
      text: name,
      x: BAR_W + PAD,
      y: role ? H / 2 - 22 : H / 2,
      x_anchor: 0,
      y_anchor: '50%',
      font_family: fonts.sans,
      font_size: 40,
      font_weight: '700',
      fill_color: palette.text,
      animations: [{ type: 'fade-in', duration: 0.4 }],
    },
  ];

  if (role) {
    children.push({
      id: `${id}-role`,
      type: 'text',
      time: 0.3,
      text: role,
      x: BAR_W + PAD,
      y: H / 2 + 26,
      x_anchor: 0,
      y_anchor: '50%',
      font_family: fonts.sans,
      font_size: 28,
      fill_color: palette.textMuted,
      animations: [{ type: 'fade-in', duration: 0.4 }],
    });
  }

  return {
    id,
    type: 'group',
    layer,
    time,
    duration,
    x,
    y,
    x_anchor: 0,
    y_anchor: 0.5,
    width: W,
    height: H,
    animations: [
      { type: 'fade-in', duration: SLIDE },
      { type: 'slide-left-in', duration: SLIDE, easing: 'ease-out' },
      { type: 'fade-out', time: 'end', duration: 0.4 },
    ],
    elements: assignLayers(children),
  };
}
