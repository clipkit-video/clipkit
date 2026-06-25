// Animations stack (EDITORS B11) — browse / apply / stack the
// protocol's preset animations (ANIMATION_TYPES — "the 30 presets").
// Same FX-row pattern as the effects stack: family-hued type chip,
// expand to params, reorder, ×, grouped "+ Animation" picker. Params
// render from the registry's `animation` scope through ControlRenderer,
// FILTERED to the params the preset actually reads (per PROTOCOL §6.2)
// so a `seed` knob never shows on a fade. Unauthored params display
// the runtime's normative defaults (presets.ts / text-animation.ts).
//
// Entrance/exit anchoring: `time` renders as a Start / End / At-s
// segmented control; adding an exit-family preset writes `time: "end"`
// EXPLICITLY (the protocol stays literal — no hidden anchor semantics).
// Families derive from the type names, so a future 31st preset appears
// in the picker with zero UI work (D2).

'use client';

import { useState } from 'react';
import { ANIMATION_TYPES, type Animation, type AnimationType } from '@clipkit/protocol';
import { cn } from '../lib/utils.js';
import { useConfiguration } from '../configuration.js';
import { ControlRenderer } from './ControlRenderer.js';
import { NumberControl, SelectControl } from './primitives.js';

type Family = 'entrance' | 'exit' | 'accent' | 'ambient' | 'text';

function familyOf(type: string): Family {
  if (type.startsWith('text-')) return 'text';
  if (type.endsWith('-in')) return 'entrance';
  if (type.endsWith('-out')) return 'exit';
  if (type === 'drift' || type === 'breathe' || type === 'orbit') return 'ambient';
  return 'accent';
}

const FAMILY_LABEL: Record<Family, string> = {
  entrance: 'Entrance',
  exit: 'Exit',
  accent: 'Accent',
  ambient: 'Ambient',
  text: 'Text',
};
const FAMILY_ORDER: Family[] = ['entrance', 'exit', 'accent', 'ambient', 'text'];

const CHIP_CLS: Record<Family, string> = {
  entrance: 'bg-emerald-500/20 text-emerald-300',
  exit: 'bg-rose-500/20 text-rose-300',
  accent: 'bg-amber-500/20 text-amber-300',
  ambient: 'bg-sky-500/20 text-sky-300',
  text: 'bg-violet-500/20 text-violet-300',
};

/** Params each preset actually reads (PROTOCOL §6.2 / §6.5). */
function paramsFor(type: string): readonly string[] {
  const p: string[] = ['duration', 'easing'];
  if (type.startsWith('text-')) p.push('split', 'stagger');
  if (['shake', 'wiggle', 'drift', 'breathe', 'orbit', 'text-wave'].includes(type)) p.push('frequency');
  if (['spin', 'wiggle', 'text-flip'].includes(type)) p.push('rotation');
  if (type === 'text-flip') p.push('axis');
  if (['pan', 'shift', 'shake', 'drift', 'orbit', 'text-slide', 'text-fly', 'text-wave'].includes(type)) p.push('distance');
  if (['pan', 'shift', 'orbit', 'text-slide', 'text-fly'].includes(type)) p.push('direction');
  if (['squash', 'breathe'].includes(type)) p.push('scale');
  if (type === 'drift') p.push('seed');
  return p;
}

/** Runs the element's full life when untimed — duration shows "auto". */
const FULL_LENGTH = new Set(['spin', 'shake', 'wiggle', 'pan', 'drift', 'breathe', 'orbit', 'text-wave']);

