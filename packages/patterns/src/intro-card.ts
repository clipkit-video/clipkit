// IntroCard — a full-frame opening title: themed backdrop, an accent
// rule, a big headline, and an optional kicker + subtitle, with
// entrance/exit animation built in.
//
// This is a COMPONENT pattern: it returns a single `group` element so
// the whole card moves, fades, or time-remaps as one unit — and it
// expands to nothing but plain primitives. Reuse lives here in the
// authoring function, not in the schema (there is no nested-composition
// element; nested timing is `time_remap` on a plain group, §5.8.3).

import type { Element } from '@clipkit/protocol';
import { assignLayers, type UnlayeredElement } from './layers.js';
import { getFonts, getPalette, type ColorName, type ThemeName } from './theme.js';

export interface IntroCardProps {
  /** Used as the id prefix for every produced element. */
  id: string;
  /** Big headline, the card's one job. */
  headline: string;
  /** Small all-caps line above the headline (e.g. a brand or series name). */
  kicker?: string;
  /** Supporting line under the headline. */
  subtitle?: string;
  /** Accent color slot — drives the backdrop tint and the rule. */
  color: ColorName;
  theme?: ThemeName;
  /** Composition width + height — the card fills the frame. */
  canvasWidth: number;
  canvasHeight: number;
  time: number;
  duration: number;
  layer: number;
}

export function introCard(props: IntroCardProps): Element {
  const {
    id, headline, kicker, subtitle, color,
    canvasWidth: W, canvasHeight: H, time, duration, layer,
  } = props;
  const theme = props.theme ?? 'mux';
  const palette = getPalette(theme, color);
  const fonts = getFonts(theme);

  const cy = H / 2;
  const children: UnlayeredElement[] = [];

  // Full-frame backdrop tint.
  children.push({
    id: `${id}-bg`,
    type: 'shape',
    shape: 'rectangle',
    x: 0,
    y: 0,
    width: W,
    height: H,
    fill_color: palette.bg,
  });

  if (kicker) {
    children.push({
      id: `${id}-kicker`,
      type: 'text',
      time: 0.15,
      text: kicker.toUpperCase(),
      x: W / 2,
      y: cy - 130,
      x_anchor: '50%',
      y_anchor: '50%',
      font_family: fonts.mono,
      font_size: 30,
      letter_spacing: 6,
      fill_color: palette.accentDark,
      animations: [{ type: 'fade-in', duration: 0.5 }],
    });
  }

  children.push({
    id: `${id}-headline`,
    type: 'text',
    time: 0.25,
    text: headline,
    x: W / 2,
    y: cy - 30,
    x_anchor: '50%',
    y_anchor: '50%',
    font_family: fonts.sans,
    font_size: 96,
    font_weight: '700',
    fill_color: palette.text,
    animations: [{ type: 'fade-in', duration: 0.6 }],
    // Gentle 40px rise (the slide-up-in preset's fixed 200px is too much
    // for a headline already in frame).
    keyframe_animations: [{
      property: 'y',
      keyframes: [
        { time: 0, value: cy - 30 + 40 },
        { time: 0.6, value: cy - 30, easing: 'ease-out' },
      ],
    }],
  });

  // Accent rule under the headline, drawn with a scale-from-center wipe.
  children.push({
    id: `${id}-rule`,
    type: 'shape',
    time: 0.55,
    shape: 'rectangle',
    x: W / 2,
    y: cy + 50,
    x_anchor: '50%',
    y_anchor: '50%',
    width: 220,
    height: 8,
    border_radius: 4,
    fill_color: palette.accent,
    keyframe_animations: [{
      property: 'x_scale',
      keyframes: [
        { time: 0, value: 0 },
        { time: 0.45, value: 1, easing: 'ease-out' },
      ],
    }],
  });

  if (subtitle) {
    children.push({
      id: `${id}-subtitle`,
      type: 'text',
      time: 0.7,
      text: subtitle,
      x: W / 2,
      y: cy + 120,
      x_anchor: '50%',
      y_anchor: '50%',
      font_family: fonts.sans,
      font_size: 38,
      fill_color: palette.textMuted,
      animations: [{ type: 'fade-in', duration: 0.6 }],
    });
  }

  return {
    id,
    type: 'group',
    layer,
    time,
    duration,
    x: 0,
    y: 0,
    width: W,
    height: H,
    animations: [{ type: 'fade-out', time: 'end', duration: 0.5 }],
    elements: assignLayers(children),
  };
}
