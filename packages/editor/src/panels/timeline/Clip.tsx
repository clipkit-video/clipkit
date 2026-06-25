// One clip on the timeline — the LEGACY editor's clip design, ported
// verbatim (ruled by Ian 2026-06-11: "use the colors and styles of
// the timeline in the legacy editor… with the handles and all that"),
// extended with the new timeline's behaviors: tinted in-clip
// waveforms, caption word segments, keyframe-lane chevron, context
// menu. Click selects; body drag moves; edge handles resize.
//
// Visual design (from the legacy clip):
// - Per-element-type tinted background + matched border (light/dark
//   variants for each type).
// - Bolder accent border + inner shadow when the clip is selected.
// - A Lucide-style icon on the left in the accent color.
// - Resize handles (two short vertical bars at each end) appear on
//   hover OR when the clip is selected, hidden otherwise.
// - All clips share the same height (full layer-row height); no special
//   tall treatment for video.

'use client';

import type { CSSProperties, MouseEvent, ReactElement } from 'react';
import type { Element } from '@clipkit/protocol';
import { useEditorContext } from '@clipkit/editor-core';
import { elementLabel } from '@clipkit/editor-core';
import { Waveform } from './Waveform.js';

interface Props {
  element: Element;
  visualTimeSec: number;
  visualDurationSec: number;
  pxPerSec: number;
  selected: boolean;
  dragging: boolean;
  valid: boolean;
  locked?: boolean;
  /** Fixed clip height in px — the clip must NOT grow with keyframe
      lanes below it (expansion lives in the layer header). */
  heightPx?: number;
  onMoveMouseDown: (e: MouseEvent<HTMLDivElement>) => void;
  onResizeLeftMouseDown: (e: MouseEvent<HTMLDivElement>) => void;
  onResizeRightMouseDown: (e: MouseEvent<HTMLDivElement>) => void;
  onClick: (e: MouseEvent<HTMLDivElement>) => void;
  onContextMenu?: (e: MouseEvent<HTMLDivElement>) => void;
}

export interface SwatchSet {
  bg: string;
  border: string;
  selectedBorder: string;
  text: string;
}

export const PALETTE: Record<string, { light: SwatchSet; dark: SwatchSet }> = {
  video: {
    light: { bg: '#E3F2FD', border: '#90CAF9', selectedBorder: '#1976D2', text: '#1F2937' },
    dark:  { bg: '#1A2632', border: '#1565C0', selectedBorder: '#42A5F5', text: '#E5E7EB' },
  },
  audio: {
    light: { bg: '#E3F2FD', border: '#90CAF9', selectedBorder: '#1976D2', text: '#1F2937' },
    dark:  { bg: '#1A2632', border: '#1565C0', selectedBorder: '#42A5F5', text: '#E5E7EB' },
  },
  shape: {
    light: { bg: '#F3E5F5', border: '#CE93D8', selectedBorder: '#9C27B0', text: '#1F2937' },
    dark:  { bg: '#2A1F2D', border: '#7B1FA2', selectedBorder: '#BA68C8', text: '#E5E7EB' },
  },
  text: {
    light: { bg: '#FFE0B2', border: '#FFB74D', selectedBorder: '#F57C00', text: '#1F2937' },
    dark:  { bg: '#2D1D0F', border: '#E65100', selectedBorder: '#FFB74D', text: '#E5E7EB' },
  },
  image: {
    light: { bg: '#E8F5E9', border: '#A5D6A7', selectedBorder: '#388E3C', text: '#1F2937' },
    dark:  { bg: '#1B2D1C', border: '#2E7D32', selectedBorder: '#81C784', text: '#E5E7EB' },
  },
  caption: {
    light: { bg: '#FFE0B2', border: '#FFB74D', selectedBorder: '#F57C00', text: '#1F2937' },
    dark:  { bg: '#2D1D0F', border: '#E65100', selectedBorder: '#FFB74D', text: '#E5E7EB' },
  },
  group: {
    light: { bg: '#FFEBEE', border: '#EF9A9A', selectedBorder: '#D32F2F', text: '#1F2937' },
    dark:  { bg: '#2D1A1A', border: '#C62828', selectedBorder: '#EF5350', text: '#E5E7EB' },
  },
  particles: {
    light: { bg: '#F3E5F5', border: '#CE93D8', selectedBorder: '#9C27B0', text: '#1F2937' },
    dark:  { bg: '#2A1F2D', border: '#7B1FA2', selectedBorder: '#BA68C8', text: '#E5E7EB' },
  },
  svg: {
    light: { bg: '#E8F5E9', border: '#A5D6A7', selectedBorder: '#388E3C', text: '#1F2937' },
    dark:  { bg: '#1B2D1C', border: '#2E7D32', selectedBorder: '#81C784', text: '#E5E7EB' },
  },
};
export const FALLBACK_SWATCHES: { light: SwatchSet; dark: SwatchSet } = {
  light: { bg: '#ECEFF1', border: '#B0BEC5', selectedBorder: '#455A64', text: '#1F2937' },
  dark:  { bg: '#222A30', border: '#455A64', selectedBorder: '#90A4AE', text: '#E5E7EB' },
};

