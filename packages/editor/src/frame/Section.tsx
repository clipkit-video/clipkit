// Section — THE flat inspector primitive per design/refs/README.md:
// a hairline-separated block with an uppercase micro-label header,
// collapsible by clicking the header, optional `+`/action slot on the
// right. No cards, no backgrounds — tight vertical rhythm.

'use client';

import { useState, type ReactNode } from 'react';
import { cn } from './../lib/utils.js';

interface Props {
  title: string;
  /** Right-aligned header slot (a `+` add button, a toggle, …). */
  action?: ReactNode;
  defaultOpen?: boolean;
  children?: ReactNode;
  className?: string;
}

export function Section({
  title,
  action,
  defaultOpen = true,
  children,
  className,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={cn('border-b border-border', className)}>
      <div className="flex items-center justify-between px-3 h-8 select-none">
        <button
          type="button"
          className="flex items-center gap-1.5 text-[11px] font-medium text-foreground/90 hover:text-foreground"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <svg
            width="7"
            height="7"
            viewBox="0 0 8 8"
            aria-hidden="true"
            className={cn(
              'text-muted-foreground transition-transform',
              open ? 'rotate-90' : '',
            )}
          >
            <path d="M2 1 L6 4 L2 7 Z" fill="currentColor" />
          </svg>
          {title}
        </button>
        {action && <div className="flex items-center gap-1">{action}</div>}
      </div>
      {open && children && <div className="px-3 pb-2.5">{children}</div>}
    </div>
  );
}

/** A label-left / value-right row inside a Section.
 *
 * THE GRID RHYTHM (ruled by Ian 2026-06-11): every row is 32px — a
 * 24px well + 8px breathing room. The label column is FIXED (64px,
 * matching the reference HTML) and the value area is FLUID — controls
 * stretch to fill it, so every well's left and right edges align
 * panel-wide regardless of panel width. */
export function FieldRow({
  label,
  children,
}: {
  label: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 h-8">
      <span className="w-16 shrink-0 text-[11px] text-muted-foreground truncate">
        {label}
      </span>
      {/* gap-2 horizontally = the 8px vertical rhythm. */}
      <div className="flex-1 flex items-center gap-2 min-w-0">{children}</div>
    </div>
  );
}
