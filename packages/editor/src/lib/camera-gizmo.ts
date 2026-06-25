// Camera-view gizmo helpers (CAMERA-PLAN item 6). Thin wrappers over the
// runtime's render-consistent projection (`projectElementQuad` /
// `unprojectToPlane`) so the editor's selection box, hit-testing, and
// move drag line up exactly with what's drawn under the scene camera.
//
// All "canvas" points are in CANVAS pixels (the projected image space the
// runtime renders into). The Stage maps canvas ⇄ screen with pan/zoom.

import type { Element, Source } from '@clipkit/protocol';
import {
  projectElementQuad,
  unprojectToPlane,
  elementDepthZ,
  type Pt,
} from '@clipkit/runtime';
import { isVisualElement, isElementActive } from '@clipkit/editor-core';

export { projectElementQuad, unprojectToPlane, elementDepthZ, type Pt };

/** True when the editor should use camera-projected gizmos: a camera is
 *  present and the stage is in camera (not flat) view. */
export function cameraGizmosActive(source: Source, stageView: string): boolean {
  return stageView === 'camera' && !!source.camera;
}

/** Point-in-convex-quad test (quad corners in order). */
export function pointInQuad(p: Pt, quad: readonly Pt[]): boolean {
  let sign = 0;
  for (let i = 0; i < quad.length; i++) {
    const a = quad[i]!;
    const b = quad[(i + 1) % quad.length]!;
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (cross !== 0) {
      const s = cross > 0 ? 1 : -1;
      if (sign === 0) sign = s;
      else if (s !== sign) return false;
    }
  }
  return true;
}

/**
 * Camera-aware hit test: the front-most (nearest in camera depth) active,
 * visual element whose PROJECTED quad contains the canvas-pixel point.
 * Mirrors the runtime's depth ordering so clicking selects what's on top.
 */
export function cameraHitTest(
  source: Source,
  point: Pt,
  playhead: number,
  sourceDuration: number,
): Element | null {
  let best: Element | null = null;
  let bestZ = -Infinity;
  for (const el of source.elements) {
    if (!isVisualElement(el)) continue;
    if (!isElementActive(el, playhead, sourceDuration)) continue;
    const quad = projectElementQuad(source, el, playhead);
    if (!quad || !pointInQuad(point, quad)) continue;
    const z = elementDepthZ(source, el, playhead);
    if (z >= bestZ) {
      bestZ = z;
      best = el;
    }
  }
  return best;
}