/** Display defaults mirroring the runtime's normative fallbacks. */
function defaultFor(type: string, param: string): unknown {
  switch (param) {
    case 'duration':
      return FULL_LENGTH.has(type) ? undefined : 0.5;
    case 'easing':
      return 'ease-out';
    case 'split':
      return type === 'text-typewriter' || type === 'text-wave' || type === 'text-flip'
        ? 'letter'
        : 'word';
    case 'stagger':
      return defaultFor(type, 'split') === 'word' ? 0.09 : 0.035;
    case 'frequency':
      return { shake: 8, wiggle: 2, drift: 0.5, breathe: 0.4, orbit: 0.5, 'text-wave': 1.5 }[type];
    case 'rotation':
      return { spin: 360, wiggle: 8, 'text-flip': 90 }[type];
    case 'distance':
      return {
        shake: 24, drift: 30, orbit: 40, pan: 200, shift: 200,
        'text-slide': 40, 'text-fly': 140, 'text-wave': 12,
      }[type];
    case 'direction':
      return type === 'text-slide' || type === 'text-fly' ? 'up' : 'right';
    case 'scale':
      return { squash: 0.3, breathe: 0.05 }[type];
    case 'seed':
      return 0;
    default:
      return undefined;
  }
}

const NAMED_EASINGS = [
  'linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out',
  'ease-in-cubic', 'ease-out-cubic', 'ease-in-out-cubic',
  'ease-out-quart', 'ease-out-expo', 'ease-out-back', 'spring',
  'elastic-out', 'bounce-out',
];

