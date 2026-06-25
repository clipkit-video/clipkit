// Caption windowing control — `caption.max_length` as a simple letter count:
// how many letters of the transcript show on screen at once (a chunk grows
// word-by-word until the next word would exceed this). Captions always window;
// there's no "show all" in the editor. Default 16.

'use client';

export function CaptionLengthControl({
  value,
  onChange,
}: {
  value: number | 'auto' | undefined;
  onChange: (next: number) => void;
}) {
  const letters = typeof value === 'number' ? value : 16;
  return (
    <input
      type="number"
      min={1}
      max={200}
      value={letters}
      title="Max letters shown on screen at once"
      onChange={(e) => onChange(Math.max(1, Math.min(200, Number(e.target.value) || 16)))}
      className="w-14 h-6 px-1.5 rounded-sm bg-secondary text-foreground text-[11px] text-right tabular-nums outline-none"
    />
  );
}
