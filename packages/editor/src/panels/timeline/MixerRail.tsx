// Mixer dock (EDITORS B6, re-ruled by Ian) — docked RIGHT of the timeline at
// timeline height. Collapsed = a thin Master meter; clicking Master expands
// the per-LAYER channel strips. Each strip is a pro-style channel: a dB volume
// FADER, a shared dB scale, and a STEREO (L/R) level meter — three separate
// things, never the old merged bar. Expanded width is drag-resizable from the
// left edge so the mixer can grow to overtake the timeline.
//
// The lens rule, enforced: VOLUME edits the document (element.volume via
// updateElement); MUTE/SOLO are preview-only (per-element gains pushed to the
// engine, never serialized). The dB readout/scale are display-only — volume is
// still stored as the linear 0..100(+) value, so nothing here touches the
// protocol. Meters poll engine.getAudioLevels() on rAF, painted out-of-band
// (no React re-render per frame).

'use client';

import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import type { Element } from '@clipkit/protocol';
import { useEditor, useEditorContext, useEditorStore } from '@clipkit/editor-core';
import { cn } from '../../lib/utils.js';

const COLLAPSED_W = 40;
const STRIP_W = 88;

// dB scale shared by the fader and the meter. 0 dB = unity (volume 100); the
// top is +12 dB (~400%, Ian's call); the very bottom is -∞ (silence). FLOOR_DB
// is the position the -∞ end maps to — peaks/volumes below it sit at the bottom.
const TOP_DB = 12;
const FLOOR_DB = -48;
const DB_RANGE = TOP_DB - FLOOR_DB;
// Labelled gridlines (no '+' on the scale; the readout up top carries the sign).
const SCALE_TICKS = [12, 6, 0, -6, -12, -18, -24, -30, -36];
// Fader ruler ticks every 3 dB; the SCALE_TICKS ones are drawn longer.
const FADER_TICKS = (() => {
  const out: number[] = [];
  for (let d = TOP_DB; d >= -36; d -= 3) out.push(d);
  return out;
})();
// Meter colour zones, in dB: green ≤ -6, amber -6..0, red > 0 (over 0 dBFS).
const AMBER_DB = -6;
const RED_DB = 0;
// Peak-hold cap fall per frame, as a fraction of bar height (~slow decay).
const PEAK_DECAY = 0.004;

const GREEN = 'oklch(0.7 0.17 150)';
const AMBER = 'oklch(0.78 0.16 80)';

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
/** Fraction up the bar (0 = bottom, 1 = top) for a dB value. */
const fracFromDb = (db: number): number => clamp01((db - FLOOR_DB) / DB_RANGE);
/** dB for a linear peak amplitude (0 → -∞). */
const dbFromPeak = (p: number): number => (p > 0 ? 20 * Math.log10(p) : -Infinity);
/** Volume % → dB (0 dB = unity = 100%). */
const dbFromVol = (vol: number): number => (vol > 0 ? 20 * Math.log10(vol / 100) : -Infinity);
/** dB → volume %. */
const volFromDb = (db: number): number => 100 * Math.pow(10, db / 20);
/** Max volume the fader reaches (+12 dB ≈ 398%). */
const MAX_VOL = Math.round(volFromDb(TOP_DB));

/** Format a volume as a dB readout: "+3 dB", "-5 dB", "0 dB", "-∞". */
function fmtDb(vol: number): string {
  if (vol <= 0) return '-∞';
  const db = Math.round(dbFromVol(vol));
  return db > 0 ? `+${db} dB` : `${db} dB`;
}

/** All audio/video clips sharing one `layer` integer — one mixer strip each. */
interface LayerGroup {
  layer: number;
  els: (Element & { volume?: number })[];
  ids: string[];
}

