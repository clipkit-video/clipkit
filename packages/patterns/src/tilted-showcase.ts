// TiltedShowcase — the promo-video signature shot: a screenshot (or UI
// mock) inside a browser-chrome frame, tilted back in 3D and gently
// swinging. Pair with a Source-level `camera: { perspective }` for
// converging perspective; without one the tilt is affine.
//
// COMPONENT pattern: returns ONE `clip: true` group, so the §4.4.3
// flattening rule projects the whole framed card as a unit — and it
// expands to plain primitives only.

import type { Element } from '@clipkit/protocol';
import { assignLayers, type UnlayeredElement } from './layers.js';
import { getPalette, type ColorName, type ThemeName } from './theme.js';

export interface TiltedShowcaseProps {
  /** Used as the id prefix for every produced element. */
  id: string;
  /** Screenshot URL shown inside the frame (object-fit: cover). */
  source: string;
  /** Accent color slot — drives the frame's top border. */
  color: ColorName;
  theme?: ThemeName;
  /** Center of the card in canvas px. */
  x: number;
  y: number;
  /** Card size in px (chrome bar included). Default 720×480. */
  width?: number;
  height?: number;
  /**
   * Peak y-rotation in degrees; the card swings ±tilt (ping-pong) over
   * its lifetime. Default 22. Pass 0 for a static straight-on card.
   */
  tilt?: number;
  /** Push the card toward (+) / away from (−) the camera, px. Default 0. */
  z?: number;
  time: number;
  duration: number;
  layer: number;
}

export function tiltedShowcase(props: TiltedShowcaseProps): Element {
  const { id, source, color, x, y, time, duration, layer } = props;
  const theme = props.theme ?? 'mux';
  const palette = getPalette(theme, color);
  const W = props.width ?? 720;
  const H = props.height ?? 480;
  const tilt = props.tilt ?? 22;
  const CHROME = 44;

  const children: UnlayeredElement[] = [
    {
      id: `${id}-frame`,
      type: 'shape',
      shape: 'rectangle',
      x: W / 2,
      y: H / 2,
      x_anchor: '50%',
      y_anchor: '50%',
      width: W,
      height: H,
      fill_color: '#161B22',
      border_radius: 14,
    },
    {
      id: `${id}-chrome`,
      type: 'shape',
      shape: 'rectangle',
      x: W / 2,
      y: CHROME / 2,
      x_anchor: '50%',
      y_anchor: '50%',
      width: W,
      height: CHROME,
      fill_color: '#21262E',
    },
    { id: `${id}-d1`, type: 'shape', shape: 'ellipse', x: 26, y: CHROME / 2, x_anchor: '50%', y_anchor: '50%', width: 12, height: 12, fill_color: '#EF4444' },
    { id: `${id}-d2`, type: 'shape', shape: 'ellipse', x: 48, y: CHROME / 2, x_anchor: '50%', y_anchor: '50%', width: 12, height: 12, fill_color: '#F5B50F' },
    { id: `${id}-d3`, type: 'shape', shape: 'ellipse', x: 70, y: CHROME / 2, x_anchor: '50%', y_anchor: '50%', width: 12, height: 12, fill_color: '#22C55E' },
    {
      id: `${id}-accent`,
      type: 'shape',
      shape: 'rectangle',
      x: W / 2,
      y: CHROME + 1,
      x_anchor: '50%',
      y_anchor: '50%',
      width: W,
      height: 2,
      fill_color: palette.accent,
    },
    {
      id: `${id}-shot`,
      type: 'image',
      source,
      x: W / 2,
      y: CHROME + (H - CHROME) / 2,
      x_anchor: '50%',
      y_anchor: '50%',
      width: W,
      height: H - CHROME,
      fit: 'cover',
    },
  ];

  return {
    id,
    type: 'group',
    layer,
    time,
    duration,
    x,
    y,
    x_anchor: '50%',
    y_anchor: '50%',
    width: W,
    height: H,
    clip: true,
    ...(props.z !== undefined ? { z: props.z } : {}),
    ...(tilt !== 0
      ? {
          keyframe_animations: [{
            property: 'y_rotation',
            loop: 'ping-pong' as const,
            keyframes: [
              { time: 0, value: -tilt },
              { time: Math.max(0.1, duration / 2), value: tilt, easing: 'ease-in-out' },
            ],
          }],
        }
      : {}),
    animations: [
      { type: 'fade-in', duration: 0.5 },
      { type: 'fade-out', time: 'end', duration: 0.4 },
    ],
    elements: assignLayers(children),
  };
}
