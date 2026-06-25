// Volume block (Ian's reference HTML, M/S dropped by ruling — they're
// preview-only and don't map to the document; the mixer rail keeps
// them) — the audio section's `volume` composite: a fluid number well
// in the left half-column, a rotary KNOB in the right (270° sweep,
// drag to scrub on the one-undo-step contract), and live peak meters
// underneath (engine.getAudioLevels() on rAF, painted out-of-band).

'use client';

import { useEffect, useRef } from 'react';
import { useEditorContext } from '@clipkit/editor-core';
import { cn } from '../lib/utils.js';
import { KeyframedChip, NumberControl, type ScrubHandlers } from './primitives.js';

const SWEEP = 270; // degrees of knob travel for 0..VOL_MAX
const VOL_MAX = 200; // unity (100% = 0 dB) is not the ceiling — allow boost
const C = 2 * Math.PI * 13; // arc circumference (r=13 in a 28px dial)

export function VolumeControl({
  elementId,
  value,
  commit,
  trailing,
  ...scrub
}: {
  elementId: string;
  /** The element's `volume` (number %, Keyframe[], or unauthored). */
  value: unknown;
  commit: (patch: Record<string, unknown>, live: boolean) => void;
  /** The ◇ keyframe diamond from the inspector. */
  trailing?: React.ReactNode;
} & ScrubHandlers) {
  const animated = Array.isArray(value);
  const volume = typeof value === 'number' ? value : 100;

  // ── Knob drag (vertical scrub, standard one-undo-step contract) ──
  const dragRef = useRef<{ startY: number; startV: number; scrubbed: boolean } | null>(null);
  const onKnobDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (animated) return;
    dragRef.current = { startY: e.clientY, startV: volume, scrubbed: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onKnobMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const d = dragRef.current;
    if (!d) return;
    const dy = d.startY - e.clientY;
    if (!d.scrubbed && Math.abs(dy) < 3) return;
    if (!d.scrubbed) {
      d.scrubbed = true;
      scrub.onScrubStart?.();
    }
    const next = Math.round(Math.min(VOL_MAX, Math.max(0, d.startV + dy * 0.6)));
    commit({ volume: next }, true);
  };
  const onKnobUp = (): void => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d?.scrubbed) scrub.onScrubEnd?.();
  };

  const angle = -SWEEP / 2 + (volume / VOL_MAX) * SWEEP;
  const dash = (volume / VOL_MAX) * (SWEEP / 360) * C;

  return (
    <>
      <div className="flex items-start gap-2 py-1">
        <span className="w-16 shrink-0 text-[11px] text-muted-foreground pt-1.5 truncate">
          Volume
        </span>
        <div className="flex-1 grid grid-cols-2 gap-2 min-w-0 items-stretch">
          <div className="flex flex-col gap-2 min-w-0">
            {animated ? (
              <div className="flex items-center gap-1 h-6">
                <KeyframedChip />
                {trailing}
              </div>
            ) : (
              <NumberControl
                value={volume}
                min={0}
                max={VOL_MAX}
                step={1}
                suffix="%"
                fluid
                trailing={trailing}
                onChange={(v, live) => commit({ volume: v }, live)}
                {...scrub}
              />
            )}
          </div>
          {/* The knob — 270° sweep, drag vertically to scrub. */}
          <div
            className={cn(
              'relative h-14 bg-field rounded-md min-w-0 select-none touch-none',
              animated ? 'opacity-50' : 'cursor-ns-resize',
            )}
            onPointerDown={onKnobDown}
            onPointerMove={onKnobMove}
            onPointerUp={onKnobUp}
            title={animated ? 'Volume is keyframed' : `Volume ${volume}%`}
            role="slider"
            aria-valuemin={0}
            aria-valuemax={VOL_MAX}
            aria-valuenow={volume}
            aria-label="Volume knob"
          >
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[28px] h-[28px] bg-secondary rounded-full">
              <svg aria-hidden="true" viewBox="0 0 28 28" className="absolute inset-0" style={{ color: 'var(--color-playhead)' }}>
                {/* Track: the full 270° sweep, faint. */}
                <circle
                  cx="14" cy="14" r="13" fill="none"
                  stroke="var(--color-border)" strokeWidth="2"
                  strokeDasharray={`${(SWEEP / 360) * C} ${C}`}
                  transform="rotate(135 14 14)"
                />
                {/* Value arc. */}
                <circle
                  cx="14" cy="14" r="13" fill="none"
                  stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                  strokeDasharray={`${dash} ${C}`}
                  transform="rotate(135 14 14)"
                />
              </svg>
              <div className="absolute inset-[3px] rounded-full bg-secondary" />
            </div>
            {/* Rotating tick. */}
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-9 h-9 pointer-events-none">
              <div className="w-full h-full" style={{ transform: `rotate(${angle}deg)` }}>
                <div className="absolute left-1/2 top-[9px] -translate-x-1/2 w-[2px] h-[7px] rounded-full bg-foreground" />
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* Live peak meters (rAF, out-of-band). */}
      <div className="flex items-center gap-2 h-5">
        <span className="w-16 shrink-0" />
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <MeterBar elementId={elementId} />
          <MeterBar elementId={elementId} lag />
        </div>
      </div>
    </>
  );
}

/** A 2px zoned bar (green→amber→red) with a cover revealing the level. */
function MeterBar({ elementId, lag }: { elementId: string; lag?: boolean }) {
  const { engine } = useEditorContext();
  const coverRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = coverRef.current;
    if (!el || !engine) return;
    let raf = 0;
    let smoothed = 0;
    const paint = (): void => {
      const levels = engine.getAudioLevels();
      const peak = levels.elements[elementId];
      const v = peak ? Math.min(1, Math.max(peak.l, peak.r)) : 0;
      // The second bar trails slightly so the pair reads stereo-ish.
      smoothed = lag ? smoothed * 0.6 + v * 0.4 : v;
      el.style.width = `${Math.round((1 - smoothed) * 100)}%`;
      raf = requestAnimationFrame(paint);
    };
    paint();
    return () => cancelAnimationFrame(raf);
  }, [engine, elementId, lag]);
  return (
    <div className="relative h-[2px] bg-field rounded-sm overflow-hidden">
      <div className="absolute inset-y-0 left-0" style={{ width: '60%', background: 'oklch(0.7 0.17 150)' }} />
      <div className="absolute inset-y-0" style={{ left: '60%', width: '20%', background: 'oklch(0.78 0.16 80)' }} />
      <div className="absolute inset-y-0 right-0" style={{ width: '20%', background: 'var(--color-destructive)' }} />
      <div ref={coverRef} className="absolute inset-y-0 right-0 bg-field" style={{ width: '100%' }} />
    </div>
  );
}
