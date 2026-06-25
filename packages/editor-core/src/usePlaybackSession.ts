// usePlaybackSession — constructs the PlaybackEngine against a mounted
// canvas and wires it to the editor store: engine events → playback
// state, source changes → two-tier engine dispatch, loop toggle →
// engine. Extracted verbatim from the basic editor's root so every
// shell shares one engine-sync implementation.

'use client';

import { useEffect, useState, type RefObject } from 'react';
import { PlaybackEngine } from '@clipkit/playback';
import type { Source } from '@clipkit/protocol';
import { computeElementPatches } from './source-diff.js';
import type { EditorStore } from './store.js';

export interface PlaybackSessionOptions {
  /**
   * Override the renderer's backend selection. Defaults to `'auto'`
   * (WebGPU → WebGL2 fallback). Forced backends are mostly useful for
   * debugging.
   */
  backend?: 'auto' | 'webgpu' | 'webgl2';
  /**
   * Fired whenever a source change is dispatched to the engine — after
   * every mutation, undo, or external setSource. Use this to persist
   * user edits.
   */
  onSourceChange?: (source: Source) => void;
}

export function usePlaybackSession(
  store: EditorStore,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  options: PlaybackSessionOptions = {},
): PlaybackEngine | null {
  const { backend = 'auto', onSourceChange } = options;
  const [engine, setEngine] = useState<PlaybackEngine | null>(null);

  // ── Construct the engine once the canvas is mounted ────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const nextEngine = new PlaybackEngine({
      displayCanvas: canvas,
      source: store.getState().source,
      backend,
    });
    setEngine(nextEngine);

    const offTime = nextEngine.onTime((t) =>
      store.getState()._setPlaybackState({ time: t }),
    );
    const offPlaying = nextEngine.onPlayingChange((p) =>
      store.getState()._setPlaybackState({ playing: p }),
    );
    const offError = nextEngine.onError((e) =>
      store.getState()._setPlaybackState({ error: e.message }),
    );

    nextEngine.ready
      .then(() =>
        store.getState()._setPlaybackState({
          ready: true,
          duration: nextEngine.duration,
        }),
      )
      .catch((err: unknown) =>
        store.getState()._setPlaybackState({
          error: err instanceof Error ? err.message : String(err),
        }),
      );

    return () => {
      offTime();
      offPlaying();
      offError();
      nextEngine.dispose();
      setEngine(null);
    };
  }, [store, backend, canvasRef]);

  // ── Push source changes into the engine ────────────────────────────
  //
  // Two-tier dispatch path:
  //   1. Diff the new source against the engine's current source.
  //   2. If only patchable fields changed → engine.patchElements(...).
  //      Tiny payload, no audio reschedule, no preload, no full
  //      runtime reload of the source dictionary.
  //   3. Otherwise (structural / timing / asset change) →
  //      engine.setSource(next) — the full path with preload + audio.
  //
  // rAF coalescing: multiple store updates within the same animation
  // frame collapse into one dispatch. Only the latest source reaches
  // the engine.
  useEffect(() => {
    if (!engine) return;
    let scheduled: Source | null = null;
    let rafId: number | null = null;
    // Flat stage view (lens rule) drops the camera from the source the
    // PREVIEW engine sees — orthographic, gizmo-correct editing — while
    // the store's source (and persistence) keep the camera untouched.
    const forEngine = (s: Source): Source =>
      store.getState().ui.stageView === 'flat' && s.camera
        ? { ...s, camera: undefined }
        : s;
    const flush = (): void => {
      rafId = null;
      const next = scheduled;
      scheduled = null;
      if (next === null) return;
      if (!store.getState().playback.ready) return;
      const engineNext = forEngine(next);
      const patches = computeElementPatches(engine.source, engineNext);
      if (patches === null) {
        // Structural / timing / asset change — full path.
        void engine.setSource(engineNext);
      } else if (patches.length > 0) {
        // Visual-only change — patch path (engine swaps source ref,
        // sends only the deltas to the worker).
        engine.patchElements(engineNext, patches);
      }
      // patches.length === 0 → nothing to do (already in sync).
      // Persist the REAL source (with camera), not the preview variant.
      onSourceChange?.(next);
    };
    const unsubscribe = store.subscribe((state, prev) => {
      // Re-push on a source change OR a stage-view toggle (flat⇄camera
      // adds/removes the camera the preview engine sees).
      if (state.source === prev.source && state.ui.stageView === prev.ui.stageView) return;
      scheduled = state.source;
      if (rafId === null) rafId = requestAnimationFrame(flush);
    });
    return () => {
      unsubscribe();
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [engine, store, onSourceChange]);

  // ── Loop toggle → engine ───────────────────────────────────────────
  // Subscribe to ui.loop and forward to the engine. Cheaper than
  // reading from a hook in a child (would re-render the whole shell
  // on every loop toggle).
  useEffect(() => {
    if (!engine) return;
    engine.setLoop(store.getState().ui.loop);
    return store.subscribe((state, prev) => {
      if (state.ui.loop !== prev.ui.loop) engine.setLoop(state.ui.loop);
    });
  }, [engine, store]);

  return engine;
}
