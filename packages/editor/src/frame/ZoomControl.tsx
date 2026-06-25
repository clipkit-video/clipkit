// ZoomControl — the editor's one zoom cluster (stage corner + timeline
// transport), styled to the Figma direction in design/refs: no card
// pill, just quiet flat buttons with thin-stroke glyphs and a tabular
// readout, hairline divider before fit. The readout doubles as a fit
// button (the legacy affordance). Hosts that float it over content
// (the stage) supply their own surface.

'use client';

export function ZoomControl({
  readout,
  onZoomOut,
  onZoomIn,
  onFit,
  fitLabel = 'Fit to width',
}: {
  /** e.g. "54%" or "56px/s". Clicking it fits. */
  readout: string;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onFit: () => void;
  fitLabel?: string;
}) {
  return (
    <div className="flex items-center text-muted-foreground select-none">
      <ZoomButton label="Zoom out" onClick={onZoomOut}>
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <path
            d="M3.5 7 H10.5"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
      </ZoomButton>
      <button
        type="button"
        className="px-1 h-6 flex items-center whitespace-nowrap rounded-sm text-[11px] tabular-nums text-foreground/90 hover:text-foreground hover:bg-secondary transition-colors"
        onClick={onFit}
        title={fitLabel}
      >
        {readout}
      </button>
      <ZoomButton label="Zoom in" onClick={onZoomIn}>
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <path
            d="M7 3.5 V10.5 M3.5 7 H10.5"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
      </ZoomButton>
      <span className="w-px h-3 bg-border mx-1" aria-hidden />
      <ZoomButton label={fitLabel} onClick={onFit}>
        <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true">
          <path
            d="M2 5 L2 2 L5 2 M9 2 L12 2 L12 5 M12 9 L12 12 L9 12 M5 12 L2 12 L2 9"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </ZoomButton>
    </div>
  );
}

function ZoomButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="w-6 h-6 grid place-items-center rounded-sm hover:text-foreground hover:bg-secondary transition-colors"
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      {children}
    </button>
  );
}
