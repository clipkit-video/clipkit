// The override layer (EDITORS-PLAN D2 layer 2) — sparse, hand-ruled
// presentation on top of the derived defaults. Two shapes:
//
//   FIELD_OVERRIDES[scope][path]  — merge presentation into one knob
//   COMPOSITES[scope][]           — one widget claiming several fields
//
// Precedence: composite claim > field override > derived default.
// Keep this file SMALL — every entry is a design decision. Derived
// defaults are correct-but-plain; entries land here when a knob earns
// better treatment (and the registry probe's triage list is the
// worklist).

import type { CompositeSpec, FieldOverride } from './types.js';

/** Overrides applied to the shared BaseElement fields on EVERY element scope. */
export const BASE_FIELD_OVERRIDES: Record<string, FieldOverride> = {
  visible: { order: 9 }, // top of appearance, right above opacity
  // Opacity is a 0..1 fraction (CSS convention), shown like `scale` as a
  // plain number — NOT the `percent` control (that one is value-as-percent,
  // shared with volume, and defaults unauthored fields to 100).
  opacity: { control: 'number', min: 0, max: 1, step: 0.01, order: 10 },
  rotation: { control: 'angle', step: 1, order: 30 },
  // CKP/1.0 3D: x/y rotation sit beside the 2D Rotate composite; z (depth)
  // is below them. z_rotation is the alias of rotation (claimed by the
  // Rotate composite), so it isn't surfaced separately.
  x_rotation: { control: 'angle', label: 'X rotation', section: 'transform', step: 1, order: 31 },
  y_rotation: { control: 'angle', label: 'Y rotation', section: 'transform', step: 1, order: 32 },
  scale: { control: 'number', min: 0, step: 0.01, order: 40 },
  x_scale: { control: 'number', min: 0, step: 0.01, order: 41 },
  y_scale: { control: 'number', min: 0, step: 0.01, order: 42 },
  width: { order: 20 },
  height: { order: 21 },
  blend_mode: { label: 'Blending', order: 11 },
  // §4.8 PBR material — surfaces respond to scene lights/environment.
  // Its own section so the four dials read as a unit.
  material: { control: 'material', label: 'Material', section: 'material', order: 0 },
  z: { control: 'number', label: 'Depth (z)', section: 'transform', step: 1, order: 33 },
  effects: { control: 'effects-stack', order: 0 },
  animations: { control: 'animations-stack', order: 0 },
};

