// ControlRenderer — FieldSpec.control → interactive knob (D2: the
// inspector never hand-wires a field; this single mapping is the only
// place control kinds meet components). Compound kinds (keyframes /
// list / json) render read-only chips until their bespoke widgets
// land (B4 / B7 / B11).

'use client';

import type { FieldSpec } from '@clipkit/editor-core';
import { cn } from '../lib/utils.js';
import {
  ColorControl,
  KeyframedChip,
  LengthControl,
  NumberControl,
  SelectControl,
  TextControl,
  ToggleControl,
  type ScrubHandlers,
} from './primitives.js';
import {
  BoxShadowControl,
  CaptionWordsControl,
  GradientControl,
  TextMaskControl,
  TextSpansControl,
  TextareaControl,
} from './compound.js';
import type {
  Animation,
  CaptionWord,
  Effect,
  LinearGradient,
  RadialGradient,
  TextMask,
  TextSpan,
} from '@clipkit/protocol';
import { EffectsStackControl } from './EffectsStack.js';
import { GradeControl } from './GradeControl.js';
import { ShapePresetControl } from './ShapePresetControl.js';
import { CaptionLengthControl } from './CaptionLengthControl.js';
import { AnimationsStackControl } from './AnimationsStack.js';
import { CameraControl, MotionBlurControl } from './CameraControl.js';
import { MaterialControl, LightsControl, EnvironmentControl, BloomControl } from './LightingControls.js';
import type { Bloom, Camera, Environment, Light, Material } from '@clipkit/protocol';

type Gradient = LinearGradient | RadialGradient;

/** Control kinds that take the full row width (label stacked above). */
export const WIDE_CONTROLS = new Set([
  'gradient', 'box-shadow', 'text-mask', 'caption-words', 'text-spans', 'textarea',
  'effects-stack', 'animations-stack', 'camera', 'motion-blur',
  'material', 'lights', 'environment', 'bloom', 'color-grade',
]);

export interface ControlRendererProps extends ScrubHandlers {
  spec: FieldSpec;
  value: unknown;
  /**
   * live=true while scrubbing (dispatched with skipHistory after one
   * onScrubStart snapshot); live=false is a committed single edit.
   */
  onChange: (next: unknown, live: boolean) => void;
  /** Stretch into the row's value column (the panel's fluid grid). */
  fluid?: boolean;
  /** The ◇ keyframe diamond — rendered INSIDE number-family wells
      (per the reference HTML); other kinds get it appended beside. */
  trailing?: React.ReactNode;
}