const HANDLE_HIT_WIDTH = 14;

export function TimelineClip({
  element,
  visualTimeSec,
  visualDurationSec,
  pxPerSec,
  selected,
  dragging,
  valid,
  locked = false,
  heightPx,
  onMoveMouseDown,
  onResizeLeftMouseDown,
  onResizeRightMouseDown,
  onClick,
  onContextMenu,
}: Props) {
  const { theme } = useEditorContext();
  const swatches = (PALETTE[element.type] ?? FALLBACK_SWATCHES)[theme];

  const widthPx = Math.max(20, visualDurationSec * pxPerSec);
  const leftPx = visualTimeSec * pxPerSec;
  // Hide resize affordances on very narrow clips where there's no
  // room between the two handles to grab the move zone.
  const handlesFit = widthPx > HANDLE_HIT_WIDTH * 2 + 8;

  const style: CSSProperties = {
    left: leftPx,
    width: widthPx,
    height: heightPx,
    background: swatches.bg,
    borderColor: !valid
      ? 'var(--color-destructive)'
      : selected
        ? swatches.selectedBorder
        : swatches.border,
    color: swatches.text,
    opacity: dragging ? 0.7 : locked ? 0.5 : 1,
    pointerEvents: locked ? 'none' : undefined,
    boxShadow: selected
      ? `0 0 0 1px ${swatches.selectedBorder} inset`
      : undefined,
  };

  const mediaUrl =
    (element.type === 'audio' || element.type === 'video') &&
    typeof element.source === 'string'
      ? element.source
      : null;
  const words =
    element.type === 'caption' && Array.isArray(element.words) ? element.words : null;

  return (
    <div
      className={`group absolute top-0.5 ${heightPx === undefined ? 'bottom-0.5' : ''} rounded-md border-2 overflow-hidden select-none flex items-center transition-[filter,opacity] hover:brightness-110`}
      style={style}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      {/* In-clip waveform, tinted with the type accent (subtle). */}
      {mediaUrl && (
        <div className="absolute inset-x-0 bottom-0 top-1/3 z-0 pointer-events-none opacity-70">
          <Waveform
            url={mediaUrl}
            trimStart={
              typeof (element as { trim_start?: unknown }).trim_start === 'number'
                ? (element as { trim_start: number }).trim_start
                : 0
            }
            mediaWindow={visualDurationSec}
            color={hexWithAlpha(swatches.selectedBorder, 0.5)}
          />
        </div>
      )}
      {/* Caption word segments along the bottom edge. */}
      {words && (
        <div className="absolute inset-x-1 bottom-[3px] h-[5px] z-0 pointer-events-none">
          {words.map((w, wi) => (
            <span
              key={wi}
              className="absolute top-0 h-full rounded-[1.5px]"
              style={{
                left: `${(w.start / Math.max(visualDurationSec, 0.001)) * 100}%`,
                width: `${Math.max(0.5, ((w.end - w.start) / Math.max(visualDurationSec, 0.001)) * 100 - 0.4)}%`,
                background: hexWithAlpha(swatches.selectedBorder, 0.55),
              }}
            />
          ))}
        </div>
      )}
      {/* Move zone (the whole clip body). Sits under the handle hit
          areas so the corners feel resize-y while the middle drags. */}
      <div
        className="absolute inset-0 z-0"
        style={{ cursor: dragging ? 'grabbing' : 'grab' }}
        onMouseDown={(e) => {
          e.stopPropagation();
          onMoveMouseDown(e);
        }}
      />

      {/* Visible content row — sits above the move zone, ignores
          pointer events so it doesn't intercept drag/click.
          Symmetric pl/pr-4 leaves a few px between the icon and the
          resize-handle bars (which live at the clip's edges). */}
      <div className="relative z-10 flex items-center gap-2 px-4 pointer-events-none w-full">
        <span
          className="shrink-0 inline-flex"
          style={{ color: swatches.selectedBorder }}
          aria-hidden
        >
          {iconForType(element.type)}
        </span>
        <span
          className="truncate text-[10.5px] font-mono tracking-tight"
          style={{ color: swatches.text }}
        >
          {elementLabel(element)}
        </span>
      </div>

      {/* Resize handles — visible on hover OR when selected. Hidden
          on narrow clips where they'd cover the entire body. */}
      {handlesFit && (
        <>
          <ResizeHandle
            side="left"
            accent={swatches.selectedBorder}
            visible={selected}
            onMouseDown={(e) => {
              e.stopPropagation();
              onResizeLeftMouseDown(e);
            }}
          />
          <ResizeHandle
            side="right"
            accent={swatches.selectedBorder}
            visible={selected}
            onMouseDown={(e) => {
              e.stopPropagation();
              onResizeRightMouseDown(e);
            }}
          />
        </>
      )}
    </div>
  );
}

