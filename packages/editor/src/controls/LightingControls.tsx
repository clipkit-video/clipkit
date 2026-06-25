// Material / Lights / Environment controls (LIGHTING-PLAN P1.4, §4.8).
// Custom controls for the per-element `material` field and the Source
// scope's `lights` (array) and `environment` (gradient) — registered in
// ControlRenderer, surfaced via the registry overrides. Each edits its
// whole nested value and writes it back through the patch path.
//
// Scalar fields are animatable via inline Keyframe[] arrays (the runtime
// resolves them). When a field already holds a curve we show an
// "animated" chip instead of a number well, so this static panel never
// clobbers a keyframed value.

'use client';

import type { Bloom, Environment, Light, Material } from '@clipkit/protocol';
import { cn } from '../lib/utils.js';
import { ColorControl, NumberControl, SelectControl, TextControl, type ScrubHandlers } from './primitives.js';

const BOX = 'flex flex-col w-full border border-border/60 rounded px-2 py-1.5 gap-0.5';
const ROW = 'flex items-center gap-2 h-8';
const LABEL = 'text-[10px] text-muted-foreground w-16 shrink-0 truncate';
const ADD_BTN =
  'h-5 px-1.5 rounded text-[10px] text-muted-foreground hover:text-foreground hover:bg-card transition';
const SUBHEAD = 'text-[10px] font-medium text-muted-foreground/80 mt-1 mb-0.5';

function isAnimated(v: unknown): boolean {
  return Array.isArray(v);
}

/** Number well, or an "animated" chip when the field holds a curve. */
function NumOrAnim({
  value,
  fallback,
  onChange,
  scrub,
  ...rest
}: {
  value: unknown;
  fallback: number;
  onChange: (v: number, live: boolean) => void;
  scrub: ScrubHandlers;
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
      value={typeof value === 'number' ? value : fallback}
      fluid
      stepper
      onChange={onChange}
      onScrubStart={scrub.onScrubStart}
      onScrubEnd={scrub.onScrubEnd}
      {...rest}
    />
  );
}

// ─── Material (per element) ────────────────────────────────────────────────

export function MaterialControl({
  value,
  onChange,
  onScrubStart,
  onScrubEnd,
}: {
  value: Material | undefined;
  onChange: (next: Material | undefined, live: boolean) => void;
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
}) {
  const scrub = { onScrubStart, onScrubEnd };
  if (!value) {
    return (
      <button
        type="button"
        className={ADD_BTN}
        onClick={() => onChange({ roughness: 0.4, metalness: 0.6, reflectivity: 1 }, false)}
      >
        + Add material
      </button>
    );
  }
  const set = (patch: Partial<Material>, live: boolean): void =>
    onChange({ ...value, ...patch }, live);
  return (
    <div className={BOX}>
      <div className={ROW}>
        <span className={LABEL}>Roughness</span>
        <div className="flex-1 min-w-0">
          <NumOrAnim value={value.roughness} fallback={0.4} min={0.02} max={1} step={0.01}
            scrub={scrub} onChange={(v, live) => set({ roughness: v }, live)} />
        </div>
      </div>
      <div className={ROW}>
        <span className={LABEL}>Metalness</span>
        <div className="flex-1 min-w-0">
          <NumOrAnim value={value.metalness} fallback={0.6} min={0} max={1} step={0.01}
            scrub={scrub} onChange={(v, live) => set({ metalness: v }, live)} />
        </div>
      </div>
      <div className={ROW}>
        <span className={LABEL}>Reflectivity</span>
        <div className="flex-1 min-w-0">
          <NumOrAnim value={value.reflectivity} fallback={1} min={0} max={2} step={0.05}
            scrub={scrub} onChange={(v, live) => set({ reflectivity: v }, live)} />
        </div>
      </div>
      <div className={ROW}>
        <span className={LABEL}>Emissive</span>
        <div className="flex-1 min-w-0">
          <NumOrAnim value={value.emissive} fallback={0} min={0} max={1} step={0.05}
            scrub={scrub} onChange={(v, live) => set({ emissive: v }, live)} />
        </div>
      </div>
      <div className={ROW}>
        <span className={LABEL}>Normal map</span>
        <div className="flex-1 min-w-0">
          <TextControl value={value.normal_map ?? ''} fluid
            onChange={(v) => set({ normal_map: v || undefined }, false)} />
        </div>
      </div>
      {value.normal_map ? (
        <div className={ROW}>
          <span className={LABEL}>Nrm scale</span>
          <div className="flex-1 min-w-0">
            <NumOrAnim value={value.normal_scale} fallback={1} min={0} max={4} step={0.05}
              scrub={scrub} onChange={(v, live) => set({ normal_scale: v }, live)} />
          </div>
        </div>
      ) : null}
      <div className="flex pt-0.5">
        <button type="button" className={cn(ADD_BTN, 'ml-auto')}
          onClick={() => onChange(undefined, false)}>
          Remove
        </button>
      </div>
    </div>
  );
}

