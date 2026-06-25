// kineticHeadline — a bold headline that flies in letter-by-letter
// (text-fly), with an optional accent rule. Pair with source motion blur
// for the smeared, professional look.
//
// COMPONENT pattern: returns ONE plain `group`.

import type { Element } from '@clipkit/protocol';
import { assignLayers, type UnlayeredElement } from './layers.js';
import { getFonts, getPalette, type ColorName, type ThemeName } from './theme.js';

export interface KineticHeadlineProps {
  id: string;
  text: string;
  subtitle?: string;
  color: ColorName;
  theme?: ThemeName;
  canvasWidth: number;
  canvasHeight: number;
  /** Stagger between letters, seconds. Default 0.05. */
  stagger?: number;
  time: number;
  duration: number;
  layer: number;
}

export function kineticHeadline(props: KineticHeadlineProps): Element {
  const { id, text, subtitle, color, canvasWidth: W, canvasHeight: H, time, duration, layer } = props;
  const theme = props.theme ?? 'cinematic';
  const palette = getPalette(theme, color);
  const fonts = getFonts(theme);
  const cx = W / 2, cy = H / 2;

  const children: UnlayeredElement[] = [
    {
      id: `${id}-headline`, type: 'text', text, x: cx, y: cy, x_anchor: '50%', y_anchor: '50%',
      font_family: fonts.sans, font_size: 112, font_weight: '800', fill_color: palette.text,
      animations: [{ type: 'text-fly', split: 'letter', stagger: props.stagger ?? 0.05, distance: 160, direction: 'up', duration: 0.6, time: 0.2 }],
    },
    {
      id: `${id}-rule`, type: 'shape', shape: 'rectangle', x: cx, y: cy + 86, x_anchor: '50%', y_anchor: '50%', width: 200, height: 6, border_radius: 3,
      fill_color: palette.accent, time: 0.5,
      keyframe_animations: [{ property: 'x_scale', keyframes: [{ time: 0, value: 0 }, { time: 0.5, value: 1, easing: 'ease-out' }] }],
    },
  ];
  if (subtitle) {
    children.push({
      id: `${id}-sub`, type: 'text', text: subtitle, x: cx, y: cy + 130, x_anchor: '50%', y_anchor: '50%', time: 0.7,
      font_family: fonts.sans, font_size: 26, letter_spacing: 1, fill_color: palette.textMuted,
      animations: [{ type: 'fade-in', duration: 0.5 }],
    });
  }

  return {
    id, type: 'group', layer, time, duration, x: 0, y: 0, width: W, height: H,
    animations: [{ type: 'fade-out', time: 'end', duration: 0.5 }],
    elements: assignLayers(children),
  };
}
