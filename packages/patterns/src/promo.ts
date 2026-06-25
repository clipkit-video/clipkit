// promo() — the Source-level composer.
//
// Component patterns return scene FRAGMENTS (one group each). `promo`
// assembles an ordered list of scenes into a complete, renderable Source:
// it sequences them on the timeline with a crossfade overlap, registers
// the theme's webfonts, and wires the shared camera + motion blur. This is
// where the *sequence-level* taste lives (timing, crossfades, one camera,
// motion blur on) — the part an agent gets wrong when hand-assembling.
//
// Each scene is a builder that receives the timing/layer/dims the composer
// assigns, so callers (or an agent) only choose patterns + content + a
// duration — never the bookkeeping.

import type { Camera, Element, Source } from '@clipkit/protocol';
import { THEMES, type ThemeName } from './theme.js';

export interface SceneCtx {
  id: string;
  theme: ThemeName;
  canvasWidth: number;
  canvasHeight: number;
  /** Start time (s) the composer assigned this scene. */
  time: number;
  /** Visible duration (s) of this scene, including crossfade tails. */
  duration: number;
  /** Layer the composer assigned (scenes stack so crossfades overlap). */
  layer: number;
}

export interface Scene {
  /** On-screen length in seconds (before crossfade overlap). */
  duration: number;
  /** Build the scene's root element from composer-assigned timing/dims. */
  build: (ctx: SceneCtx) => Element;
}

export interface PromoOptions {
  scenes: Scene[];
  theme?: ThemeName;
  width?: number;
  height?: number;
  frameRate?: number;
  /** Crossfade overlap between consecutive scenes, seconds. Default 0.4. */
  crossfade?: number;
  /** Shared scene camera (e.g. from cameraOrbit). */
  camera?: Camera;
  /** Supersampled motion-blur sample count (≥2 enables it). */
  motionBlur?: number;
  /** Background color override (defaults to the theme's canvas color). */
  background?: string;
}

/** Compose scenes + theme into one renderable Source. */
export function promo(opts: PromoOptions): Source {
  const theme = opts.theme ?? 'cinematic';
  const W = opts.width ?? 1280;
  const H = opts.height ?? 720;
  const crossfade = opts.crossfade ?? 0.4;
  const themeDef = THEMES[theme];

  // Lay scenes end-to-end, overlapping each by `crossfade` so the patterns'
  // built-in fade-out/fade-in produce a dissolve. Each on its own layer so
  // the overlap actually composites.
  const elements: Element[] = [];
  let cursor = 0;
  opts.scenes.forEach((scene, i) => {
    const time = i === 0 ? 0 : cursor - crossfade;
    elements.push(
      scene.build({
        id: `s${i}`,
        theme,
        canvasWidth: W,
        canvasHeight: H,
        time,
        duration: scene.duration,
        // Later scenes sit in FRONT (lower layer) so a crossfade dissolves
        // INTO the incoming scene. Unique 1..N across the scene list.
        layer: opts.scenes.length - i,
      }),
    );
    cursor = time + scene.duration;
  });
  const total = cursor;

  const source: Source = {
    clipkit_version: '1.0',
    output_format: 'mp4',
    width: W,
    height: H,
    duration: total,
    frame_rate: opts.frameRate ?? 30,
    background_color: opts.background ?? themeDef.palettes.gray.bg,
    elements,
  };
  if (themeDef.fontFaces && themeDef.fontFaces.length) source.fonts = themeDef.fontFaces;
  if (opts.camera) source.camera = opts.camera;
  if (opts.motionBlur && opts.motionBlur >= 2) {
    source.motion_blur = { samples: opts.motionBlur, shutter: 0.6 };
  }
  return source;
}
