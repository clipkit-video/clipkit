// Camera + Motion Blur controls (CAMERA-PLAN item 4). These are custom
// per-field controls for the Source scope's nested-object fields
// `source.camera` and `source.motion_blur` — registered in
// ControlRenderer, surfaced via FIELD_OVERRIDES.source. Each edits the
// whole nested object and writes it back through the source patch.
//
// Camera fields are animatable via INLINE Keyframe[] arrays (the runtime
// resolves them in cameraMatrix). When a field already holds a keyframe
// array we show an "animated" chip rather than a number well, so we
// never clobber a curve from this static panel — keyframing the camera
// from the stage lands with the camera tools (item 7).

'use client';

import type { Camera } from '@clipkit/protocol';
import { cn } from '../lib/utils.js';
import { NumberControl, SelectControl, type ScrubHandlers } from './primitives.js';

const BOX = 'flex flex-col w-full border border-border/60 rounded px-2 py-1.5';
const ROW = 'flex items-center gap-2 h-8';
const LABEL = 'text-[10px] text-muted-foreground w-16 shrink-0 truncate';
const ADD_BTN =
  'h-5 px-1.5 rounded text-[10px] text-muted-foreground hover:text-foreground hover:bg-card transition';

function isAnimated(v: unknown): boolean {
  return Array.isArray(v);
}

/** A number well, or an "animated" chip when the field holds a curve. */
function NumOrAnim({
  value,
  onChange,
  scrub,
  stepper = false,
  ...rest
}: {
  value: unknown;
  onChange: (v: number, live: boolean) => void;
  scrub: ScrubHandlers;
  stepper?: boolean;
  prefix?: React.ReactNode;
  suffix?: string;
  min?: number;
  max?: number;
  step?: number;
}) {
  if (isAnimated(value)) {
    return (
      <span className="flex-1 min-w-0 h-7 grid place-items-center rounded bg-field text-[10px] text-muted-foreground/70">
        animated
      </span>
    );
  }
  return (
    <NumberControl
      value={typeof value === 'number' ? value : 0}
      fluid
      stepper={stepper}
      onChange={onChange}
      onScrubStart={scrub.onScrubStart}
      onScrubEnd={scrub.onScrubEnd}
      {...rest}
    />
  );
}

export function CameraControl({
  value,
  onChange,
  onScrubStart,
  onScrubEnd,
}: {
  value: Camera | undefined;
  onChange: (next: Camera | undefined, live: boolean) => void;
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
}) {
  const scrub = { onScrubStart, onScrubEnd };
  if (!value) {
    return (
      <button
        type="button"
        className={ADD_BTN}
        onClick={() => onChange({ perspective: 1200 }, false)}
      >
        + Add camera
      </button>
    );
  }
  // Merge helper — write the whole object back each edit.
  const set = (patch: Partial<Camera>, live: boolean): void =>
    onChange({ ...value, ...patch }, live);

  return (
    <div className={BOX}>
      <div className={ROW}>
        <span className={LABEL}>Perspective</span>
        <div className="flex-1 min-w-0">
          <NumOrAnim
            value={value.perspective}
            min={1}
            suffix="px"
            stepper
            scrub={scrub}
            onChange={(v, live) => set({ perspective: v }, live)}
          />
        </div>
      </div>

      <div className={ROW}>
        <span className={LABEL}>Position</span>
        <div className="flex-1 min-w-0 grid grid-cols-3 gap-2">
          <NumOrAnim value={value.x} prefix="X" suffix="px" scrub={scrub}
            onChange={(v, live) => set({ x: v }, live)} />
          <NumOrAnim value={value.y} prefix="Y" suffix="px" scrub={scrub}
            onChange={(v, live) => set({ y: v }, live)} />
          <NumOrAnim value={value.z} prefix="Z" suffix="px" scrub={scrub}
            onChange={(v, live) => set({ z: v }, live)} />
        </div>
      </div>

      <div className={ROW}>
        <span className={LABEL}>Orientation</span>
        <div className="flex-1 min-w-0 grid grid-cols-3 gap-2">
          <NumOrAnim value={value.x_rotation} prefix="X" suffix="°" scrub={scrub}
            onChange={(v, live) => set({ x_rotation: v }, live)} />
          <NumOrAnim value={value.y_rotation} prefix="Y" suffix="°" scrub={scrub}
            onChange={(v, live) => set({ y_rotation: v }, live)} />
          <NumOrAnim value={value.z_rotation} prefix="Z" suffix="°" scrub={scrub}
            onChange={(v, live) => set({ z_rotation: v }, live)} />
        </div>
      </div>

      <div className={ROW}>
        <span className={LABEL}>Occlusion</span>
        <div className="flex-1 min-w-0 grid grid-cols-[1fr_auto] gap-2 items-center">
          <SelectControl
            value={value.sort ?? 'depth'}
            options={['depth', 'paint']}
            fluid
            onChange={(v) => set({ sort: v as 'depth' | 'paint' }, false)}
          />
          <button type="button" className={cn(ADD_BTN, 'justify-self-end')}
            onClick={() => onChange(undefined, false)}>
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}

interface MotionBlur {
  samples?: number;
  shutter?: number;
}

export function MotionBlurControl({
  value,
  onChange,
  onScrubStart,
  onScrubEnd,
}: {
  value: MotionBlur | undefined;
  onChange: (next: MotionBlur | undefined, live: boolean) => void;
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
}) {
  const scrub = { onScrubStart, onScrubEnd };
  if (!value) {
    return (
      <button
        type="button"
        className={ADD_BTN}
        onClick={() => onChange({ samples: 8, shutter: 0.5 }, false)}
      >
        + Add motion blur
      </button>
    );
  }
  const set = (patch: Partial<MotionBlur>, live: boolean): void =>
    onChange({ ...value, ...patch }, live);
  return (
    <div className={BOX}>
      <div className={ROW}>
        <span className={LABEL}>Samples</span>
        <div className="flex-1 min-w-0">
          <NumberControl
            value={value.samples ?? 8}
            min={1}
            max={32}
            step={1}
            fluid
            stepper
            onChange={(v, live) => set({ samples: v }, live)}
            {...scrub}
          />
        </div>
      </div>
      <div className={ROW}>
        <span className={LABEL}>Shutter</span>
        <div className="flex-1 min-w-0 grid grid-cols-[1fr_auto] gap-2 items-center">
          <NumberControl
            value={value.shutter ?? 0.5}
            min={0}
            max={1}
            step={0.05}
            fluid
            stepper
            onChange={(v, live) => set({ shutter: v }, live)}
            {...scrub}
          />
          <button type="button" className={cn(ADD_BTN, 'justify-self-end')}
            onClick={() => onChange(undefined, false)}>
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}
