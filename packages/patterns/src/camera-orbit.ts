// cameraOrbit — a ready-made scene camera move (CKP/1.0). Unlike the
// other patterns (which return an Element), this returns a `Camera` for
// `source.camera`: a keyframed pose that sweeps the viewpoint — orbit
// (yaw), tilt (pitch), dolly (z), truck (x) — over the composition.
// Pair it with content at varied `z` for parallax, depth-correct
// occlusion handles itself (§4.4.3).

import type { Camera, Keyframe } from '@clipkit/protocol';

export interface CameraOrbitProps {
  /** Focal distance in px; smaller = stronger perspective. Default 1500. */
  perspective?: number;
  /** Yaw sweep: y_rotation runs from −yaw to +yaw degrees. Default 40. */
  yaw?: number;
  /** Constant downward tilt (x_rotation degrees) held through the move. Default 0. */
  pitch?: number;
  /** Dolly: z runs 0 → dolly px (+ = toward the viewer). Default 0. */
  dolly?: number;
  /** Truck: x runs 0 → truck px. Default 0. */
  truck?: number;
  /** Move length in seconds (the keyframe span). */
  duration: number;
  /** Ease the sweep in/out. Default true. */
  ease?: boolean;
  /** Projection origin (vanishing point). Defaults to canvas center. */
  origin_x?: number | string;
  origin_y?: number | string;
}

function ramp(from: number, to: number, duration: number, easing?: string): Keyframe[] {
  const end: Keyframe = { time: Math.max(0.1, duration), value: to } as Keyframe;
  if (easing) (end as { easing?: string }).easing = easing;
  return [{ time: 0, value: from } as Keyframe, end];
}

export function cameraOrbit(props: CameraOrbitProps): Camera {
  const { duration } = props;
  const easing = (props.ease ?? true) ? 'ease-in-out' : undefined;
  const yaw = props.yaw ?? 40;

  const cam: Camera = { perspective: props.perspective ?? 1500 };
  if (props.origin_x !== undefined) cam.origin_x = props.origin_x;
  if (props.origin_y !== undefined) cam.origin_y = props.origin_y;
  if (yaw) cam.y_rotation = ramp(-yaw, yaw, duration, easing);
  if (props.pitch) cam.x_rotation = props.pitch; // constant tilt
  if (props.dolly) cam.z = ramp(0, props.dolly, duration, easing);
  if (props.truck) cam.x = ramp(0, props.truck, duration, easing);
  return cam;
}