/** Per-scope field overrides ('source', element types, 'effects.<type>', 'animation'). */
export const FIELD_OVERRIDES: Record<string, Record<string, FieldOverride>> = {
  source: {
    width: { order: 1 },
    height: { order: 2 },
    duration: { order: 3 },
    // min 1: the schema requires positive(); an unclamped scrub could
    // write 0 and freeze playback (1/0 cadence poisoning the engine).
    frame_rate: { label: 'Frame rate', order: 4, min: 1, max: 120, step: 1 },
    background_color: { order: 5 },
    // CKP/1.0 nested-object scene controls (custom widgets in the shell).
    camera: { control: 'camera', label: 'Camera', order: 6 },
    motion_blur: { control: 'motion-blur', label: 'Motion blur', order: 7 },
    // §4.8 scene lighting — what reflective materials respond to / mirror.
    lights: { control: 'lights', label: 'Lights', order: 8 },
    environment: { control: 'environment', label: 'Environment', order: 9 },
    bloom: { control: 'bloom', label: 'Bloom', order: 10 },
  },
  video: {
    volume: { control: 'percent', min: 0, max: 200, step: 1, section: 'audio' },
    audio_fade_in: { section: 'audio', label: 'Fade in', min: 0, step: 0.1 },
    audio_fade_out: { section: 'audio', label: 'Fade out', min: 0, step: 0.1 },
    // Figma-layout pass: Speed lives in the Time block as a percent
    // (media elements ONLY — a generic speed knob would imply hidden
    // time_remap derivation, ruled out).
    playback_rate: { control: 'speed', label: 'Speed', section: 'timing', order: 10, min: 0.05, max: 8, step: 0.05 },
    trim_start: { section: 'media', min: 0, step: 0.01 },
    trim_duration: { section: 'media', min: 0, step: 0.01 },
    loop: { section: 'media' },
    fit: { section: 'media' },
  },
  audio: {
    volume: { control: 'percent', min: 0, max: 200, step: 1, section: 'audio' },
    audio_fade_in: { section: 'audio', label: 'Fade in', min: 0, step: 0.1 },
    audio_fade_out: { section: 'audio', label: 'Fade out', min: 0, step: 0.1 },
    trim_start: { section: 'media', min: 0, step: 0.01 },
    trim_duration: { section: 'media', min: 0, step: 0.01 },
    loop: { section: 'media' },
  },
  'effects.glass': {
    refraction: { min: 0, max: 60, step: 1 },
    blur_radius: { min: 0, max: 80, step: 1 },
    edge_width: { min: 0, max: 120, step: 1 },
  },
  text: {
    text: { section: 'content', order: 0, control: 'textarea' },
    font_family: { section: 'typography', order: 0, label: 'Font' },
    font_size: { section: 'typography', order: 1, label: 'Size' },
    font_weight: { section: 'typography', order: 2, label: 'Weight' },
    font_style: { section: 'typography', order: 3, label: 'Style' },
    line_height: { section: 'typography', order: 4, step: 0.05 },
    letter_spacing: { section: 'typography', order: 5, step: 0.5 },
    text_transform: { section: 'typography', order: 6, label: 'Transform' },
    fill_color: { section: 'typography', order: 7, label: 'Fill' },
    stroke_color: { section: 'typography', order: 8, label: 'Stroke' },
    stroke_width: { section: 'typography', order: 9, min: 0, step: 0.5 },
    text_align: { section: 'layout', order: 0, label: 'Align' },
    vertical_align: { section: 'layout', order: 1, label: 'V align' },
    x_alignment: { section: 'layout', order: 2 },
    y_alignment: { section: 'layout', order: 3 },
    x_padding: { section: 'layout', order: 4 },
    y_padding: { section: 'layout', order: 5 },
    text_wrap: { section: 'layout', order: 6, label: 'Wrap' },
    font_size_minimum: { section: 'layout', order: 7, label: 'Auto min' },
    font_size_maximum: { section: 'layout', order: 8, label: 'Auto max' },
    // background_color / _border_radius / _padding are claimed by the
    // 'background' composite (COMPOSITES.text) — one grouped widget.
    text_shadow: { section: 'decoration', order: 3, label: 'Text shadow', control: 'box-shadow' },
    spans: { section: 'content', order: 4, control: 'text-spans', label: 'Spans' },
    mask: { section: 'decoration', order: 6, control: 'text-mask', label: 'Reveal mask' },
  },
  shape: {
    // Primitive form (rectangle/ellipse) + path presets (triangle/star/line/…).
    shape: { section: 'shape', order: 0, control: 'shape-preset', label: 'Shape' },
    // fill/stroke color + radius/width are keyframe-able (the runtime resolves
    // them through keyframe_animations); the schema types stay scalar.
    fill_color: { section: 'shape', order: 1, label: 'Fill', animatable: true },
    gradient: { section: 'shape', order: 2, control: 'gradient' },
    stroke_color: { section: 'shape', order: 3, label: 'Stroke', animatable: true },
    stroke_width: { section: 'shape', order: 4, min: 0, step: 0.5, animatable: true },
    border_radius: { section: 'shape', order: 5, label: 'Radius', min: 0, animatable: true },
    shadow: { section: 'shape', order: 6, control: 'box-shadow' },
    // Path form (arbitrary vector geometry — the former `svg` element).
    paths: { section: 'path', order: 0 },
    view_box: { section: 'path', order: 1, label: 'View box' },
    gradients: { section: 'path', order: 2 },
  },
  image: {
    source: { section: 'media', order: 0 },
    fit: { section: 'media', order: 1 },
    border_radius: { section: 'media', order: 2, label: 'Radius', min: 0 },
  },
  caption: {
    words: { section: 'content', order: 0, control: 'caption-words' },
    style: { section: 'content', order: 1 },
    // Windowing: max letters shown on screen at once.
    max_length: { section: 'content', order: 2, control: 'caption-length', label: 'Letters' },
    highlight_color: { section: 'typography', order: 10, label: 'Highlight' },
    highlight_background_color: { section: 'typography', order: 11, label: 'Highlight bg' },
    font_family: { section: 'typography', order: 0, label: 'Font' },
    font_size: { section: 'typography', order: 1, label: 'Size' },
    font_weight: { section: 'typography', order: 2, label: 'Weight' },
    font_style: { section: 'typography', order: 3, label: 'Style' },
    line_height: { section: 'typography', order: 4, step: 0.05 },
    letter_spacing: { section: 'typography', order: 5, step: 0.5 },
    fill_color: { section: 'typography', order: 7, label: 'Fill' },
    stroke_color: { section: 'typography', order: 8, label: 'Stroke' },
    stroke_width: { section: 'typography', order: 9, min: 0, step: 0.5 },
    text_align: { section: 'layout', order: 0, label: 'Align' },
    // Background trio claimed by the 'background' composite (COMPOSITES.caption).
    text_shadow: { section: 'decoration', order: 3, label: 'Text shadow', control: 'box-shadow' },
  },
  particles: {
    rate: { section: 'emission', order: 0, min: 1 },
    burst: { section: 'emission', order: 1 },
    burst_count: { section: 'emission', order: 2, min: 1, max: 2000, step: 1 },
    lifetime: { section: 'emission', order: 3, min: 0.05, step: 0.05 },
    velocity: { section: 'emission', order: 4, min: 0 },
    spread: { section: 'emission', order: 5, min: 0, max: 360 },
    direction: { section: 'emission', order: 6 },
    gravity: { section: 'emission', order: 7 },
    z_velocity: { section: 'emission', order: 8, label: 'Z velocity' },
    z_spread: { section: 'emission', order: 9, label: 'Z spread', min: 0 },
    color: { section: 'look', order: 0 },
    particle_shape: { section: 'look', order: 1, label: 'Shape' },
    size: { section: 'look', order: 2, min: 1 },
    size_variation: { section: 'look', order: 3, min: 0, max: 1, step: 0.05 },
    rotation_speed: { section: 'look', order: 4, label: 'Spin' },
    fade_at: { section: 'look', order: 5, min: 0, max: 1, step: 0.05 },
    target_points: { section: 'convergence', order: 0 },
    convergence_easing: { section: 'convergence', order: 1, label: 'Easing' },
    scatter_radius: { section: 'convergence', order: 2, min: 0 },
  },
  group: {
    clip: { section: 'group', order: 0 },
    mask: { section: 'group', order: 1 },
    elements: { section: 'group', order: 2 },
    time_remap: { section: 'timing', order: 10, label: 'Time remap' },
  },
};

