// Inspector — renders ENTIRELY from the registry filtered by the
// configuration (D2: no hand-wired per-element panels, ever). B2:
// interactive control kit with write-back through the store — element
// scope via updateElement/moveElements (scrubs are one undo step),
// Source scope via patchSource. Composites (vec2, anchor-grid) edit
// their claimed fields through the same dispatch.

'use client';

import { useMemo } from 'react';
import type { Element } from '@clipkit/protocol';
import {
  computeSourceDuration,
  elementDuration,
  elementTime,
  exposedKnobs,
  useEditor,
  useEditorContext,
  useEditorStore,
  type CompositeSpec,
  type FieldSpec,
  type ScopeRegistry,
} from '@clipkit/editor-core';
import {
  findElementById,
  sampleAnimation,
  setKeyframeValueAt,
} from '../lib/keyframes.js';
import { useConfiguration } from '../configuration.js';
import { FieldRow, Section } from '../frame/Section.js';
import { cn } from '../lib/utils.js';
import { ControlRenderer, WIDE_CONTROLS } from '../controls/ControlRenderer.js';
import { LengthControl, NumberControl } from '../controls/primitives.js';
import {
  AlignmentRow,
  AnchorControl,
  RotateControl,
  SizeControl,
  TimeRangeRows,
} from '../controls/layout.js';
import { VolumeControl } from '../controls/VolumeControl.js';
import { GradeControl } from '../controls/GradeControl.js';
import { CropControl } from '../controls/CropControl.js';
import { TextBackgroundControl } from '../controls/compound.js';
import { KeyframeDiamond } from '../controls/KeyframeDiamond.js';
import { ValueField } from '../controls/ValueField.js';
import { InterpolationPanel } from './InterpolationPanel.js';
import { ungroupInElements } from '../lib/ungroup.js';
import { groupElements } from '../lib/group.js';

// Numeric/length controls now render through the unified ValueField (mode + unit
// on the label dropdown, honest input, keyframe diamond). Other controls (color,
// select, stacks…) keep their bespoke renderers.
const NUMERIC_CONTROLS = new Set(['number', 'percent', 'angle', 'length']);

function findById(elements: readonly Element[], id: string): Element | null {
  for (const el of elements) {
    if (el.id === id) return el;
    if (el.type === 'group') {
      const nested = findById(el.elements as readonly Element[], id);
      if (nested) return nested;
    }
  }
  return null;
}

const SECTION_TITLES: Record<string, string> = {
  identity: 'Identity',
  timing: 'Time',
  transform: 'Transform',
  appearance: 'Appearance',
  color: 'Color Grading',
  filters: 'Filters',
  effects: 'Effects',
  animations: 'Animations',
  keyframes: 'Keyframes',
  audio: 'Audio',
  media: 'Media',
  source: 'Video settings',
  content: 'Content',
  typography: 'Typography',
  layout: 'Layout',
  decoration: 'Decoration',
  shape: 'Shape',
  adjust: 'Adjust',
  emission: 'Emission',
  look: 'Look',
  convergence: 'Convergence',
  group: 'Group',
  svg: 'SVG',
  material: 'Material',
};

const SECTION_ORDER = [
  'identity', 'timing', 'content', 'typography', 'layout', 'shape',
  'media', 'adjust', 'emission', 'look', 'convergence', 'group', 'svg',
  'transform', 'appearance', 'material', 'decoration', 'color', 'filters',
  'audio', 'effects', 'animations', 'keyframes',
];

function titleOf(section: string): string {
  return (
    SECTION_TITLES[section] ??
    section.charAt(0).toUpperCase() + section.slice(1)
  );
}

