# @clipkit/runtime

WebGPU compositor + WebCodecs encoder for the Clipkit schema. Browser-first (Phase 1 — Node support comes later).

> **Status:** Phase 2a — port + cleanup of the existing webgpu-video-editor renderer. Audio path and caption rendering land in Phase 2b/2c.

## Install

```ts
import {
  ClipkitRenderer,
  ClipkitExporter,
  setLogger,
  type Source,
} from '@clipkit/runtime';
```

## Preview

```ts
const canvas = document.querySelector('canvas')!;
const renderer = new ClipkitRenderer(canvas);
await renderer.initialize();

const source: Source = { /* ... */ };
const frameLoop = () => {
  renderer.render(source, currentTime);
  requestAnimationFrame(frameLoop);
};
frameLoop();
```

## Export

```ts
const exporter = new ClipkitExporter(canvas, renderer);
const blob = await exporter.export(source, {
  codec: 'avc1.42002A',
  bitrate: 5_000_000,
  framerate: 30,
  onProgress: (p) => console.log(`${(p * 100).toFixed(1)}%`),
});

const url = URL.createObjectURL(blob);
// → playable MP4
```

## Logging

The runtime emits debug/info/warn/error logs prefixed with `[clipkit]`. Default is `'console'`:

```ts
import { setLogger } from '@clipkit/runtime';

setLogger('silent');                    // suppress all
setLogger({ debug, info, warn, error });// custom sink
```

## What's covered today

- WebGPU compositor with WebGL2 fallback: shape, text, image, video elements.
- `caption` element with word-level timing and four kinetic styles (`tiktok_bounce`, `fade_reveal`, `kinetic_typewriter`, `word_pop`).
- Keyframe-based property animation (29 easings).
- Named animation presets (`fade-in`, `slide-up-in`, etc.) compiled to tweens.
- WebCodecs H.264 video export via mp4-muxer.
- **Audio export:** `audio` elements decoded on preload, mixed via OfflineAudioContext, encoded as AAC, written to an audio track in the output MP4.
- FontFace-API-driven font loading with explicit loaded/ready state.

## Known port-time bugs (inherited from upstream, fix list)

- **`border_radius` discards entire shape.** The shape fragment shader uses `border_radius` in normalized texcoord space (0..1) but the JS writes it in pixels — any value ≥ 0.5 makes `length(corner) > radius` true for every fragment and discards the whole shape. Use `border_radius: 0` until the shader is normalized (send `border_radius_px / min(width_px, height_px)`).
- **Property-evaluator cache key includes time** (`{ms}_{ids}`), so every distinct frame is a cache miss. The cache is effectively a no-op for static properties; values fall through to `evaluateStaticValue` correctly but waste CPU.
- **`shapeType` uniform is declared `u32` in the shader but written as `f32`.** For values 0/1 the bit patterns happen to land on `u32 0` and `u32 1065353216` respectively — works for rectangle (path !== "ellipse" → 0), would silently break any future shape-type that's not 0 or "ellipse".

These don't block Phase 2a (port + canary), but they should be cleaned up before Phase 2c (caption renderer touches the shape pipeline).

## Known limitations

- **No preview audio playback yet** — `audio` elements are silent during preview but DO appear in the MP4 export. Real-time audio playback through Web Audio is a follow-up.
- **Audio `volume` keyframes are not yet animated** — only the static `volume` value applies. Animating volume requires a per-element GainNode with parameter automation; the API extension is small.
- **No caption wrapping** — long captions render on a single line. Multi-line wrap is a follow-up.
- **No composition nesting** — `composition` elements are currently no-ops. Recursive rendering through `composition.elements` is deferred.

## Browser support

WebGPU is the primary backend; WebGL2 is the automatic fallback. The runtime tries WebGPU first and falls through to WebGL2 if `requestAdapter` returns null.

- **Chrome / Edge (desktop + Android):** WebGPU works. Full feature support.
- **Safari:** WebGPU is enabled by default in recent versions. WebGL2 fallback covers older Safari.
- **Firefox:** WebGL2 fallback (WebGPU not yet stable).

WebCodecs (used by the encoder) is more constrained — Chrome/Edge full, Safari partial, Firefox in progress. Preview works on all four browsers via WebGL2 even when export doesn't.

### Gotcha: canvas locking

Once a canvas has been bound to a graphics context via `getContext('webgpu')` or `getContext('webgl2')`, **it's locked to that context type for life**. You can't switch a canvas from WebGPU to WebGL2 (or vice versa) after the first context is acquired — subsequent `getContext` calls with the other type return `null`.

If your app needs to switch backends at runtime (e.g. a settings toggle), **provide a fresh canvas** for the new `ClipkitRuntime`. In React, this means a `key` prop that changes when the backend changes so the canvas remounts.