/** Composite widgets. The control kinds are registered by the shells. */
// Color grade — a fly-out widget over the base filter fields. Scoped to the
// pixel-producing element types (image, video, group, particles); text/shape
// use their own fill as the primary color, so they don't get it.
const COLOR_COMPOSITE: CompositeSpec = {
  id: 'color',
  control: 'color-grade',
  label: 'Color',
  section: 'color',
  order: 0,
  claims: ['brightness', 'contrast', 'saturation', 'hue_rotate'],
};

// Source crop — a fly-out frame editor (like the color picker) over the four
// normalized crop_* fields. Self-managed (reads the selected element + patches
// it directly). Image + video only — the elements with a source texture.
const CROP_COMPOSITE: CompositeSpec = {
  id: 'crop',
  control: 'crop',
  label: 'Crop',
  section: 'media',
  order: 3,
  claims: ['crop_x', 'crop_y', 'crop_width', 'crop_height'],
};

export const COMPOSITES: Record<string, CompositeSpec[]> = {
  // Applied to every element scope (merged in build.ts).
  __element__: [
    {
      id: 'position',
      control: 'vec2',
      label: 'Position',
      section: 'transform',
      order: 0,
      claims: ['x', 'y'],
    },
    {
      // Figma-layout pass (ruled by Ian 2026-06-11): one Time block —
      // Length with steppers + In & Out — over the literal
      // time/duration fields.
      id: 'time-range',
      control: 'time-range',
      label: 'Time',
      section: 'timing',
      order: 0,
      claims: ['time', 'duration'],
    },
    {
      // W/H with an aspect lock (the lock is editor state, lens rule).
      id: 'size',
      control: 'size',
      label: 'Size',
      section: 'transform',
      order: 20,
      claims: ['width', 'height'],
    },
    {
      // Rotation + quick actions (rotate 90°, flip H/V — the flips
      // write negated x_scale/y_scale, plain literal fields).
      id: 'rotate',
      control: 'rotate',
      label: 'Rotate',
      section: 'transform',
      order: 30,
      // z_rotation is the same slot as rotation (alias) — claim both so
      // the alias isn't surfaced as a duplicate field.
      claims: ['rotation', 'z_rotation'],
    },
    {
      // Sits directly under Size (ruled by Ian 2026-06-11).
      id: 'anchor-alignment',
      control: 'anchor-grid',
      label: 'Anchor',
      section: 'transform',
      order: 25,
      claims: ['x_anchor', 'y_anchor'],
    },
  ],
  // Audio-carrying elements get the rotary volume block (number well +
  // knob + live meters — Ian's reference HTML; M/S stay in the mixer
  // rail, they're preview-only) and the one-row Fade In/Out pair.
  video: [
    {
      id: 'volume',
      control: 'volume',
      label: 'Volume',
      section: 'audio',
      order: 0,
      claims: ['volume'],
    },
    {
      id: 'fades',
      control: 'fades',
      label: 'Fade',
      section: 'audio',
      order: 1,
      claims: ['audio_fade_in', 'audio_fade_out'],
    },
    CROP_COMPOSITE,
    COLOR_COMPOSITE,
  ],
  image: [CROP_COMPOSITE, COLOR_COMPOSITE],
  group: [COLOR_COMPOSITE],
  particles: [COLOR_COMPOSITE],
  audio: [
    {
      id: 'volume',
      control: 'volume',
      label: 'Volume',
      section: 'audio',
      order: 0,
      claims: ['volume'],
    },
    {
      id: 'fades',
      control: 'fades',
      label: 'Fade',
      section: 'audio',
      order: 1,
      claims: ['audio_fade_in', 'audio_fade_out'],
    },
  ],
  // One "Background" widget (add → color · radius · padding) instead of
  // three long-labelled rows; also gives `background_padding` (a
  // number | [x,y] union) a real input instead of the union fallback.
  text: [
    {
      id: 'background',
      control: 'text-background',
      label: 'Background',
      section: 'decoration',
      order: 0,
      claims: ['background_color', 'background_border_radius', 'background_padding'],
    },
  ],
  caption: [
    {
      id: 'background',
      control: 'text-background',
      label: 'Background',
      section: 'decoration',
      order: 0,
      claims: ['background_color', 'background_border_radius', 'background_padding'],
    },
  ],
};
