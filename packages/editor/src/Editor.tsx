// Editor — the configurable shell's root (EDITORS-PLAN B1). One
// component tree; the EditorConfiguration decides which regions exist
// (D2 layer 3). Four-region frame per design/refs: left rail (assets/
// layers), center stage, right inspector, bottom timeline — all flat,
// hairline-separated, resizable.

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import {
  ADVANCED_CONFIGURATION,
  EditorContext,
  createEditorStore,
  createLocalAssetStore,
  useEditor,
  useEditorContext,
  usePlaybackSession,
  type EditorContextValue,
} from '@clipkit/editor-core';
import { ConfigurationContext, getRegistry } from './configuration.js';
import { useKeyboardCommands } from './commands.js';
import { PanelGutter } from './frame/Resizable.js';
import { LeftRail } from './panels/LeftRail.js';
import { InspectorPanel } from './panels/InspectorPanel.js';
import { TimelinePanel } from './panels/TimelinePanel.js';
import { Stage } from './Stage.js';
import type { EditorProps } from './types.js';

export function Editor(props: EditorProps) {
  const {
    initialSource,
    configuration = ADVANCED_CONFIGURATION,
    onSourceChange,
    onRender,
    exportFormats,
    rendering,
    renderProgress,
    backend = 'auto',
    theme = 'dark',
    assetStore: assetStoreProp,
  } = props;

  const store = useMemo(() => createEditorStore(initialSource, theme), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  // ↑ The store owns state after mount (same contract as the legacy shell).

  // Local IndexedDB store unless the embedder injects one (the storage seam).
  const assetStore = useMemo(() => assetStoreProp ?? createLocalAssetStore(), [assetStoreProp]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engine = usePlaybackSession(store, canvasRef, {
    backend,
    onSourceChange,
  });

  const liveTheme = useStore(store, (s) => s.ui.theme);
  // Track the `theme` prop live. The store seeds from it once (createEditorStore
  // above), but a host that toggles light/dark at runtime — e.g. apps/web's site
  // theme — needs the editor to follow. No-op when already in sync; an in-editor
  // toggle (if one is added) still sticks until the prop next changes.
  useEffect(() => {
    if (store.getState().ui.theme !== theme) store.getState()._setUiState({ theme });
  }, [store, theme]);
  const editorCtx = useMemo<EditorContextValue>(
    () => ({ store, engine, theme: liveTheme, assetStore }),
    [store, engine, liveTheme, assetStore],
  );
  const configCtx = useMemo(
    () => ({ configuration, registry: getRegistry() }),
    [configuration],
  );

  // Panel sizes are EDITOR STATE (the lens rule) — never serialized.
  const [leftWidth, setLeftWidth] = useState(300);
  const [rightWidth, setRightWidth] = useState(264);
  const [bottomHeight, setBottomHeight] = useState(260);

  // The Source (JSON) tab auto-widens the left rail a notch and
  // restores the previous width on the way out (ruled by Ian
  // 2026-06-11). A manual resize while on Source sticks for the visit;
  // the pre-Source width is what comes back.
  const preSourceWidth = useRef(300);
  const onSourceTab = useRef(false);
  const handleLeftTabChange = (tab: string): void => {
    const entering = tab === 'source';
    if (entering && !onSourceTab.current) {
      preSourceWidth.current = leftWidth;
      setLeftWidth(Math.max(leftWidth, 380));
    } else if (!entering && onSourceTab.current) {
      setLeftWidth(preSourceWidth.current);
    }
    onSourceTab.current = entering;
  };

  const showLeft = configuration.views.assets || configuration.views.layers;
  const showTimeline = configuration.views.timeline;

  return (
    <EditorContext.Provider value={editorCtx}>
      <ConfigurationContext.Provider value={configCtx}>
        <div
          className={`clipkit-editor flex flex-col w-full h-full bg-background text-foreground ${liveTheme}`}
          data-theme={liveTheme}
        >
          <KeyboardBridge />
          {/* Top region: side panels + stage. The timeline below spans
              the FULL editor width (ruled by Ian 2026-06-11) — the
              side panels sit above it, not beside it. */}
          <div className="flex flex-1 min-h-0 min-w-0">
            {showLeft && (
              <>
                <div style={{ width: leftWidth }} className="shrink-0 min-w-0">
                  <LeftRail onActiveTabChange={handleLeftTabChange} />
                </div>
                {/* Max 600 so the Source (JSON) tab can pull wide. */}
                <PanelGutter
                  direction="left"
                  size={leftWidth}
                  min={160}
                  max={600}
                  onResize={setLeftWidth}
                />
              </>
            )}
            {/* Stage's root uses flex-1 — it must sit in a FLEX parent
                or its height collapses to 0 and the canvas clips
                invisible (and fit-to-screen bails on the 0-height
                measurement). */}
            <div className="flex-1 min-w-0 min-h-0 flex flex-col">
              <Stage ref={canvasRef} />
            </div>
            <PanelGutter
              direction="right"
              size={rightWidth}
              min={220}
              max={440}
              onResize={setRightWidth}
            />
            <div style={{ width: rightWidth }} className="shrink-0 min-w-0">
              <InspectorPanel />
            </div>
          </div>
          {/* Bottom region: full-width timeline. */}
          {showTimeline && (
            <>
              <PanelGutter
                direction="bottom"
                size={bottomHeight}
                min={120}
                max={480}
                onResize={setBottomHeight}
              />
              <div style={{ height: bottomHeight }} className="shrink-0">
                <TimelinePanel
                  onRender={onRender}
                  exportFormats={exportFormats}
                  rendering={rendering}
                  renderProgress={renderProgress}
                />
              </div>
            </>
          )}
        </div>
      </ConfigurationContext.Provider>
    </EditorContext.Provider>
  );
}

/** Mounts the keyboard command table once contexts exist. */
function KeyboardBridge() {
  const { store, engine } = useEditorContext();
  const actions = useEditor();
  useKeyboardCommands({ store, engine, actions });
  return null;
}