// ─── Lights (Source) ───────────────────────────────────────────────────────

export function LightsControl({
  value,
  onChange,
  onScrubStart,
  onScrubEnd,
}: {
  value: Light[] | undefined;
  onChange: (next: Light[] | undefined, live: boolean) => void;
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
}) {
  const scrub = { onScrubStart, onScrubEnd };
  const lights = value ?? [];

  const setAt = (i: number, patch: Partial<Light>, live: boolean): void => {
    const next = lights.map((l, j) => (j === i ? { ...l, ...patch } as Light : l));
    onChange(next, live);
  };
  const removeAt = (i: number): void => {
    const next = lights.filter((_, j) => j !== i);
    onChange(next.length ? next : undefined, false);
  };
  const add = (light: Light): void => onChange([...lights, light], false);

  return (
    <div className={BOX}>
      {lights.map((l, i) => (
        <div key={i} className="border-b border-border/40 last:border-0 pb-1 mb-1 last:pb-0 last:mb-0">
          <div className={ROW}>
            <span className={LABEL}>Type</span>
            <div className="flex-1 min-w-0 grid grid-cols-[1fr_auto] gap-2 items-center">
              <SelectControl
                value={l.type}
                options={['ambient', 'directional']}
                fluid
                onChange={(v) => {
                  // Switching type: keep color/intensity, drop/add the
                  // directional-only angle fields with sane defaults.
                  if (v === 'directional') setAt(i, { type: 'directional', azimuth: 30, elevation: 45 } as Partial<Light>, false);
                  else setAt(i, { type: 'ambient' } as Partial<Light>, false);
                }}
              />
              <button type="button" className={cn(ADD_BTN, 'justify-self-end')} onClick={() => removeAt(i)}>
                Remove
              </button>
            </div>
          </div>
          <div className={ROW}>
            <span className={LABEL}>Color</span>
            <div className="flex-1 min-w-0">
              <ColorControl value={l.color ?? '#ffffff'} fluid
                onChange={(v) => setAt(i, { color: v }, false)} />
            </div>
          </div>
          <div className={ROW}>
            <span className={LABEL}>Intensity</span>
            <div className="flex-1 min-w-0">
              <NumOrAnim value={(l as { intensity?: unknown }).intensity} fallback={1} min={0} max={10} step={0.1}
                scrub={scrub} onChange={(v, live) => setAt(i, { intensity: v } as Partial<Light>, live)} />
            </div>
          </div>
          {l.type === 'directional' && (
            <div className={ROW}>
              <span className={LABEL}>Direction</span>
              <div className="flex-1 min-w-0 grid grid-cols-2 gap-2">
                <NumOrAnim value={l.azimuth} fallback={30} suffix="°" prefix="Az" scrub={scrub}
                  onChange={(v, live) => setAt(i, { azimuth: v } as Partial<Light>, live)} />
                <NumOrAnim value={l.elevation} fallback={45} suffix="°" prefix="El" scrub={scrub}
                  onChange={(v, live) => setAt(i, { elevation: v } as Partial<Light>, live)} />
              </div>
            </div>
          )}
        </div>
      ))}
      <div className="flex gap-1 pt-0.5">
        <button type="button" className={ADD_BTN}
          onClick={() => add({ type: 'ambient', color: '#ffffff', intensity: 0.6 } as Light)}>
          + Ambient
        </button>
        <button type="button" className={ADD_BTN}
          onClick={() => add({ type: 'directional', color: '#ffffff', intensity: 2, azimuth: 30, elevation: 45 } as Light)}>
          + Directional
        </button>
      </div>
    </div>
  );
}

// ─── Bloom (Source) ────────────────────────────────────────────────────────

