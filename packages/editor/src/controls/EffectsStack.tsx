// Effects stack — the design-refs "FX rows" pattern: colored type
// chip, expand to params, × to remove, reorder, + to add. Params
// render FROM the registry's effect scopes through the one
// ControlRenderer mapping (D2) — adding an effect type to the
// protocol makes it appear here with zero UI work.

'use client';

import { useState } from 'react';
import type { Effect } from '@clipkit/protocol';
import { cn } from '../lib/utils.js';
import { useConfiguration } from '../configuration.js';
import { ControlRenderer } from './ControlRenderer.js';

/** Display defaults mirroring PROTOCOL §4.7 — shown when a param is
 * unauthored so the knob reads the value the runtime will use. */
const PARAM_DEFAULTS: Record<string, Record<string, unknown>> = {
  pixelate: { cell_size: 8 },
  dither: { levels: 4 },
  halftone: { cell_size: 8, angle: 45 },
  ascii: { cell_size: 12 },
  glow: { radius: 20, intensity: 1, color: '#FFFFFF' },
  drop_shadow: { offset_x: 0, offset_y: 12, blur: 18, color: '#000000', opacity: 0.6 },
  stroke: { width: 4, color: '#FFFFFF' },
  chroma_key: { color: '#00FF00', tolerance: 0.18, softness: 0.1, spill: 0.5 },
  luma_key: { threshold: 0.5, softness: 0.1, invert: false },
  levels: { in_black: 0, in_white: 1, gamma: 1, out_black: 0, out_white: 1 },
  lut: { intensity: 1 },
  fractal_noise: { scale: 100, evolution: 0, offset_x: 0, offset_y: 0, octaves: 4, seed: 0 },
  turbulent_displace: { amount: 16, scale: 120, evolution: 0, octaves: 2, seed: 0 },
  glass: {
    blur_radius: 12, refraction: 16, edge_width: 32, edge_highlight: 0.35,
    shadow: 0, dispersion: 0, backdrop_saturation: 1, mode: 'pill',
  },
};

/** Chip hues per effect family (stylize / layer style / key / color / generate). */
const CHIP_CLS: Record<string, string> = {
  pixelate: 'bg-violet-500/20 text-violet-300',
  dither: 'bg-violet-500/20 text-violet-300',
  halftone: 'bg-violet-500/20 text-violet-300',
  ascii: 'bg-violet-500/20 text-violet-300',
  glow: 'bg-amber-500/20 text-amber-300',
  drop_shadow: 'bg-amber-500/20 text-amber-300',
  stroke: 'bg-amber-500/20 text-amber-300',
  chroma_key: 'bg-emerald-500/20 text-emerald-300',
  luma_key: 'bg-emerald-500/20 text-emerald-300',
  levels: 'bg-sky-500/20 text-sky-300',
  lut: 'bg-sky-500/20 text-sky-300',
  fractal_noise: 'bg-rose-500/20 text-rose-300',
  turbulent_displace: 'bg-rose-500/20 text-rose-300',
  glass: 'bg-cyan-500/20 text-cyan-300',
};