export function ControlRenderer({
  spec,
  value,
  onChange,
  onScrubStart,
  onScrubEnd,
  fluid,
  trailing,
}: ControlRendererProps) {
  // A Keyframe[] where a scalar belongs = the field is animated;
  // direct editing routes through the curve editor (B7).
  if (spec.animatable && Array.isArray(value)) {
    return beside(<KeyframedChip />, trailing);
  }

  const scrub = { onScrubStart, onScrubEnd };

  switch (spec.control) {
    case 'number':
      return (
        <NumberControl
          value={typeof value === 'number' ? value : 0}
          min={spec.min}
          max={spec.max}
          step={spec.step ?? 1}
          fluid={fluid}
          trailing={trailing}
          stepper={fluid}
          onChange={onChange}
          {...scrub}
        />
      );
    case 'percent':
      return (
        <NumberControl
          value={typeof value === 'number' ? value : 100}
          min={spec.min ?? 0}
          max={spec.max ?? 100}
          step={spec.step ?? 1}
          suffix="%"
          fluid={fluid}
          trailing={trailing}
          stepper={fluid}
          onChange={onChange}
          {...scrub}
        />
      );
    case 'angle':
      return (
        <NumberControl
          value={typeof value === 'number' ? value : 0}
          min={spec.min}
          max={spec.max}
          step={spec.step ?? 1}
          suffix="°"
          fluid={fluid}
          trailing={trailing}
          stepper={fluid}
          onChange={onChange}
          {...scrub}
        />
      );
    case 'length':
      return (
        <LengthControl
          value={
            typeof value === 'number' || typeof value === 'string' ? value : 0
          }
          step={spec.step ?? 1}
          fluid={fluid}
          trailing={trailing}
          stepper={fluid}
          onChange={onChange}
          {...scrub}
        />
      );
    case 'color':
      return beside(
        <ColorControl
          value={typeof value === 'string' ? value : '#ffffff'}
          fluid={fluid}
          onChange={(v, live) => onChange(v, live ?? false)}
          onScrubStart={onScrubStart}
          onScrubEnd={onScrubEnd}
        />,
        trailing,
      );
    case 'select':
      return beside(
        <SelectControl
          value={typeof value === 'string' ? value : String(value ?? '')}
          options={spec.options ?? []}
          fluid={fluid}
          onChange={(v) => onChange(v, false)}
        />,
        trailing,
      );
    case 'shape-preset':
      // Self-managed: patches the selected element between primitive and path
      // forms (rectangle/ellipse vs triangle/star/line/…). Ignores value/onChange.
      return beside(<ShapePresetControl fluid={fluid} />, trailing);
    case 'caption-length':
      // Caption windowing: Auto (word-chunks) / N letters / Off (show all).
      return beside(
        <CaptionLengthControl value={value as number | 'auto' | undefined} onChange={(v) => onChange(v, false)} />,
        trailing,
      );
    case 'color-grade':
      // Self-managed: reads the selected element + patches its filter fields
      // through a fly-out (the Color panel). Ignores value/onChange.
      return <GradeControl />;
    case 'toggle':
      return beside(
        <ToggleControl
          value={value === true}
          onChange={(v) => onChange(v, false)}
        />,
        trailing,
      );
    case 'effects-stack':
      return (
        <EffectsStackControl
          value={value as Effect[] | undefined}
          onChange={(v, live) => onChange(v, live)}
          onScrubStart={onScrubStart}
          onScrubEnd={onScrubEnd}
        />
      );
    case 'animations-stack':
      return (
        <AnimationsStackControl
          value={value as Animation[] | undefined}
          onChange={(v, live) => onChange(v, live)}
          onScrubStart={onScrubStart}
          onScrubEnd={onScrubEnd}
        />
      );
    case 'speed': {
      // playback_rate as a percent (rate 1 = 100%), with steppers.
      const rate = typeof value === 'number' ? value : 1;
      const min = (spec.min ?? 0.05) * 100;
      const max = (spec.max ?? 8) * 100;
      const clamp = (p: number): number => Math.min(max, Math.max(min, p));
      return (
        <NumberControl
          value={Math.round(rate * 100)}
          min={min}
          max={max}
          step={5}
          suffix="%"
          width={fluid ? undefined : 56}
          fluid={fluid}
          trailing={trailing}
          stepper
          onChange={(v, live) => onChange(clamp(v) / 100, live)}
          onScrubStart={onScrubStart}
          onScrubEnd={onScrubEnd}
        />
      );
    }
    case 'textarea':
      return (
        <TextareaControl
          value={typeof value === 'string' ? value : ''}
          onChange={(v, live) => onChange(v, live)}
          onScrubStart={onScrubStart}
          onScrubEnd={onScrubEnd}
        />
      );
    case 'gradient':
      return (
        <GradientControl
          value={value as Gradient | undefined}
          onChange={(v, live) => onChange(v, live ?? false)}
          onScrubStart={onScrubStart}
          onScrubEnd={onScrubEnd}
        />
      );
    case 'box-shadow':
      return (
        <BoxShadowControl
          value={value as { color: string } | undefined}
          onChange={(v) => onChange(v, false)}
        />
      );
    case 'camera':
      return (
        <CameraControl
          value={value as Camera | undefined}
          onChange={(v, live) => onChange(v, live)}
          onScrubStart={onScrubStart}
          onScrubEnd={onScrubEnd}
        />
      );
    case 'motion-blur':
      return (
        <MotionBlurControl
          value={value as { samples?: number; shutter?: number } | undefined}
          onChange={(v, live) => onChange(v, live)}
          onScrubStart={onScrubStart}
          onScrubEnd={onScrubEnd}
        />
      );
    case 'material':
      return (
        <MaterialControl
          value={value as Material | undefined}
          onChange={(v, live) => onChange(v, live)}
          onScrubStart={onScrubStart}
          onScrubEnd={onScrubEnd}
        />
      );
    case 'lights':
      return (
        <LightsControl
          value={value as Light[] | undefined}
          onChange={(v, live) => onChange(v, live)}
          onScrubStart={onScrubStart}
          onScrubEnd={onScrubEnd}
        />
      );
    case 'environment':
      return (
        <EnvironmentControl
          value={value as Environment | undefined}
          onChange={(v, live) => onChange(v, live)}
        />
      );
    case 'bloom':
      return (
        <BloomControl
          value={value as Bloom | undefined}
          onChange={(v, live) => onChange(v, live)}
          onScrubStart={onScrubStart}
          onScrubEnd={onScrubEnd}
        />
      );
    case 'text-mask':
      return (
        <TextMaskControl
          value={value as TextMask | undefined}
          onChange={(v) => onChange(v, false)}
        />
      );
    case 'caption-words':
      return (
        <CaptionWordsControl
          value={value as CaptionWord[] | undefined}
          onChange={(v) => onChange(v, false)}
        />
      );
    case 'text-spans':
      return (
        <TextSpansControl
          value={value as TextSpan[] | undefined}
          onChange={(v, live) => onChange(v, live ?? false)}
          onScrubStart={onScrubStart}
          onScrubEnd={onScrubEnd}
        />
      );
    case 'text':
    case 'url':
      return beside(
        <TextControl
          value={typeof value === 'string' ? value : ''}
          fluid={fluid}
          onChange={(v) => onChange(v, false)}
        />,
        trailing,
      );
    default:
      // keyframes / list / json — bespoke widgets land in B4/B7/B11.
      return beside(
        <span className="text-[11px] font-mono text-muted-foreground/60 tabular-nums">
          {Array.isArray(value) ? `[${value.length}]` : value === undefined ? '—' : '{…}'}
        </span>,
        trailing,
      );
  }
}

/** Kinds that can't host the ◇ inside the well get it appended. */
function beside(control: React.ReactNode, trailing?: React.ReactNode) {
  if (!trailing) return <>{control}</>;
  return (
    <div className="flex items-center gap-1 w-full min-w-0 justify-end">
      {control}
      {trailing}
    </div>
  );
}
