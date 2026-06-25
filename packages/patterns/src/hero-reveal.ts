// heroReveal — a cinematic logo reveal: a soft accent glow, a refractive
// glass orb, and a serif wordmark with a tagline. The premium opener.
//
// COMPONENT pattern: returns ONE plain `group` (children draw in order so
// the glass orb refracts the glow beneath it; the wordmark sits on top).

import type { Element } from '@clipkit/protocol';
import { assignLayers, type UnlayeredElement } from './layers.js';
import { getFonts, getPalette, type ColorName, type ThemeName } from './theme.js';

export interface HeroRevealProps {
  id: string;
  /** The wordmark — set in the theme's display (serif) face. */
  wordmark: string;
  tagline?: string;
  color: ColorName;
  theme?: ThemeName;
  canvasWidth: number;
  canvasHeight: number;
  time: number;
  duration: number;
  layer: number;
}

export function heroReveal(props: HeroRevealProps): Element {
  const { id, wordmark, tagline, color, canvasWidth: W, canvasHeight: H, time, duration, layer } = props;
  const theme = props.theme ?? 'cinematic';
  const palette = getPalette(theme, color);
  const fonts = getFonts(theme);
  const cx = W / 2, cy = H / 2;

  const children: UnlayeredElement[] = [
    // accent glow forming behind the orb
    {
      id: `${id}-glow`, type: 'shape', shape: 'ellipse', x: cx, y: cy, x_anchor: '50%', y_anchor: '50%', width: 600, height: 600, opacity: 0.5,
      gradient: { type: 'radial', cx: 0.5, cy: 0.5, radius: 0.5, stops: [{ offset: 0, color: palette.accent }, { offset: 1, color: palette.bg }] },
      animations: [{ type: 'scale-in', duration: 1.6, easing: 'ease-out' }],
    },
    // refractive glass orb (reads the glow as backdrop)
    {
      id: `${id}-orb`, type: 'shape', shape: 'ellipse', x: cx, y: cy, x_anchor: '50%', y_anchor: '50%', width: 300, height: 300, fill_color: '#ffffff',
      time: 0.3, animations: [{ type: 'fade-in', duration: 0.6 }],
      effects: [{ type: 'glass', mode: 'dome', edge_width: 130, refraction: 22, dispersion: 5 }],
    },
    // serif wordmark
    {
      id: `${id}-wordmark`, type: 'text', text: wordmark, x: cx, y: cy - 4, x_anchor: '50%', y_anchor: '50%', time: 0.55,
      font_family: fonts.display, font_size: 96, font_weight: '700', letter_spacing: 8, fill_color: palette.text,
      animations: [{ type: 'scale-in', duration: 1.0, easing: 'ease-out' }, { type: 'fade-in', duration: 0.6 }],
    },
  ];
  if (tagline) {
    children.push({
      id: `${id}-tagline`, type: 'text', text: tagline, x: cx, y: cy + 86, x_anchor: '50%', y_anchor: '50%', time: 1.1,
      font_family: fonts.sans, font_size: 26, letter_spacing: 2, fill_color: palette.textMuted,
      animations: [{ type: 'fade-in', duration: 0.6 }],
    });
  }

  return {
    id, type: 'group', layer, time, duration, x: 0, y: 0, width: W, height: H,
    animations: [{ type: 'fade-out', time: 'end', duration: 0.5 }],
    elements: assignLayers(children),
  };
}
