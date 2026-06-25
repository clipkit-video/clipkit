// Timeline panel — transport row (play/pause, frame stepping via
// engine.stepFrame, loop, timecode readout, zoom) over the canvas
// timeline (layer headers, snap-true move/trim, waveforms, keyframe
// lanes; virtualized for huge layer counts). The mixer rail attaches
// alongside.

'use client';

import { useEffect, useRef, useState } from 'react';
import type { Source } from '@clipkit/protocol';
import {
  computeSourceDuration,
  formatTimecode,
  useEditor,
  useEditorContext,
  useEditorStore,
} from '@clipkit/editor-core';
import { cn } from '../lib/utils.js';
import { ZoomControl } from '../frame/ZoomControl.js';
import { CanvasTimeline } from './timeline/CanvasTimeline.js';
import { HEADER_W } from './timeline/timeline-layout.js';
import { MixerRail } from './timeline/MixerRail.js';
import { useConfiguration } from '../configuration.js';
import { ExportDialog } from '../ExportDialog.js';
import type { ExportFormatOption, ExportRequest } from '../types.js';

const SCALE_STEP = 1.4;

const DEFAULT_EXPORT_FORMATS: ExportFormatOption[] = [{ id: 'mp4', label: 'MP4' }];

export function TimelinePanel({
  onRender,
  exportFormats,
  rendering = false,
  renderProgress,
}: {
  /** Render handler — fired with the Source + the export-dialog choice. */
  onRender?: (source: Source, request: ExportRequest) => void;
  /** Formats the export dialog offers; defaults to MP4 only (free in-browser). */
  exportFormats?: ExportFormatOption[];
  rendering?: boolean;
  renderProgress?: number;
}) {
  const { engine } = useEditorContext();
  const { configuration } = useConfiguration();
  const { togglePlay, setUiState, undo, redo, canUndo, canRedo } = useEditor();
  const playing = useEditorStore((s) => s.playback.playing);
  const ready = useEditorStore((s) => s.playback.ready);
  const loop = useEditorStore((s) => s.ui.loop);
  const source = useEditorStore((s) => s.source);
  const pastLen = useEditorStore((s) => s.history.past.length);
  const futureLen = useEditorStore((s) => s.history.future.length);

  // Zoom + mixer expansion are editor state (lens rule) — never
  // serialized. The mixer's open state lives here so the transport's
  // fader button and the Master strip's chevron stay one control.
  const [pxPerSec, setPxPerSec] = useState(100);
  const [mixerOpen, setMixerOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const exportFormatList = exportFormats?.length ? exportFormats : DEFAULT_EXPORT_FORMATS;
  const setScale = (next: number): void =>
    setPxPerSec(Math.max(10, Math.min(800, next)));

  const audioCount = source.elements.filter(
    (el) => (el.type === 'audio' || el.type === 'video') && !!el.id,
  ).length;

  const duration = computeSourceDuration(source);

  // Fit-to-width (the legacy timeline's fit, same control as the
  // stage's): scale so the whole composition spans the scroll
  // viewport, minus the header column and a breathing margin.
  const scrollRef = useRef<HTMLDivElement>(null);
  const fitTimeline = (): void => {
    const scroll = scrollRef.current;
    if (!scroll || duration <= 0) return;
    const available = scroll.clientWidth - HEADER_W - 64;
    if (available <= 0) return;
    setScale(available / duration);
  };

  // Auto-fit on load: once the scroll viewport has a width (it can be 0
  // on the first paint before layout settles), scale so the whole source
  // fits. Runs ONCE per mount — a fresh source remounts the editor, so a
  // new clip refits; adding to the current one doesn't yank the zoom.
  const didFitRef = useRef(false);
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll || didFitRef.current) return;
    const fit = (): void => {
      if (didFitRef.current || duration <= 0) return;
      const available = scroll.clientWidth - HEADER_W - 64;
      if (available <= 0) return;
      setPxPerSec(Math.max(10, Math.min(800, available / duration)));
      didFitRef.current = true;
      ro.disconnect();
    };
    const ro = new ResizeObserver(fit);
    ro.observe(scroll);
    fit();
    return () => ro.disconnect();
  }, [duration]);

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Transport row. */}
      <div className="flex items-center gap-1 h-9 px-2 border-b border-border shrink-0">
        <TransportButton
          label="Previous frame"
          disabled={!ready}
          onClick={() => engine?.stepFrame(-1)}
        >
          <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true">
            <rect x="2" y="3" width="1.5" height="8" rx="0.5" fill="currentColor" />
            <path d="M12 3 L5 7 L12 11 Z" fill="currentColor" />
          </svg>
        </TransportButton>
        <button
          type="button"
          className="w-7 h-7 grid place-items-center bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-40 transition"
          disabled={!ready}
          onClick={() => void togglePlay()}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? (
            <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
              <rect x="3" y="2" width="2.5" height="8" rx="0.5" fill="currentColor" />
              <rect x="6.5" y="2" width="2.5" height="8" rx="0.5" fill="currentColor" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M3 2 L10 6 L3 10 Z" fill="currentColor" />
            </svg>
          )}
        </button>
        <TransportButton
          label="Next frame"
          disabled={!ready}
          onClick={() => engine?.stepFrame(1)}
        >
          <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M2 3 L9 7 L2 11 Z" fill="currentColor" />
            <rect x="10.5" y="3" width="1.5" height="8" rx="0.5" fill="currentColor" />
          </svg>
        </TransportButton>
        <TransportButton
          label="Toggle loop"
          active={loop}
          onClick={() => setUiState({ loop: !loop })}
        >
          <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true">
            <path
              d="M3 5 a4 4 0 0 1 7 -1 M11 9 a4 4 0 0 1 -7 1 M10 2 V5 H7 M4 12 V9 H7"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        </TransportButton>
        <span className="w-px h-3.5 bg-border mx-1" aria-hidden />
        <TransportButton
          label="Undo (⌘Z)"
          disabled={!(pastLen > 0 && canUndo())}
          onClick={() => undo()}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M3.5 7 L6 4.5 M3.5 7 L6 9.5 M3.5 7 H10 a3 3 0 0 1 3 3 v0.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </TransportButton>
        <TransportButton
          label="Redo (⇧⌘Z)"
          disabled={!(futureLen > 0 && canRedo())}
          onClick={() => redo()}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M12.5 7 L10 4.5 M12.5 7 L10 9.5 M12.5 7 H6 a3 3 0 0 0 -3 3 v0.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </TransportButton>
        <TimeReadout extent={duration} />
        <span className="flex-1" />
        {/* Zoom cluster — the shared flat control (same as the stage
            corner): − / readout (click = fit) / + / fit. */}
        <ZoomControl
          readout={`${Math.round(pxPerSec)}px/s`}
          onZoomOut={() => setScale(pxPerSec / SCALE_STEP)}
          onZoomIn={() => setScale(pxPerSec * SCALE_STEP)}
          onFit={fitTimeline}
          fitLabel="Fit timeline to width"
        />
        {/* Mixer (sound) toggle. */}
        {configuration.views.mixer && (
          <>
            <span className="w-px h-3 bg-border mx-1" aria-hidden />
            <button
              type="button"
              className={cn(
                'w-6 h-6 grid place-items-center rounded-sm transition-colors disabled:opacity-30',
                mixerOpen
                  ? 'text-foreground bg-secondary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary',
              )}
              disabled={audioCount === 0}
              onClick={() => setMixerOpen((v) => !v)}
              title={
                audioCount === 0
                  ? 'No audio in this composition'
                  : mixerOpen
                    ? 'Collapse mixer'
                    : 'Expand mixer'
              }
              aria-pressed={mixerOpen}
              aria-label="Toggle mixer"
            >
              <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true">
                <path
                  d="M3 2 V12 M7 2 V12 M11 2 V12"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                />
                <rect x="1.8" y="8" width="2.4" height="1.8" rx="0.5" fill="currentColor" />
                <rect x="5.8" y="4" width="2.4" height="1.8" rx="0.5" fill="currentColor" />
                <rect x="9.8" y="6.5" width="2.4" height="1.8" rx="0.5" fill="currentColor" />
              </svg>
            </button>
          </>
        )}
        {onRender && (
          <>
            <span className="w-px h-3.5 bg-border mx-1" aria-hidden />
            {rendering && (
              <span className="text-[10px] text-muted-foreground tabular-nums mr-1">
                {typeof renderProgress === 'number'
                  ? `${Math.round(renderProgress * 100)}%`
                  : 'rendering…'}
              </span>
            )}
            <button
              type="button"
              className="h-6 px-2.5 rounded bg-primary text-primary-foreground text-[11px] font-medium hover:bg-primary/90 disabled:opacity-40 transition"
              disabled={rendering}
              onClick={() => setExportOpen(true)}
              title={rendering ? 'Render in progress' : 'Export this source'}
            >
              {rendering ? 'Rendering…' : 'Export'}
            </button>
            <ExportDialog
              open={exportOpen}
              formats={exportFormatList}
              onClose={() => setExportOpen(false)}
              onConfirm={(request) => {
                setExportOpen(false);
                onRender(source, request);
              }}
            />
          </>
        )}
      </div>

      <div className="flex flex-1 min-h-0">
        <CanvasTimeline pxPerSec={pxPerSec} scrollRef={scrollRef} onScale={setScale} />
        {configuration.views.mixer && (
          <MixerRail open={mixerOpen} onToggle={() => setMixerOpen((v) => !v)} />
        )}
      </div>
    </div>
  );
}

function TransportButton({
  label,
  onClick,
  disabled,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={cn(
        'w-7 h-7 grid place-items-center rounded transition disabled:opacity-40',
        active
          ? 'text-foreground ring-1 ring-border bg-background'
          : 'text-muted-foreground hover:text-foreground hover:bg-card',
      )}
      disabled={disabled}
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      {children}
    </button>
  );
}

function TimeReadout({ extent }: { extent: number }) {
  const time = useEditorStore((s) => s.playback.time);
  return (
    <span className="ml-2 font-mono text-[11px] text-muted-foreground tabular-nums whitespace-nowrap">
      {formatTimecode(time, extent)}
      <span className="text-muted-foreground/60"> / {formatTimecode(extent)}</span>
    </span>
  );
}
