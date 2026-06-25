// Export options dialog. Renders the FREE in-browser choices (resolution,
// quality) plus whatever formats the embedder injects via `formats`. The editor
// has zero knowledge of what any format is or how it renders — it collects the
// user's choice and hands it back through onConfirm; the consumer's onRender
// does the actual work (browser MP4, cloud API, …). Same boundary as AssetStore.

import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { ExportFormatOption, ExportQuality, ExportRequest, ExportResolution } from './types.js';

const RESOLUTIONS: { id: ExportResolution; label: string }[] = [
  { id: 'source', label: 'Source' },
  { id: '720p', label: '720p' },
  { id: '1080p', label: '1080p' },
  { id: '1440p', label: '1440p' },
  { id: '4k', label: '4K' },
];

const QUALITIES: { id: ExportQuality; label: string }[] = [
  { id: 'standard', label: 'Standard' },
  { id: 'high', label: 'High' },
];

const SELECT_CLS =
  'w-full h-7 rounded border border-border bg-background px-2 text-xs text-foreground';

export function ExportDialog({
  open,
  formats,
  onClose,
  onConfirm,
  theme = 'dark',
}: {
  open: boolean;
  formats: ExportFormatOption[];
  onClose: () => void;
  onConfirm: (request: ExportRequest) => void;
  /** Theme scope for the dialog. It portals to document.body — OUTSIDE the
   *  editor's `.clipkit-editor` root — so it must carry the scope itself or its
   *  tokens fall back to the global dark `:root` defaults. */
  theme?: 'light' | 'dark';
}) {
  const [format, setFormat] = useState(formats[0]?.id ?? 'mp4');
  const [resolution, setResolution] = useState<ExportResolution>('1080p');
  const [quality, setQuality] = useState<ExportQuality>('standard');

  if (!open) return null;
  const active = formats.find((f) => f.id === format) ?? formats[0];

  return createPortal(
    <div
      className="clipkit-editor fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      data-theme={theme}
      onClick={onClose}
    >
      <div
        className="w-80 rounded-lg border border-border bg-popover p-4 text-foreground shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* A <div>, not an <h2>: apps/web has an unlayered global h2 style that
            beats Tailwind utilities, so a heading element renders oversized. */}
        <div className="mb-3 text-sm font-semibold">Export</div>

        <label className="mb-1 block text-[11px] text-muted-foreground">Format</label>
        <select className={`${SELECT_CLS} mb-1`} value={format} onChange={(e) => setFormat(e.target.value)}>
          {formats.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
              {f.badge ? ` — ${f.badge}` : ''}
            </option>
          ))}
        </select>
        {active?.badge && (
          <p className="mb-3 text-[10px] text-muted-foreground">{active.badge}</p>
        )}
        {!active?.badge && <div className="mb-3" />}

        <label className="mb-1 block text-[11px] text-muted-foreground">Resolution</label>
        <select
          className={`${SELECT_CLS} mb-3`}
          value={resolution}
          onChange={(e) => setResolution(e.target.value as ExportResolution)}
        >
          {RESOLUTIONS.map((r) => (
            <option key={r.id} value={r.id}>{r.label}</option>
          ))}
        </select>

        <label className="mb-1 block text-[11px] text-muted-foreground">Quality</label>
        <select
          className={`${SELECT_CLS} mb-4`}
          value={quality}
          onChange={(e) => setQuality(e.target.value as ExportQuality)}
        >
          {QUALITIES.map((q) => (
            <option key={q.id} value={q.id}>{q.label}</option>
          ))}
        </select>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="h-7 rounded px-3 text-[11px] text-muted-foreground hover:text-foreground transition"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="h-7 rounded bg-primary px-3 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 transition"
            onClick={() => onConfirm({ format, resolution, quality })}
          >
            Export
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