export function InspectorPanel() {
  const { configuration, registry } = useConfiguration();
  const actions = useEditor();
  const source = useEditorStore((s) => s.source);
  const selection = useEditorStore((s) => s.selection);
  const curveOpen = useEditorStore((s) => s.ui.curveTarget !== null);

  const selected =
    selection.length === 1 ? findById(source.elements, selection[0]!) : null;
  const selectedId = selected?.id ?? null;

  // Scope: the selected element's type, or the Source root (the
  // composition settings) when nothing is selected.
  const scope: ScopeRegistry | null = selected
    ? registry.elements[selected.type] ?? null
    : registry.source;

  const knobs = useMemo(
    () => (scope ? exposedKnobs(configuration, scope) : null),
    [configuration, scope],
  );

  if (!knobs || !scope) return null;

  // The Interpolation view takes over the inspector while a curve
  // target is open (ruled by Ian 2026-06-11 — it no longer drawers
  // over the timeline).
  if (curveOpen && configuration.views.curveEditor) {
    return <InterpolationPanel />;
  }

  // Multiple elements selected: a Group panel (replaces the source/"Video
  // settings" scope, which only makes sense for zero or one selection).
  if (selection.length >= 2) {
    return (
      <div className="flex flex-col h-full bg-background overflow-y-auto">
        <div className="flex items-center justify-between h-9 px-3 border-b border-border shrink-0">
          <span className="text-[11px] font-medium truncate">Group</span>
          <span className="text-[10px] text-muted-foreground shrink-0">{selection.length} selected</span>
        </div>
        <div className="px-3 py-2 border-b border-border">
          <button
            type="button"
            onClick={() => {
              const r = groupElements(source.elements, selection, `group-${Date.now().toString(36).slice(-5)}`);
              if (!r) return;
              actions.patchSource({ elements: r.elements });
              actions.selectOne(r.groupId);
            }}
            className="w-full h-7 rounded-md border border-border text-[11px] font-medium text-foreground hover:bg-accent transition-colors"
          >
            Group selection
          </button>
        </div>
        <AlignmentRow source={source} selection={selection} commitMany={(updates) => actions.moveElements(updates)} />
      </div>
    );
  }

  const target = (selected ?? source) as unknown as Record<string, unknown>;

  // The runtime renders spans > text. When spans are present the plain
  // `text` field is a dead control (edits change nothing on screen) —
  // hide it so the editable content is the Spans control that drives the
  // render.
  const textOverriddenBy =
    Array.isArray(target.spans) && target.spans.length > 0 ? 'Spans' : null;

  // ── Write-back (the only dispatch path in this panel) ─────────────
  const change = (path: string, next: unknown, live: boolean): void => {
    if (selectedId) {
      if (live) {
        actions.moveElements([{ id: selectedId, patch: { [path]: next } }], { skipHistory: true });
      } else {
        actions.updateElement(selectedId, { [path]: next } as Partial<Element>);
      }
    } else {
      actions.patchSource({ [path]: next }, { skipHistory: live });
    }
  };
  // Multi-field write (composites that move several fields atomically).
  const changeMany = (patch: Record<string, unknown>, live: boolean): void => {
    if (selectedId) {
      if (live) {
        actions.moveElements([{ id: selectedId, patch }], { skipHistory: true });
      } else {
        actions.updateElement(selectedId, patch as Partial<Element>);
      }
    } else {
      actions.patchSource(patch, { skipHistory: live });
    }
  };
  const scrub = {
    onScrubStart: (): void => {
      actions.pushHistory();
      actions.setInteractive(true);
    },
    onScrubEnd: (): void => {
      actions.flushPendingSource();
      actions.setInteractive(false);
    },
  };

  const animatedProps = new Set(
    (selected?.keyframe_animations ?? []).map((k) => k.property),
  );

  // Group knobs into ordered sections.
  const sections = new Map<string, Array<FieldSpec | CompositeSpec>>();
  for (const c of knobs.composites) {
    (sections.get(c.section) ?? sections.set(c.section, []).get(c.section)!).push(c);
  }
  for (const f of knobs.fields) {
    (sections.get(f.section) ?? sections.set(f.section, []).get(f.section)!).push(f);
  }
  const orderedSections = [...sections.entries()].sort(([a], [b]) => {
    const ia = SECTION_ORDER.indexOf(a);
    const ib = SECTION_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
  });

  const renderComposite = (c: CompositeSpec): React.ReactNode => {
    if (c.control === 'vec2') {
      // PROTOTYPE: position x/y use the unified ValueField (mode chip + honest
      // input + unit selector + label-scrub) instead of the old LengthControl grid.
      const [px = 'x', py = 'y'] = c.claims;
      const axis = (path: string, label: string): FieldSpec =>
        ({ path, label, control: 'length', animatable: true, step: 1 } as unknown as FieldSpec);
      return (
        <div key={c.id}>
          <ValueField spec={axis(px, 'X')} value={target[px]} elementId={selectedId} animated={animatedProps.has(px)} {...scrub} />
          <ValueField spec={axis(py, 'Y')} value={target[py]} elementId={selectedId} animated={animatedProps.has(py)} {...scrub} />
        </div>
      );
    }
    if (c.control === 'time-range' && selected) {
      return (
        <TimeRangeRows
          key={c.id}
          time={typeof selected.time === 'number' ? selected.time : undefined}
          resolvedDuration={elementDuration(selected, computeSourceDuration(source))}
          commit={changeMany}
          {...scrub}
        />
      );
    }
    if (c.control === 'size') {
      // Width/height stacked like Position x/y — keyframeable, expressible, with
      // the px/%/expression dropdown.
      const [pw = 'width', ph = 'height'] = c.claims;
      const axis = (path: string, label: string): FieldSpec =>
        ({ path, label, control: 'length', animatable: true, step: 1 } as unknown as FieldSpec);
      return (
        <div key={c.id}>
          <ValueField spec={axis(pw, 'Width')} value={target[pw]} elementId={selectedId} animated={animatedProps.has(pw)} {...scrub} />
          <ValueField spec={axis(ph, 'Height')} value={target[ph]} elementId={selectedId} animated={animatedProps.has(ph)} {...scrub} />
        </div>
      );
    }
    if (c.control === 'rotate') {
      return (
        <FieldRow key={c.id} label={c.label}>
          <RotateControl
            rotation={target.rotation}
            xScale={target.x_scale}
            yScale={target.y_scale}
            commit={changeMany}
            {...scrub}
          />
        </FieldRow>
      );
    }
    if (c.control === 'volume' && selectedId) {
      return (
        <VolumeControl
          key={c.id}
          elementId={selectedId}
          value={target.volume}
          commit={changeMany}
          trailing={
            <KeyframeDiamond
              elementId={selectedId}
              property="volume"
              animated={animatedProps.has('volume')}
              current={target.volume}
              percentDefault
            />
          }
          {...scrub}
        />
      );
    }
    if (c.control === 'fades') {
      const [fin = 'audio_fade_in', fout = 'audio_fade_out'] = c.claims;
      return (
        <FieldRow key={c.id} label={c.label}>
          <div className="flex-1 grid grid-cols-2 gap-2 min-w-0">
            <NumberControl
              value={typeof target[fin] === 'number' ? (target[fin] as number) : 0}
              min={0}
              step={0.1}
              suffix="s"
              fluid
              onChange={(v, live) => change(fin, v, live)}
              {...scrub}
            />
            <NumberControl
              value={typeof target[fout] === 'number' ? (target[fout] as number) : 0}
              min={0}
              step={0.1}
              suffix="s"
              fluid
              onChange={(v, live) => change(fout, v, live)}
              {...scrub}
            />
          </div>
        </FieldRow>
      );
    }
    if (c.control === 'text-background') {
      // Full-width, label-above — matches the box-shadow / text-mask
      // WIDE_CONTROLS below it (not a side-by-side FieldRow).
      return (
        <div key={c.id} className="py-1">
          <span className="block text-[11px] text-muted-foreground mb-1">{c.label}</span>
          <TextBackgroundControl
            color={typeof target.background_color === 'string' ? target.background_color : undefined}
            radius={typeof target.background_border_radius === 'number' ? target.background_border_radius : undefined}
            padding={target.background_padding as number | [number, number] | undefined}
            commit={changeMany}
          />
        </div>
      );
    }
    if (c.control === 'anchor-grid') {
      const [ax = 'x_anchor', ay = 'y_anchor'] = c.claims;
      return (
        <AnchorControl
          key={c.id}
          xAnchor={target[ax]}
          yAnchor={target[ay]}
          commit={changeMany}
          {...scrub}
        />
      );
    }
    if (c.control === 'color-grade') {
      // Self-managed fly-out (reads selection + patches the filter fields).
      return (
        <div key={c.id} className="py-1">
          <GradeControl />
        </div>
      );
    }
    if (c.control === 'crop') {
      // Self-managed: crop_* fields + a fly-out frame editor over the media.
      return <CropControl key={c.id} />;
    }
    // Unknown composite kind — its widget hasn't landed yet.
    return (
      <FieldRow key={c.id} label={c.label}>
        <span className="text-[11px] font-mono text-muted-foreground/60">
          {c.control}
        </span>
      </FieldRow>
    );
  };

  return (
    <div className="flex flex-col h-full bg-background overflow-y-auto">
      <div className="flex items-center justify-between h-9 px-3 border-b border-border shrink-0">
        <span className="text-[11px] font-medium truncate">
          {selected
            ? `${selected.type}${selected.name ? ` · ${selected.name}` : selected.id ? ` · ${selected.id}` : ''}`
            : 'Video settings'}
        </span>
        {selection.length > 1 && (
          <span className="text-[10px] text-muted-foreground shrink-0">
            {selection.length} selected
          </span>
        )}
      </div>
      {selected?.type === 'group' && selectedId && (
        <div className="px-3 py-2 border-b border-border">
          <button
            type="button"
            onClick={() => {
              const r = ungroupInElements(source.elements, selectedId);
              if (!r) return;
              actions.patchSource({ elements: r.elements });
              actions.setSelection(r.liftedIds);
            }}
            className="w-full h-7 rounded-md border border-border text-[11px] font-medium text-foreground hover:bg-accent transition-colors"
          >
            Ungroup
          </button>
        </div>
      )}
      {selection.length > 0 && (
        <AlignmentRow
          source={source}
          selection={selection}
          commitMany={(updates) => actions.moveElements(updates)}
        />
      )}
      {orderedSections.map(([sectionId, items]) => (
        <Section key={sectionId} title={titleOf(sectionId)}>
          {items
            .sort((a, b) => a.order - b.order)
            // Drop the dead `text` field when Spans/Template override it.
            .filter((item) => 'claims' in item || !(textOverriddenBy && item.path === 'text'))
            .map((item) =>
              'claims' in item ? (
                renderComposite(item)
              ) : WIDE_CONTROLS.has(item.control) ? (
                <div key={item.path} className="py-1">
                  <span className="block text-[11px] text-muted-foreground mb-1">
                    {item.label}
                  </span>
                  <ControlRenderer
                    spec={item}
                    value={target[item.path]}
                    onChange={(v, live) => change(item.path, v, live)}
                    {...scrub}
                  />
                </div>
              ) : NUMERIC_CONTROLS.has(item.control) ? (
                // The default knob for numeric/length fields: mode + unit on the
                // label dropdown, honest input, keyframe diamond (hidden for exprs).
                <ValueField
                  key={item.path}
                  spec={item}
                  value={target[item.path]}
                  elementId={selectedId}
                  animated={animatedProps.has(item.path)}
                  {...scrub}
                />
              ) : (
                <FieldKnobRow
                  key={item.path}
                  spec={item}
                  staticValue={target[item.path]}
                  elementId={selectedId}
                  animated={animatedProps.has(item.path)}
                  onStatic={(v, live) => change(item.path, v, live)}
                  {...scrub}
                />
              ),
            )}
        </Section>
      ))}
    </div>
  );
}

