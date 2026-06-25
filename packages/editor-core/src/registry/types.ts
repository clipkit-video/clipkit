// Registry types — the derive → override → configuration pipeline
// (EDITORS-PLAN D2). A FieldSpec describes ONE knob; a CompositeSpec
// swallows several fields behind one widget; a ScopeRegistry is the
// resolved knob set for one scope (the Source root, an element type,
// an effect type, the animation params).

/** Built-in control kinds. Shells may register custom kinds (the
 * composite widgets reference them by string). */
export type ControlKind =
  | 'number'    // drag-scrub number field (min/max/step when known)
  | 'length'    // number + unit (px / % / vw / vh / vmin / vmax)
  | 'angle'     // degrees
  | 'percent'   // 0–100
  | 'color'     // swatch + picker (hex string)
  | 'select'    // enum dropdown / segmented control
  | 'toggle'    // boolean
  | 'text'      // free string
  | 'url'       // asset reference string
  | 'keyframes' // a Keyframe[] value (curve-editor territory)
  | 'list'      // array of structured items
  | 'json'      // structured fallback — derived only, triage flag
  | (string & {});

export interface FieldSpec {
  /** Field key within its scope (top-level protocol field name). */
  path: string;
  control: ControlKind;
  label: string;
  /** Inspector section id, e.g. 'transform', 'appearance', 'effects.glass'. */
  section: string;
  /** Sort order within the section (lower first; derived = 1000). */
  order: number;
  min?: number;
  max?: number;
  step?: number;
  /** Options for 'select'. */
  options?: readonly string[];
  /** The value accepts Keyframe[] — render the keyframe diamond. */
  animatable: boolean;
  /**
   * 'derived' = mechanically produced from the zod schema (renders a
   * sane default, FLAGGED for design polish). 'override' = a human
   * ruled on its presentation.
   */
  origin: 'derived' | 'override';
  /** Deriver context for the triage list ("union fallback", …). */
  note?: string;
}

/** One widget that replaces a group of fields (precedence: composite
 * claim > field override > derived default). */
export interface CompositeSpec {
  id: string;
  /** Custom control kind the shell registers a component for. */
  control: string;
  label: string;
  section: string;
  order: number;
  /** Field paths this widget swallows. */
  claims: readonly string[];
}

export interface ScopeRegistry {
  scope: string;
  fields: FieldSpec[];
  composites: CompositeSpec[];
}

export interface EditorRegistry {
  /** Source-level (composition) knobs. */
  source: ScopeRegistry;
  /** Per element type ('video', 'text', …). */
  elements: Record<string, ScopeRegistry>;
  /** Per effect type ('glow', 'glass', …) — params of one effects[] entry. */
  effects: Record<string, ScopeRegistry>;
  /** Params of one animations[] entry (the preset animations). */
  animation: ScopeRegistry;
}

/** A field-level presentation override (merged over the derived spec). */
export type FieldOverride = Partial<
  Omit<FieldSpec, 'path' | 'origin'>
>;
