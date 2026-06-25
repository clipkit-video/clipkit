// litSurface — a UI card that responds to scene light (LIGHTING §4.8).
//
// COMPONENT pattern: returns ONE `clip: true` group carrying a `material`.
// The §4.4.3 flattening rule composites the children into a single layer,
// and the runtime then shades that layer as ONE lit plane — so a
// view-dependent sheen / environment reflection sweeps across the whole
// card as the camera moves (textured-surface lighting).
//
// Pair with Source-level lighting to see anything:
//   source.lights       — ambient fill + a directional key
//   source.environment  — a gradient "sky" the surface mirrors (optional)
// Without lights and without an environment the card renders unlit (the
// material is simply ignored — opt-in, zero cost).

import type { Element, Material } from '@clipkit/protocol';

export interface LitSurfaceProps {
  /** Id prefix for produced elements. */
  id: string;
  /** Card center in canvas px. */
  x: number;
  y: number;
  /** Card size in px. Default 1200×720. */
  width?: number;
  height?: number;
  /**
   * Card content — primitive elements positioned RELATIVE to the card's
   * top-left (0,0 = card corner). They flatten into the lit plane.
   */
  elements: Element[];
  /** Fill painted behind the content. Default a dark slate. */
  background?: string;
  /** Corner radius in px. Default 36. */
  borderRadius?: number;
  /**
   * PBR material. Default a glossy dark-UI look (medium-low roughness,
   * fairly metallic) so a key light reads as a soft sweeping sheen.
   */
  material?: Material;
  /**
   * Peak y-rotation in degrees; the card swings ±tilt (ping-pong) over
   * its lifetime so the highlight sweeps. Default 0 (static — drive it
   * with a Source camera instead). Pair with `camera.perspective`.
   */
  tilt?: number;
  /** Push toward (+) / away from (−) the camera, px. Default 0. */
  z?: number;
  time: number;
  duration: number;
  layer: number;
}

const DEFAULT_MATERIAL: Material = { roughness: 0.38, metalness: 0.8, reflectivity: 1 };

export function litSurface(props: LitSurfaceProps): Element {
  const { id, x, y, elements, time, duration, layer } = props;
  const W = props.width ?? 1200;
  const H = props.height ?? 720;
  const radius = props.borderRadius ?? 36;
  const tilt = props.tilt ?? 0;

  const body: Element = {
    id: `${id}-bg`,
    type: 'shape',
    shape: 'rectangle',
    layer: 0,
    x: 0,
    y: 0,
    width: W,
    height: H,
    fill_color: props.background ?? '#161f38',
  };

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
    border_radius: radius,
    material: props.material ?? DEFAULT_MATERIAL,
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
    elements: [body, ...elements],
  };
}