export function BloomControl({
  value,
  onChange,
  onScrubStart,
  onScrubEnd,
}: {
  value: Bloom | undefined;
  onChange: (next: Bloom | undefined, live: boolean) => void;
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
}) {
  const scrub = { onScrubStart, onScrubEnd };
  if (!value) {
    return (
      <button type="button" className={ADD_BTN}
        onClick={() => onChange({ threshold: 0.75, intensity: 1, radius: 24 }, false)}>
        + Add bloom
      </button>
    );
  }
  const set = (patch: Partial<Bloom>, live: boolean): void => onChange({ ...value, ...patch }, live);
  return (
    <div className={BOX}>
      <div className={ROW}>
        <span className={LABEL}>Threshold</span>
        <div className="flex-1 min-w-0">
          <NumOrAnim value={value.threshold} fallback={0.75} min={0} max={1} step={0.01}
            scrub={scrub} onChange={(v, live) => set({ threshold: v }, live)} />
        </div>
      </div>
      <div className={ROW}>
        <span className={LABEL}>Intensity</span>
        <div className="flex-1 min-w-0">
          <NumOrAnim value={value.intensity} fallback={1} min={0} max={4} step={0.05}
            scrub={scrub} onChange={(v, live) => set({ intensity: v }, live)} />
        </div>
      </div>
      <div className={ROW}>
        <span className={LABEL}>Radius</span>
        <div className="flex-1 min-w-0 grid grid-cols-[1fr_auto] gap-2 items-center">
          <NumOrAnim value={value.radius} fallback={24} min={1} max={200} step={1}
            scrub={scrub} onChange={(v, live) => set({ radius: v }, live)} />
          <button type="button" className={cn(ADD_BTN, 'justify-self-end')}
            onClick={() => onChange(undefined, false)}>
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Environment (Source) ──────────────────────────────────────────────────

export function EnvironmentControl({
  value,
  onChange,
}: {
  value: Environment | undefined;
  onChange: (next: Environment | undefined, live: boolean) => void;
}) {
  if (!value) {
    return (
      <button
        type="button"
        className={ADD_BTN}
        onClick={() =>
          onChange(
            { type: 'gradient', stops: [
              { offset: 0, color: '#0a0e16' },
              { offset: 1, color: '#7fb4ff' },
            ] },
            false,
          )
        }
      >
        + Add environment
      </button>
    );
  }
  // Type selector — gradient sky vs equirect image. Switching swaps to a
  // sensible default of the other type.
  const typeRow = (
    <div className={ROW}>
      <span className={LABEL}>Type</span>
      <div className="flex-1 min-w-0 grid grid-cols-[1fr_auto] gap-2 items-center">
        <SelectControl
          value={value.type}
          options={['gradient', 'image']}
          fluid
          onChange={(v) => {
            if (v === 'image') onChange({ type: 'image', src: '' }, false);
            else onChange({ type: 'gradient', stops: [
              { offset: 0, color: '#0a0e16' }, { offset: 1, color: '#7fb4ff' },
            ] }, false);
          }}
        />
        <button type="button" className={cn(ADD_BTN, 'justify-self-end')}
          onClick={() => onChange(undefined, false)}>
          Remove
        </button>
      </div>
    </div>
  );

  if (value.type === 'image') {
    return (
      <div className={BOX}>
        {typeRow}
        <div className={ROW}>
          <span className={LABEL}>Image URL</span>
          <div className="flex-1 min-w-0">
            <TextControl value={value.src ?? ''} fluid
              onChange={(v) => onChange({ type: 'image', src: v }, false)} />
          </div>
        </div>
        <div className={SUBHEAD}>Equirectangular (2:1) — surfaces mirror it.</div>
      </div>
    );
  }

  const stops = value.stops ?? [];
  const setStop = (i: number, patch: Partial<{ offset: number; color: string }>): void => {
    const next = stops.map((s, j) => (j === i ? { ...s, ...patch } : s));
    onChange({ type: 'gradient', stops: next }, false);
  };
  const removeStop = (i: number): void => {
    if (stops.length <= 2) return; // a gradient needs ≥2 stops
    onChange({ type: 'gradient', stops: stops.filter((_, j) => j !== i) }, false);
  };
  const addStop = (): void => {
    if (stops.length >= 4) return; // shader samples up to 4
    onChange({ type: 'gradient', stops: [...stops, { offset: 0.5, color: '#3a4a66' }] }, false);
  };
  return (
    <div className={BOX}>
      {typeRow}
      <div className={SUBHEAD}>Gradient sky (offset 0 = down, 1 = up)</div>
      {stops.map((s, i) => (
        <div key={i} className={ROW}>
          <div className="w-16 shrink-0">
            <ColorControl value={s.color ?? '#ffffff'} fluid
              onChange={(v) => setStop(i, { color: v })} />
          </div>
          <div className="flex-1 min-w-0 grid grid-cols-[1fr_auto] gap-2 items-center">
            <NumberControl value={typeof s.offset === 'number' ? s.offset : 0} min={0} max={1} step={0.01}
              fluid stepper onChange={(v) => setStop(i, { offset: v })} />
            <button type="button" className={cn(ADD_BTN, 'justify-self-end')}
              disabled={stops.length <= 2} onClick={() => removeStop(i)}>
              ✕
            </button>
          </div>
        </div>
      ))}
      <div className="flex gap-1 pt-0.5">
        <button type="button" className={ADD_BTN} disabled={stops.length >= 4} onClick={addStop}>
          + Stop
        </button>
      </div>
    </div>
  );
}
