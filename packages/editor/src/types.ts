// Public types for @clipkit/editor (the configurable editor shell).

import type { Source } from '@clipkit/protocol';
import type { AssetStore, EditorConfiguration } from '@clipkit/editor-core';

/** A render resolution the export dialog offers. Free in-browser — WebCodecs
 *  upscales the canvas; no backend needed. */
export type ExportResolution = 'source' | '720p' | '1080p' | '1440p' | '4k';

/** Export quality tier — maps to encoder bitrate. */
export type ExportQuality = 'standard' | 'high';

/**
 * A format the export dialog offers. The editor renders these GENERICALLY — it
 * has no knowledge of codecs or how any format is produced. The default is just
 * `[{ id: 'mp4', label: 'MP4' }]` (the free in-browser path). Consumers inject
 * additional formats (ProRes, AV1, transparent, …) and handle them in
 * `onRender`; the chosen `id` is echoed back there. Same pattern as `assetStore`.
 */
export interface ExportFormatOption {
  /** Stable id echoed back in `onRender`'s request (e.g. 'mp4', 'prores'). */
  id: string;
  /** Display label, e.g. 'MP4 (H.264)' or 'ProRes 4444'. */
  label: string;
  /** Optional cosmetic badge shown by the label, e.g. 'uses credits'. */
  badge?: string;
}

/** What the user chose in the export dialog, passed to `onRender`. */
export interface ExportRequest {
  /** The chosen `ExportFormatOption.id`. */
  format: string;
  resolution: ExportResolution;
  quality: ExportQuality;
}

export interface EditorProps {
  /** The Source the editor loads on first render. */
  initialSource: Source;
  /**
   * Where the media bin reads and writes. Omit to use a zero-config local
   * store (IndexedDB — files persist in the browser, no backend). Inject your
   * own adapter (Supabase, S3, your API) to wire real storage; the editor only
   * ever calls list/upload/remove, so it stays storage-agnostic.
   */
  assetStore?: AssetStore;
  /**
   * What this editor instance IS (views, dock, knob exposure).
   * Defaults to ADVANCED_CONFIGURATION. Pass BASIC_CONFIGURATION — or
   * your own object — to reshape the editor without forking it.
   */
  configuration?: EditorConfiguration;
  /** Fired whenever the Source changes (mutation, undo, …). */
  onSourceChange?: (source: Source) => void;
  /**
   * Render handler — fired with the Source and the user's export choice
   * (format/resolution/quality) from the export dialog. The button is hidden
   * when omitted. The editor produces nothing itself; the consumer decides how
   * each format renders (browser MP4, cloud API, …).
   */
  onRender?: (source: Source, request: ExportRequest) => void;
  /**
   * Formats the export dialog offers. Defaults to `[{ id: 'mp4', label: 'MP4' }]`
   * — the free in-browser path. Inject more (ProRes, AV1, transparent, …) to
   * extend the dialog without the editor knowing what they are.
   */
  exportFormats?: ExportFormatOption[];
  rendering?: boolean;
  renderProgress?: number;
  /** Renderer backend override; defaults to 'auto'. */
  backend?: 'auto' | 'webgpu' | 'webgl2';
  /** Light or dark theme. Defaults to 'dark'. */
  theme?: 'light' | 'dark';
}