/**
 * One registry field row. When the property is ANIMATED (has a
 * keyframe_animations entry), the well shows the SAMPLED value at the
 * playhead and edits write the keyframe there — replacing it when the
 * playhead sits on one, auto-adding one otherwise (Ian's ruling: two
 * keyframes must be able to hold two values). Static fields write the
 * plain field as before.
 */
function FieldKnobRow({
  spec,
  staticValue,
  elementId,
  animated,
  onStatic,
  onScrubStart,
  onScrubEnd,
}: {
  spec: FieldSpec;
  staticValue: unknown;
  elementId: string | null;
  animated: boolean;
  onStatic: (v: unknown, live: boolean) => void;
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
}) {
  const { store } = useEditorContext();
  const actions = useEditor();

  // Sampled display value — re-renders only when the sample changes
  // (scalars only; array-valued samples keep the static display).
  const sampled = useEditorStore((s) => {
    if (!animated || !elementId) return undefined;
    const el = findElementById(s.source.elements, elementId);
    const anim = el?.keyframe_animations?.find((a) => a.property === spec.path);
    if (!el || !anim) return undefined;
    const v = sampleAnimation(anim, Math.max(0, s.playback.time - elementTime(el)));
    return Array.isArray(v) ? undefined : v;
  });

  const onChange = (v: unknown, live: boolean): void => {
    if (
      animated &&
      elementId &&
      (typeof v === 'number' || typeof v === 'string')
    ) {
      const st = store.getState();
      const el = findElementById(st.source.elements, elementId);
      const anims = el?.keyframe_animations ?? [];
      const ai = anims.findIndex((a) => a.property === spec.path);
      if (el && ai >= 0) {
        const local =
          Math.round(Math.max(0, st.playback.time - elementTime(el)) * 1000) / 1000;
        const patch = {
          keyframe_animations: setKeyframeValueAt(anims, ai, local, v),
        } as Partial<Element>;
        if (live) {
          actions.moveElements([{ id: elementId, patch }], { skipHistory: true });
        } else {
          actions.updateElement(elementId, patch);
        }
        return;
      }
    }
    onStatic(v, live);
  };

  return (
    <FieldRow label={spec.label}>
      <ControlRenderer
        spec={spec}
        value={sampled !== undefined ? sampled : staticValue}
        onChange={onChange}
        fluid
        trailing={
          spec.animatable && elementId ? (
            <KeyframeDiamond
              elementId={elementId}
              property={spec.path}
              animated={animated}
              current={staticValue}
              percentDefault={spec.control === 'percent'}
            />
          ) : undefined
        }
        onScrubStart={onScrubStart}
        onScrubEnd={onScrubEnd}
      />
    </FieldRow>
  );
}

function numOrStr(v: unknown): number | string {
  return typeof v === 'number' || typeof v === 'string' ? v : 0;
}
