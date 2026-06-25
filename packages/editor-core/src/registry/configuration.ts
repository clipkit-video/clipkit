// EditorConfiguration (EDITORS-PLAN D2 layer 3, ruled by Ian) — a
// declarative object that says what an editor instance IS: which
// views are mounted, which dock tools exist, which knobs the
// inspector exposes. The basic and advanced editors are PRESETS of
// the same machine; embedders fork a configuration, not components.

import type { ToolId } from '../types.js';
import type { EditorRegistry, ScopeRegistry } from './types.js';

export interface EditorViewsConfiguration {
  timeline: boolean;
  /** Per-audio-track meters + master rail (advanced timeline). */
  mixer: boolean;
  /** Layers / element tree panel. */
  layers: boolean;
  /** Asset bin panel. */
  assets: boolean;
  /** Dockable bidirectional JSON pane. */
  json: boolean;
  /** Keyframe lanes under expanded clips. */
  keyframeLanes: boolean;
  /** Curve (graph) editor drawer. */
  curveEditor: boolean;
}

export interface EditorConfiguration {
  id: string;
  views: EditorViewsConfiguration;
  /** Dock tools, in order. */
  dock: readonly ToolId[];
  /**
   * Knob exposure over the registry: 'all', or an allowlist of
   * section ids and/or `scope.path` field ids. Composites are exposed
   * when their section is allowed or any claimed field is listed.
   */
  knobs:
    | 'all'
    | {
        sections?: readonly string[];
        fields?: readonly string[];
      };
}

export const ADVANCED_CONFIGURATION: EditorConfiguration = {
  id: 'advanced',
  views: {
    timeline: true,
    mixer: true,
    layers: true,
    assets: true,
    json: true,
    keyframeLanes: true,
    curveEditor: true,
  },
  dock: ['text', 'shape', 'image', 'video', 'audio', 'caption'],
  knobs: 'all',
};

/** Mirrors what today's hand-coded basic panels expose — the curated
 * consumer surface. (The basic shell adopts the registry renderer
 * under this configuration in a later phase.) */
export const BASIC_CONFIGURATION: EditorConfiguration = {
  id: 'basic',
  views: {
    timeline: true,
    mixer: false,
    layers: false,
    assets: false,
    json: true,
    keyframeLanes: false,
    curveEditor: false,
  },
  dock: ['text', 'shape', 'image', 'video', 'audio', 'caption'],
  knobs: {
    sections: ['identity', 'timing', 'transform', 'appearance'],
    fields: [
      'text.text', 'text.font_family', 'text.font_size', 'text.font_weight',
      'text.line_height', 'text.letter_spacing', 'text.text_align',
      'text.vertical_align', 'text.fill_color', 'text.stroke_color',
      'text.stroke_width',
      'shape.shape', 'shape.fill_color', 'shape.stroke_color',
      'shape.stroke_width', 'shape.border_radius',
      'image.source', 'image.fit', 'image.brightness', 'image.contrast',
      'image.saturation', 'image.blur_radius',
      'video.source', 'video.volume', 'video.playback_rate', 'video.loop',
      'video.fit',
      'audio.source', 'audio.volume', 'audio.loop',
      'caption.words', 'caption.style', 'caption.font_family',
      'caption.font_size', 'caption.fill_color', 'caption.highlight_color',
    ],
  },
};

/** Is a knob (field spec or composite) exposed under a configuration? */
export function isKnobExposed(
  config: EditorConfiguration,
  scope: string,
  knob: { path?: string; section: string; claims?: readonly string[] },
): boolean {
  if (config.knobs === 'all') return true;
  const { sections = [], fields = [] } = config.knobs;
  if (sections.includes(knob.section)) return true;
  if (knob.path && fields.includes(`${scope}.${knob.path}`)) return true;
  if (knob.claims?.some((c) => fields.includes(`${scope}.${c}`))) return true;
  return false;
}

/** The scope's knobs filtered + sorted for one configuration. */
export function exposedKnobs(
  config: EditorConfiguration,
  registry: ScopeRegistry,
): { fields: ScopeRegistry['fields']; composites: ScopeRegistry['composites'] } {
  const bySection = (a: { section: string; order: number }, b: typeof a) =>
    a.section === b.section ? a.order - b.order : a.section.localeCompare(b.section);
  return {
    fields: registry.fields
      .filter((f) => isKnobExposed(config, registry.scope, f))
      .sort(bySection),
    composites: registry.composites
      .filter((c) => isKnobExposed(config, registry.scope, c))
      .sort(bySection),
  };
}

/** Convenience: every scope of the registry filtered by a configuration. */
export function configurationView(
  config: EditorConfiguration,
  registry: EditorRegistry,
): Record<string, ReturnType<typeof exposedKnobs>> {
  const out: Record<string, ReturnType<typeof exposedKnobs>> = {
    source: exposedKnobs(config, registry.source),
    animation: exposedKnobs(config, registry.animation),
  };
  for (const [k, v] of Object.entries(registry.elements)) out[k] = exposedKnobs(config, v);
  for (const [k, v] of Object.entries(registry.effects)) {
    out[`effects.${k}`] = exposedKnobs(config, v);
  }
  return out;
}
