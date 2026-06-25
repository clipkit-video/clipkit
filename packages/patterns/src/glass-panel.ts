// glassPanel — a refractive glass card / pill (optionally labelled). Reads
// whatever is drawn beneath it as its backdrop, so place it over content.
//
// COMPONENT pattern: returns ONE plain `group`.

import type { Element } from '@clipkit/protocol';
import { assignLayers, type UnlayeredElement } from './layers.js';
import { getFonts, getPalette, type ColorName, type ThemeName } from './theme.js';

export interface GlassPanelProps {
  id: string;
  /** Center in canvas px. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Corner radius. Default = pill (height/2). */
  radius?: number;
  /** Centered label text. */
  label?: string;
  labelSize?: number;
  color: ColorName;
  theme?: ThemeName;
  /** Frost amount (0 = clear glass). Default 8. */
  blur?: number;
  time: number;
  duration: number;
  layer: number;
}

export function glassPanel(props: GlassPanelProps): Element {
  const { id, x, y, width: W, height: H, label, color, time, duration, layer } = props;
  const theme = props.theme ?? 'cinematic';
  const palette = getPalette(theme, color);
  const fonts = getFonts(theme);
  const radius = props.radius ?? H / 2;

  const children: UnlayeredElement[] = [
    {
      id: `${id}-glass`, type: 'shape', shape: 'rectangle', x: W / 2, y: H / 2, x_anchor: '50%', y_anchor: '50%', width: W, height: H,
      border_radius: radius, fill_color: '#ffffff',
      effects: [{ type: 'glass', blur_radius: props.blur ?? 8, refraction: 14, edge_highlight: 1, tint: palette.accent }],
    },
  ];
  if (label) {
    children.push({
      id: `${id}-label`, type: 'text', text: label, x: W / 2, y: H / 2, x_anchor: '50%', y_anchor: '50%',
      font_family: fonts.sans, font_size: props.labelSize ?? 22, font_weight: '700', fill_color: palette.text,
    });
  }

  return {
    id, type: 'group', layer, time, duration, x, y, x_anchor: '50%', y_anchor: '50%', width: W, height: H,
    animations: [{ type: 'scale-in', duration: 0.5, easing: 'ease-out-back' }, { type: 'fade-in', duration: 0.4 }, { type: 'fade-out', time: 'end', duration: 0.4 }],
    elements: assignLayers(children),
  };
}