export function AnimationsStackControl({
  value,
  onChange,
  onScrubStart,
  onScrubEnd,
}: {
  value: Animation[] | undefined;
  onChange: (next: Animation[] | undefined, live: boolean) => void;
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
}) {
  const { registry } = useConfiguration();
  const [expanded, setExpanded] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const animations = value ?? [];

  const commit = (next: Animation[], live = false): void =>
    onChange(next.length > 0 ? next : undefined, live);

  const setAnim = (i: number, patch: Record<string, unknown>, live: boolean): void =>
    commit(
      animations.map((a, j) => {
        if (j !== i) return a;
        const next = { ...a, ...patch } as Record<string, unknown>;
        // Unauthored params stay unauthored (byte-clean documents).
        for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
        return next as unknown as Animation;
      }),
      live,
    );

  const move = (i: number, dir: -1 | 1): void => {
    const j = i + dir;
    if (j < 0 || j >= animations.length) return;
    const next = [...animations];
    [next[i], next[j]] = [next[j]!, next[i]!];
    commit(next);
    setExpanded(null);
  };

  return (
    <div className="flex flex-col gap-0.5 w-full">
      {animations.map((anim, i) => {
        const family = familyOf(anim.type);
        const open = expanded === i;
        const params = paramsFor(anim.type);
        const specs = registry.animation.fields.filter((s) => params.includes(s.path));
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
                <span className={cn('px-1.5 py-px rounded text-[10px] font-medium truncate', CHIP_CLS[family])}>
                  {anim.type}
                </span>
                <span className="text-[9px] text-muted-foreground/60 truncate">
                  {anim.time === 'end' ? 'end' : typeof anim.time === 'number' ? `${anim.time}s` : 'start'}
                </span>
              </button>
              <button type="button" className="w-4 h-4 grid place-items-center text-muted-foreground/50 hover:text-foreground text-[9px] disabled:opacity-20" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">▲</button>
              <button type="button" className="w-4 h-4 grid place-items-center text-muted-foreground/50 hover:text-foreground text-[9px] disabled:opacity-20" disabled={i === animations.length - 1} onClick={() => move(i, 1)} aria-label="Move down">▼</button>
              <button
                type="button"
                className="w-4 h-4 grid place-items-center text-muted-foreground/50 hover:text-foreground text-[11px]"
                onClick={() => {
                  commit(animations.filter((_, j) => j !== i));
                  setExpanded(null);
                }}
                aria-label="Remove animation"
              >
                ×
              </button>
            </div>
            {open && (
              <div className="px-2 pb-2 flex flex-col">
                {/* Anchor — Start / End / At seconds (writes `time`).
                    Same 32px row system as the inspector. */}
                <div className="flex items-center gap-2 h-8">
                  <span className="w-16 shrink-0 text-[10px] text-muted-foreground truncate">Anchor</span>
                  <div className="flex-1 min-w-0 flex items-center gap-2">
                    <div className="flex flex-1 min-w-0 h-6 gap-px rounded-md overflow-hidden">
                      {(['start', 'end', 'at'] as const).map((mode) => {
                        const active =
                          mode === 'at'
                            ? typeof anim.time === 'number'
                            : mode === 'end'
                              ? anim.time === 'end'
                              : anim.time === 'start' || anim.time === undefined;
                        return (
                          <button
                            key={mode}
                            type="button"
                            className={cn(
                              'flex-1 h-6 text-[10px] capitalize transition-colors',
                              active
                                ? 'bg-secondary text-foreground'
                                : 'bg-field text-muted-foreground hover:text-foreground hover:bg-field-hover',
                            )}
                            onClick={() =>
                              setAnim(
                                i,
                                {
                                  time:
                                    mode === 'start'
                                      ? undefined
                                      : mode === 'end'
                                        ? 'end'
                                        : typeof anim.time === 'number'
                                          ? anim.time
                                          : 0,
                                },
                                false,
                              )
                            }
                          >
                            {mode}
                          </button>
                        );
                      })}
                    </div>
                    {typeof anim.time === 'number' && (
                      <NumberControl
                        value={anim.time}
                        min={0}
                        step={0.05}
                        suffix="s"
                        width={64}
                        onChange={(v, live) => setAnim(i, { time: v }, live)}
                        onScrubStart={onScrubStart}
                        onScrubEnd={onScrubEnd}
                      />
                    )}
                  </div>
                </div>
                {specs.map((spec) => {
                  const raw = (anim as unknown as Record<string, unknown>)[spec.path];
                  const fallback = defaultFor(anim.type, spec.path);
                  if (spec.path === 'easing') {
                    const cur = typeof raw === 'string' ? raw : (fallback as string);
                    const opts = NAMED_EASINGS.includes(cur) ? NAMED_EASINGS : [cur, ...NAMED_EASINGS];
                    return (
                      <div key={spec.path} className="flex items-center gap-2 h-8">
                        <span className="w-16 shrink-0 text-[10px] text-muted-foreground truncate">Easing</span>
                        <div className="flex-1 min-w-0">
                          <SelectControl
                            value={cur}
                            options={opts}
                            fluid
                            onChange={(v) => setAnim(i, { easing: v }, false)}
                          />
                        </div>
                      </div>
                    );
                  }
                  const shown =
                    raw ??
                    (spec.path === 'duration' && FULL_LENGTH.has(anim.type) ? undefined : fallback);
                  return (
                    <div key={spec.path} className="flex items-center gap-2 h-8">
                      <span
                        className="w-16 shrink-0 text-[10px] text-muted-foreground truncate"
                        title={
                          spec.path === 'duration' && FULL_LENGTH.has(anim.type)
                            ? 'Defaults to the element’s full duration when untimed'
                            : undefined
                        }
                      >
                        {spec.label}
                      </span>
                      <div className="flex-1 min-w-0 flex items-center gap-2">
                        <ControlRenderer
                          spec={spec}
                          value={shown}
                          fluid
                          onChange={(v, live) => setAnim(i, { [spec.path]: v }, live)}
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
            const type = e.target.value as AnimationType;
            if (type) {
              const anim: Animation = { type };
              // Exit presets anchor to the element's end — written
              // EXPLICITLY so the document carries the semantics.
              if (familyOf(type) === 'exit') anim.time = 'end';
              commit([...animations, anim]);
              setExpanded(animations.length);
            }
            setAdding(false);
          }}
        >
          <option value="" disabled>
            Add animation…
          </option>
          {FAMILY_ORDER.map((fam) => (
            <optgroup key={fam} label={FAMILY_LABEL[fam]}>
              {ANIMATION_TYPES.filter((t) => familyOf(t) === fam).map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      ) : (
        <button
          type="button"
          className="self-start h-5 px-1.5 rounded text-[10px] text-muted-foreground hover:text-foreground hover:bg-card transition"
          onClick={() => setAdding(true)}
        >
          + Animation
        </button>
      )}
    </div>
  );
}
