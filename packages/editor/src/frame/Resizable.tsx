// Resizable panel gutter — a 1px hairline that grows a hit area on
// hover and drags a panel dimension. Flat per the design refs: no
// visible chrome until hovered.

'use client';

import { useRef, type MouseEvent as ReactMouseEvent } from 'react';
import { cn } from './../lib/utils.js';

interface Props {
  /** Which panel edge this gutter drags. */
  direction: 'left' | 'right' | 'bottom';
  /** Current size (width for left/right, height for bottom), px. */
  size: number;
  min: number;
  max: number;
  onResize: (next: number) => void;
}

export function PanelGutter({ direction, size, min, max, onResize }: Props) {
  const startRef = useRef(0);
  const sizeRef = useRef(size);
  sizeRef.current = size;

  const horizontal = direction === 'bottom';

  const onMouseDown = (e: ReactMouseEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    startRef.current = horizontal ? e.clientY : e.clientX;
    const startSize = sizeRef.current;
    const onMove = (ev: MouseEvent): void => {
      const delta = (horizontal ? ev.clientY : ev.clientX) - startRef.current;
      // Left panel grows rightward; right panel + bottom grow toward
      // the center, i.e. against the cursor delta.
      const signed = direction === 'left' ? delta : -delta;
      onResize(Math.max(min, Math.min(max, startSize + signed)));
    };
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
    };
    document.body.style.cursor = horizontal ? 'row-resize' : 'col-resize';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div
      className={cn(
        'relative shrink-0 group/gutter z-10',
        horizontal ? 'h-px w-full cursor-row-resize' : 'w-px h-full cursor-col-resize',
      )}
      onMouseDown={onMouseDown}
      role="separator"
      aria-orientation={horizontal ? 'horizontal' : 'vertical'}
    >
      <div
        className={cn(
          'absolute bg-border transition-colors group-hover/gutter:bg-primary/40',
          horizontal ? 'inset-x-0 top-0 h-px' : 'inset-y-0 left-0 w-px',
        )}
      />
      {/* Invisible 7px hit area centered on the hairline. */}
      <div
        className={cn(
          'absolute',
          horizontal ? '-top-1.5 -bottom-1.5 inset-x-0' : '-left-1.5 -right-1.5 inset-y-0',
        )}
      />
    </div>
  );
}