export function EffectsStackControl({
  value,
  onChange,
  onScrubStart,
  onScrubEnd,
}: {
  value: Effect[] | undefined;
  onChange: (next: Effect[] | undefined, live: boolean) => void;
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
}) {
  const { registry } = useConfiguration();
  const [expanded, setExpanded] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const effects = value ?? [];
  const types = Object.keys(registry.effects);

  const commit = (next: Effect[], live = false): void =>
    onChange(next.length > 0 ? next : undefined, live);

  const setEffect = (i: number, patch: Record<string, unknown>, live: boolean): void =>
    commit(
      effects.map((fx, j) => (j === i ? ({ ...fx, ...patch } as Effect) : fx)),
      live,
    );

  const move = (i: number, dir: -1 | 1): void => {
    const j = i + dir;
    if (j < 0 || j >= effects.length) return;
    const next = [...effects];
    [next[i], next[j]] = [next[j]!, next[i]!];
    commit(next);
    setExpanded(null);
  };

  return (
    <div className="flex flex-col gap-0.5 w-full">
      {effects.map((fx, i) => {
        const scope = registry.effects[fx.type];
        const open = expanded === i;
        return (
          <div key={i} className="border border-border/60 rounded">
            <div className="flex items-center gap-1 h-7 px-1">
              <button
                type="button"
                className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
                onClick={() => setExpanded(open ? null : i)}
                aria-expanded={open}
              >
                <svg
                  width="6" height="6" viewBox="0 0 8 8" aria-hidden="true"
                  className={cn('text-muted-foreground shrink-0 transition-transform', open && 'rotate-90')}
                >
                  <path d="M2 1 L6 4 L2 7 Z" fill="currentColor" />
                </svg>
                <span
                  className={cn(
                    'px-1.5 py-px rounded text-[10px] font-medium truncate',
                    CHIP_CLS[fx.type] ?? 'bg-card text-muted-foreground',
                  )}
                >
                  {fx.type}
                </span>
              </button>
              <button type="button" className="w-4 h-4 grid place-items-center text-muted-foreground/50 hover:text-foreground text-[9px] disabled:opacity-20" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">▲</button>
              <button type="button" className="w-4 h-4 grid place-items-center text-muted-foreground/50 hover:text-foreground text-[9px] disabled:opacity-20" disabled={i === effects.length - 1} onClick={() => move(i, 1)} aria-label="Move down">▼</button>
              <button
                type="button"
                className="w-4 h-4 grid place-items-center text-muted-foreground/50 hover:text-foreground text-[11px]"
                onClick={() => {
                  commit(effects.filter((_, j) => j !== i));
                  setExpanded(null);
                }}
                aria-label="Remove effect"
              >
                ×
              </button>
            </div>
            {open && scope && (
              <div className="px-2 pb-2 flex flex-col">
                {scope.fields.map((spec) => {
                  const raw = (fx as unknown as Record<string, unknown>)[spec.path];
                  const shown = raw ?? PARAM_DEFAULTS[fx.type]?.[spec.path];
                  return (
                    // Same row system as the inspector: 32px pitch,
                    // fixed label column, fluid well.
                    <div key={spec.path} className="flex items-center gap-2 h-8">
                      <span className="w-16 shrink-0 text-[10px] text-muted-foreground truncate">
                        {spec.label}
                      </span>
                      <div className="flex-1 min-w-0 flex items-center gap-2">
                        <ControlRenderer
                          spec={spec}
                          value={shown}
                          fluid
                          trailing={
                            spec.animatable ? (
                              <span
                                className={Array.isArray(raw) ? 'text-primary text-[9px]' : 'text-muted-foreground/40 text-[9px]'}
                                title={Array.isArray(raw) ? 'Animated' : 'Animatable'}
                              >
                                {Array.isArray(raw) ? '◆' : '◇'}
                              </span>
                            ) : undefined
                          }
                          onChange={(v, live) => setEffect(i, { [spec.path]: v }, live)}
                          onScrubStart={onScrubStart}
                          onScrubEnd={onScrubEnd}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {adding ? (
        <select
          autoFocus
          className="h-6 bg-field hover:bg-field-hover rounded-md px-1 text-[11px] text-foreground outline-none cursor-pointer transition-colors"
          defaultValue=""
          onBlur={() => setAdding(false)}
          onChange={(e) => {
            if (e.target.value) {
              commit([...effects, { type: e.target.value } as Effect]);
              setExpanded(effects.length);
            }
            setAdding(false);
          }}
        >
          <option value="" disabled>
            Add effect…
          </option>
          {types.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      ) : (
        <button
          type="button"
          className="self-start h-5 px-1.5 rounded text-[10px] text-muted-foreground hover:text-foreground hover:bg-card transition"
          onClick={() => setAdding(true)}
        >
          + Effect
        </button>
      )}
    </div>
  );
}