export function MixerRail({
  open,
  onToggle,
}: {
  /** Collapsed = just the Master meter. Owned by TimelinePanel so the
      transport's fader button and the Master strip stay in sync. */
  open: boolean;
  onToggle: () => void;
}) {
  const { engine } = useEditorContext();
  const actions = useEditor();
  const source = useEditorStore((s) => s.source);

  // Preview-only state (never serialized — the lens rule).
  const mutedArr = useEditorStore((s) => s.ui.audioMuted);
  const soloArr = useEditorStore((s) => s.ui.audioSolo);
  const muted = useMemo(() => new Set(mutedArr), [mutedArr]);
  const solo = useMemo(() => new Set(soloArr), [soloArr]);
  const setMuted = (next: ReadonlySet<string>): void =>
    actions.setUiState({ audioMuted: [...next] });
  const setSolo = (next: ReadonlySet<string>): void =>
    actions.setUiState({ audioSolo: [...next] });

  const audioEls = useMemo(
    () =>
      source.elements.filter(
        (el): el is Element & { volume?: number } =>
          (el.type === 'audio' || el.type === 'video') && !!el.id,
      ),
    [source],
  );

  // One strip per LAYER (like a pro mixer), grouped by the `layer` integer —
  // not one strip per clip. A layer's M/S govern every clip on it; the meter
  // shows the loudest member. Layer volume binds to the clip when a layer has
  // exactly one (the common case); multi-clip layers edit volume per clip in
  // the inspector (no layer-gain concept — that would need the protocol).
  const layerGroups = useMemo(() => {
    const byLayer = new Map<number, LayerGroup>();
    for (const el of audioEls) {
      const layer = typeof el.layer === 'number' ? el.layer : 0;
      let g = byLayer.get(layer);
      if (!g) {
        g = { layer, els: [], ids: [] };
        byLayer.set(layer, g);
      }
      g.els.push(el);
      g.ids.push(el.id!);
    }
    return [...byLayer.values()].sort((a, b) => a.layer - b.layer);
  }, [audioEls]);

  // Effective preview gains: any solo ⇒ everything non-solo is silent;
  // mute always silences. Pushed to the engine whenever state changes.
  useEffect(() => {
    if (!engine) return;
    const gains: Record<string, number> = {};
    const soloing = solo.size > 0;
    for (const el of audioEls) {
      const id = el.id!;
      gains[id] = muted.has(id) || (soloing && !solo.has(id)) ? 0 : 1;
    }
    engine.setPreviewGains(gains);
  }, [engine, audioEls, muted, solo]);

  // Expanded width is drag-resizable (editor-only, lens rule). Null = the
  // natural width (all strips + master, capped so it doesn't auto-overtake).
  const [widthOverride, setWidthOverride] = useState<number | null>(null);
  const naturalW = (layerGroups.length + 1) * STRIP_W;
  const expandedW = widthOverride ?? Math.min(naturalW, STRIP_W * 4.5);

  const beginResize = (e: ReactMouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = expandedW;
    const onMove = (ev: MouseEvent): void => {
      // Handle is on the LEFT edge; dragging left grows the rail.
      const next = Math.max(STRIP_W, Math.min(1400, startW + (startX - ev.clientX)));
      setWidthOverride(next);
    };
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const noAudio = audioEls.length === 0;

  return (
    <div
      className="relative shrink-0 border-l border-border bg-background flex"
      style={{ width: open ? expandedW : COLLAPSED_W }}
    >
      {/* Left-edge resize handle (expanded only) — drag to overtake the timeline. */}
      {open && (
        <div
          className="absolute left-0 top-0 bottom-0 w-1.5 -ml-0.5 z-20 cursor-col-resize hover:bg-border/80 transition-colors"
          onMouseDown={beginResize}
          title="Drag to resize the mixer"
        />
      )}

      <div className="flex-1 flex overflow-x-auto overflow-y-hidden">
        {open &&
          layerGroups.map((g) => {
            // Layer M/S act on every clip on the layer. The layer is "on" when
            // all its clips are — single-clip layers are 1:1, so this reuses
            // the per-element preview-gain effect unchanged.
            const single = g.els.length === 1 ? g.els[0]! : null;
            const isMuted = g.ids.every((id) => muted.has(id));
            const isSolo = g.ids.every((id) => solo.has(id));
            const silenced = isMuted || (solo.size > 0 && !isSolo);
            const vol = single && typeof single.volume === 'number' ? single.volume : 100;
            return (
              <div
                key={g.layer}
                className="flex flex-col items-stretch gap-1.5 px-2 pt-2 pb-2 border-r border-border/40 shrink-0"
                style={{ width: STRIP_W }}
              >
                {/* Top: dB readout, then Mute/Solo. */}
                <div className="flex flex-col gap-1">
                  <span
                    className="text-center text-[10px] font-mono tabular-nums rounded bg-field/70 px-1 py-0.5 text-foreground/85 truncate"
                    title={single ? 'Volume (dB)' : `${g.els.length} clips`}
                  >
                    {single ? fmtDb(vol) : `${g.els.length}×`}
                  </span>
                  <div className="flex items-center justify-center gap-1">
                    <MixButton
                      label="Mute layer (preview-only)"
                      active={isMuted}
                      tone="mute"
                      onClick={() => setMuted(toggleAll(muted, g.ids, isMuted))}
                    >
                      M
                    </MixButton>
                    <MixButton
                      label="Solo layer (preview-only)"
                      active={isSolo}
                      tone="solo"
                      onClick={() => setSolo(toggleAll(solo, g.ids, isSolo))}
                    >
                      S
                    </MixButton>
                  </div>
                </div>

                {/* Middle: fader · shared dB scale · stereo meter. */}
                <div
                  className={cn(
                    'flex-1 flex items-stretch justify-center gap-1 min-h-20 mt-3',
                    silenced && 'opacity-50',
                  )}
                >
                  <Fader
                    value={vol}
                    disabled={!single}
                    onChange={
                      single
                        ? (v, live) => {
                            if (live) {
                              actions.moveElements(
                                [{ id: single.id!, patch: { volume: v } }],
                                { skipHistory: true },
                              );
                            } else {
                              actions.updateElement(single.id!, { volume: v } as Partial<Element>);
                            }
                          }
                        : undefined
                    }
                    onScrubStart={() => {
                      actions.pushHistory();
                      actions.setInteractive(true);
                    }}
                    onScrubEnd={() => {
                      actions.flushPendingSource();
                      actions.setInteractive(false);
                    }}
                  />
                  <ScaleLabels />
                  <StereoMeter ids={g.ids} />
                </div>

                {/* Bottom: layer name. */}
                <span
                  className="text-[9px] font-mono text-muted-foreground truncate text-center"
                  title={single ? single.id! : `Layer ${g.layer} · ${g.els.length} clips`}
                >
                  {single ? (single.name ?? single.id!) : `Layer ${g.layer}`}
                </span>
              </div>
            );
          })}

        {/* Master strip — meter only (no master gain in the protocol). The
            WHOLE strip toggles the rail. */}
        <button
          type="button"
          disabled={noAudio}
          onClick={onToggle}
          aria-expanded={open}
          aria-label={open ? 'Collapse mixer' : 'Expand mixer'}
          title={
            noAudio
              ? 'No audio in this composition'
              : open
                ? 'Collapse mixer'
                : `Expand mixer (${layerGroups.length} ${layerGroups.length === 1 ? 'layer' : 'layers'})`
          }
          className={cn(
            'group flex flex-col items-stretch gap-1.5 px-2 pt-2 pb-2 shrink-0 transition-colors',
            !noAudio && 'hover:bg-card/60 cursor-pointer',
            noAudio && 'opacity-40 cursor-default',
          )}
          style={{ width: open ? STRIP_W : COLLAPSED_W }}
        >
          <span
            className={cn(
              'font-mono text-muted-foreground group-hover:text-foreground transition-colors text-center',
              open ? 'text-[10px]' : 'text-[8px]',
            )}
          >
            {open ? 'Master' : 'MIX'}
          </span>
          <div className="flex-1 flex items-stretch justify-center gap-1 min-h-20 mt-3">
            {open && <ScaleLabels />}
            <StereoMeter ids="master" />
          </div>
          {open && layerGroups.length > 0 && (
            <span className="text-[8px] text-muted-foreground/60 tabular-nums text-center">
              {layerGroups.length}
            </span>
          )}
        </button>
      </div>
    </div>
  );
}

/** Flip a whole layer's clip ids on or off in the mute/solo set at once. */
function toggleAll(
  prev: ReadonlySet<string>,
  ids: string[],
  allOn: boolean,
): ReadonlySet<string> {
  const next = new Set(prev);
  for (const id of ids) {
    if (allOn) next.delete(id);
    else next.add(id);
  }
  return next;
}

/** Right-aligned dB gridline labels, positioned by dB. Shared between the
 *  fader (left) and the meter (right). */
function ScaleLabels() {
  return (
    <div className="relative w-6 shrink-0 select-none">
      {SCALE_TICKS.map((t) => (
        <span
          key={t}
          className="absolute right-0 text-[9px] font-mono leading-none tabular-nums text-muted-foreground/70"
          style={{ top: `${(1 - fracFromDb(t)) * 100}%`, transform: 'translateY(-50%)' }}
        >
          {t}
        </span>
      ))}
      <span className="absolute right-0 bottom-0 text-[9px] font-mono leading-none text-muted-foreground/40">
        -∞
      </span>
    </div>
  );
}

/**
 * Vertical dB volume fader: a dashed ruler with a white thumb. Position maps
 * through dB (0 dB = unity), so the throw matches the meter beside it. The
 * stored value stays linear %. Double-click resets to unity. Disabled (no
 * thumb, no drag) for multi-clip layers.
 */
function Fader({
  value,
  disabled = false,
  onChange,
  onScrubStart,
  onScrubEnd,
}: {
  value: number;
  disabled?: boolean;
  onChange?: (v: number, live: boolean) => void;
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const frac = value > 0 ? fracFromDb(dbFromVol(value)) : 0;

  const begin = (e: ReactMouseEvent): void => {
    if (disabled || !onChange) return;
    const apply = onChange; // captured so the closures keep the narrowed type
    e.preventDefault();
    e.stopPropagation();
    const track = trackRef.current;
    if (!track) return;
    onScrubStart?.();
    const rect = track.getBoundingClientRect();
    const setFromY = (clientY: number): void => {
      const f = clamp01(1 - (clientY - rect.top) / rect.height); // 0 bottom .. 1 top
      const vol = f <= 0.003 ? 0 : Math.min(MAX_VOL, Math.round(volFromDb(FLOOR_DB + f * DB_RANGE)));
      apply(vol, true);
    };
    setFromY(e.clientY);
    const onMove = (ev: MouseEvent): void => setFromY(ev.clientY);
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      onScrubEnd?.();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const resetUnity = (): void => {
    if (disabled || !onChange) return;
    onScrubStart?.();
    onChange(100, false);
    onScrubEnd?.();
  };

  return (
    <div
      ref={trackRef}
      onMouseDown={begin}
      onDoubleClick={resetUnity}
      className={cn('relative w-4 shrink-0', disabled ? 'cursor-default' : 'cursor-ns-resize')}
      title={
        disabled
          ? 'Multiple clips on this layer — set volume per clip in the inspector'
          : `${fmtDb(value)} — drag · double-click for unity`
      }
    >
      {/* Dashed ruler; SCALE_TICKS dB marks are drawn full-width, the rest short. */}
      {FADER_TICKS.map((t) => (
        <div
          key={t}
          className={cn(
            'absolute left-0 h-px pointer-events-none',
            SCALE_TICKS.includes(t) ? 'bg-muted-foreground/75' : 'bg-muted-foreground/35',
          )}
          style={{ top: `${(1 - fracFromDb(t)) * 100}%`, width: SCALE_TICKS.includes(t) ? '100%' : '55%' }}
        />
      ))}
      {/* White thumb — the volume setting. */}
      {!disabled && (
        <div
          className="absolute inset-x-0 h-2 rounded-[2px] bg-foreground shadow-sm pointer-events-none"
          style={{ top: `${(1 - frac) * 100}%`, transform: 'translateY(-50%)' }}
        />
      )}
    </div>
  );
}

/**
 * Stereo (L/R) peak meter. `ids` = a layer's clip ids (max wins, the layer
 * sum) or 'master' for the master bus. Each bar shows fixed green/amber/red
 * zones revealed up to the live level, plus a falling peak-hold cap. Painted
 * out-of-band on rAF (no React re-render per frame).
 */
function StereoMeter({ ids }: { ids: string[] | 'master' }) {
  const { engine } = useEditorContext();
  const lCover = useRef<HTMLDivElement>(null);
  const rCover = useRef<HTMLDivElement>(null);
  const lCap = useRef<HTMLDivElement>(null);
  const rCap = useRef<HTMLDivElement>(null);
  const key = ids === 'master' ? 'master' : ids.join(',');

  useEffect(() => {
    if (!engine) return;
    let raf = 0;
    let lHold = 0;
    let rHold = 0;
    const idList = ids === 'master' ? null : key ? key.split(',') : [];
    const apply = (
      cover: HTMLDivElement | null,
      cap: HTMLDivElement | null,
      peak: number,
      hold: number,
    ): number => {
      const lf = fracFromDb(dbFromPeak(peak));
      if (cover) cover.style.height = `${(1 - lf) * 100}%`;
      const next = Math.max(lf, hold - PEAK_DECAY);
      if (cap) {
        cap.style.bottom = `${next * 100}%`;
        cap.style.opacity = next > 0.02 ? '1' : '0';
      }
      return next;
    };
    const paint = (): void => {
      const levels = engine.getAudioLevels();
      let l = 0;
      let r = 0;
      if (idList === null) {
        l = levels.master.l;
        r = levels.master.r;
      } else {
        for (const id of idList) {
          const p = levels.elements[id];
          if (p) {
            if (p.l > l) l = p.l;
            if (p.r > r) r = p.r;
          }
        }
      }
      lHold = apply(lCover.current, lCap.current, l, lHold);
      rHold = apply(rCover.current, rCap.current, r, rHold);
      raf = requestAnimationFrame(paint);
    };
    paint();
    return () => cancelAnimationFrame(raf);
  }, [engine, key]);

  return (
    <div className="flex items-stretch gap-px shrink-0">
      <MeterBar coverRef={lCover} capRef={lCap} />
      <MeterBar coverRef={rCover} capRef={rCap} />
    </div>
  );
}

/** One meter channel: fixed colour zones + a cover that hides everything above
 *  the live level + a peak-hold cap. The refs are driven by StereoMeter's rAF. */
function MeterBar({
  coverRef,
  capRef,
}: {
  coverRef: React.Ref<HTMLDivElement>;
  capRef: React.Ref<HTMLDivElement>;
}) {
  const amber = fracFromDb(AMBER_DB);
  const red = fracFromDb(RED_DB);
  return (
    <div className="relative w-[5px] min-h-20 rounded-[1px] overflow-hidden bg-field border border-border/50">
      {/* Fixed zones: green ≤ -6 dB, amber -6..0, red > 0. */}
      <div className="absolute bottom-0 inset-x-0" style={{ height: `${amber * 100}%`, background: GREEN }} />
      <div className="absolute inset-x-0" style={{ bottom: `${amber * 100}%`, height: `${(red - amber) * 100}%`, background: AMBER }} />
      <div className="absolute top-0 inset-x-0" style={{ height: `${(1 - red) * 100}%`, background: 'var(--color-destructive)' }} />
      {/* Cover hides the zones above the current level. */}
      <div ref={coverRef} className="absolute top-0 inset-x-0 bg-field" style={{ height: '100%' }} />
      {/* Peak-hold cap. */}
      <div ref={capRef} className="absolute inset-x-0 h-px bg-foreground" style={{ bottom: '0%', opacity: 0 }} />
    </div>
  );
}

function MixButton({
  label,
  active,
  tone,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  /** Mute lights amber, Solo lights blue — distinct so the state reads fast. */
  tone: 'mute' | 'solo';
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={cn(
        'w-6 h-5 grid place-items-center rounded text-[10px] font-bold transition shrink-0 border',
        active
          ? tone === 'mute'
            ? 'border-transparent text-black'
            : 'border-transparent bg-primary text-primary-foreground'
          : 'border-border bg-foreground/10 text-foreground/70 hover:bg-foreground/25 hover:text-foreground',
      )}
      style={active && tone === 'mute' ? { background: AMBER } : undefined}
      title={label}
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
