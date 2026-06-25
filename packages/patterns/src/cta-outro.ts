// ctaOutro — closing card: serif wordmark, tagline, and a glass CTA pill.
//
// COMPONENT pattern: returns ONE plain `group`.

import type { Element } from '@clipkit/protocol';
import { assignLayers, type UnlayeredElement } from './layers.js';
import { getFonts, getPalette, type ColorName, type ThemeName } from './theme.js';

export interface CtaOutroProps {
  id: string;
  wordmark: string;
  tagline?: string;
  /** Button label, e.g. "Start free". */
  cta: string;
  color: ColorName;
  theme?: ThemeName;
  canvasWidth: number;
  canvasHeight: number;
  time: number;
  duration: number;
  layer: number;
}

export function ctaOutro(props: CtaOutroProps): Element {
  const { id, wordmark, tagline, cta, color, canvasWidth: W, canvasHeight: H, time, duration, layer } = props;
  const theme = props.theme ?? 'cinematic';
  const palette = getPalette(theme, color);
  const fonts = getFonts(theme);
  const cx = W / 2, cy = H / 2;
  const btnW = 220, btnH = 62;

  const children: UnlayeredElement[] = [
    {
      id: `${id}-wordmark`, type: 'text', text: wordmark, x: cx, y: cy - 60, x_anchor: '50%', y_anchor: '50%',
      font_family: fonts.display, font_size: 88, font_weight: '700', letter_spacing: 8, fill_color: palette.text,
      animations: [{ type: 'scale-in', duration: 1.0, easing: 'ease-out' }, { type: 'fade-in', duration: 0.6 }],
    },
  ];
  if (tagline) {
    children.push({
      id: `${id}-tagline`, type: 'text', text: tagline, x: cx, y: cy + 6, x_anchor: '50%', y_anchor: '50%', time: 0.3,
      font_family: fonts.sans, font_size: 24, letter_spacing: 2, fill_color: palette.textMuted,
      animations: [{ type: 'fade-in', duration: 0.6 }],
    });
  }
  // glass CTA pill (refracts the dark backdrop) + label
  children.push(
    {
      id: `${id}-btn`, type: 'shape', shape: 'rectangle', x: cx, y: cy + 84, x_anchor: '50%', y_anchor: '50%', width: btnW, height: btnH, border_radius: btnH / 2,
      fill_color: '#ffffff', time: 0.6,
      effects: [{ type: 'glass', blur_radius: 6, refraction: 14, edge_highlight: 1, tint: palette.accent }],
      animations: [{ type: 'scale-in', duration: 0.5, easing: 'ease-out-back' }, { type: 'fade-in', duration: 0.4 }],
    },
    {
      id: `${id}-btn-label`, type: 'text', text: cta, x: cx, y: cy + 84, x_anchor: '50%', y_anchor: '50%', time: 0.75,
      font_family: fonts.sans, font_size: 22, font_weight: '700', fill_color: palette.text,
      animations: [{ type: 'fade-in', duration: 0.4 }],
    },
  );

  return {
    id, type: 'group', layer, time, duration, x: 0, y: 0, width: W, height: H,
    animations: [{ type: 'fade-out', time: 'end', duration: 0.5 }],
    elements: assignLayers(children),
  };
}
