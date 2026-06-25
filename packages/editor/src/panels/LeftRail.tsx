// Left panel — tabbed Assets / Layers / Source per the design refs
// (Source ruled in by Ian 2026-06-11: the B10 JSON pane lives here as
// a third tab rather than a separate dock). B1 shipped the frame; the
// bin (B9) is still pending, the tree (B8) and JSON pane (B10) are in.

'use client';

import { useState } from 'react';
import { useConfiguration } from '../configuration.js';
import { cn } from '../lib/utils.js';
import { AssetsPanel } from './AssetsPanel.js';
import { LayersTree } from './LayersTree.js';
import { SourcePanel } from './SourcePanel.js';

export type LeftRailTabId = 'assets' | 'layers' | 'source';
type TabId = LeftRailTabId;

export function LeftRail({
  onActiveTabChange,
}: {
  /** Fires on tab switches — the shell auto-widens for Source. */
  onActiveTabChange?: (tab: LeftRailTabId) => void;
}) {
  const { configuration } = useConfiguration();
  const tabs: Array<{ id: TabId; label: string }> = [];
  if (configuration.views.assets) tabs.push({ id: 'assets', label: 'Assets' });
  if (configuration.views.layers) tabs.push({ id: 'layers', label: 'Layers' });
  if (configuration.views.json) tabs.push({ id: 'source', label: 'Source' });
  const [active, setActive] = useState<TabId>(tabs[0]?.id ?? 'assets');
  if (tabs.length === 0) return null;

  const current = tabs.some((t) => t.id === active) ? active : tabs[0]!.id;

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex items-center gap-3 h-9 px-3 border-b border-border shrink-0">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setActive(t.id);
              onActiveTabChange?.(t.id);
            }}
            className={cn(
              'text-[11px] font-medium transition-colors',
              current === t.id
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div
        className={cn(
          'flex-1 min-h-0',
          // CodeMirror owns its own scroller; the other tabs scroll here.
          current === 'source' ? 'overflow-hidden' : 'overflow-y-auto',
        )}
      >
        {current === 'source' ? (
          <SourcePanel />
        ) : current === 'layers' ? (
          <LayersTree />
        ) : (
          <AssetsPanel />
        )}
      </div>
    </div>
  );
}