interface ResizeHandleProps {
  side: 'left' | 'right';
  accent: string;
  visible: boolean;
  onMouseDown: (e: MouseEvent<HTMLDivElement>) => void;
}

function ResizeHandle({ side, accent, visible, onMouseDown }: ResizeHandleProps) {
  // The hit area is a 14px column at the edge with ew-resize. Inside
  // it sits two thin vertical bars in the accent color. Bars fade in
  // on hover (group-hover) and are pinned visible when the clip is
  // selected.
  return (
    <div
      className="absolute top-0 bottom-0 z-20"
      style={{
        [side]: 0,
        width: HANDLE_HIT_WIDTH,
        cursor: 'ew-resize',
      }}
      onMouseDown={onMouseDown}
    >
      <div
        className={`absolute top-1/2 -translate-y-1/2 flex gap-[2px] transition-opacity ${
          visible ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        }`}
        style={{ [side]: 4, height: 12 }}
      >
        <div style={{ width: 2, height: '100%', background: accent, borderRadius: 1 }} />
        <div style={{ width: 2, height: '100%', background: accent, borderRadius: 1 }} />
      </div>
    </div>
  );
}

// ── Type icons — small inline SVGs matching the Dock's style ──────

function iconForType(type: Element['type']): ReactElement {
  switch (type) {
    case 'video':       return <VideoIcon />;
    case 'audio':       return <AudioIcon />;
    case 'text':        return <TextIcon />;
    case 'shape':       return <ShapeIcon />;
    case 'image':       return <ImageIcon />;
    case 'caption':     return <CaptionIcon />;
    case 'group':       return <LayersIcon />;
    default:            return <TextIcon />;
  }
}

const ICON_PROPS = {
  width: 14,
  height: 14,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

function VideoIcon() {
  return (
    <svg {...ICON_PROPS}>
      <rect x="2" y="4" width="9" height="8" rx="1.5" />
      <path d="M11 6 L14 4 V12 L11 10 Z" />
    </svg>
  );
}
function AudioIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M3 7 V9 M5.5 5 V11 M8 3 V13 M10.5 5 V11 M13 7 V9" />
    </svg>
  );
}
function TextIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M3 4 H13 M8 4 V13" />
    </svg>
  );
}
function ShapeIcon() {
  return (
    <svg {...ICON_PROPS}>
      <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
    </svg>
  );
}
function ImageIcon() {
  return (
    <svg {...ICON_PROPS}>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <circle cx="6" cy="6.5" r="1.2" fill="currentColor" stroke="none" />
      <path d="M2.5 11.5 L6 8 L9 11 L11.5 9 L13.5 11" />
    </svg>
  );
}
function CaptionIcon() {
  return (
    <svg {...ICON_PROPS}>
      <rect x="2" y="3.5" width="12" height="9" rx="1.5" />
      <path d="M4.5 8.5 H7 M9 8.5 H11.5 M4.5 10.5 H6 M8 10.5 H11.5" />
    </svg>
  );
}
function LayersIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M8 2 L14 5 L8 8 L2 5 Z" />
      <path d="M2 8 L8 11 L14 8" />
      <path d="M2 11 L8 14 L14 11" />
    </svg>
  );
}

/** '#RRGGBB' + alpha → rgba() (the palette accents are hex). */
function hexWithAlpha(hex: string, alpha: number): string {
  const m = hex.match(/^#([0-9a-fA-F]{6})$/);
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
