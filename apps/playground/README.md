# Clipkit Playground

Minimal canary for `@clipkit/runtime`. Renders a hardcoded demo source (one blue shape + a "Clipkit" text) to a WebGPU canvas, with play/pause/seek and an MP4 export button.

> **Status:** Phase 2a verification artifact. No audio, no captions yet (those land in Phase 2b/2c).

## Run

```bash
npm install        # from the repo root
npm run dev --workspace=playground
```

Then open the URL Vite prints. Modern Chrome / Edge required — WebGPU and WebCodecs are not yet in stable Safari or Firefox.

## What it exercises

- `new ClipkitRenderer(canvas).initialize()` — WebGPU adapter + device + render pipelines.
- `renderer.render(source, time)` — composites elements onto the canvas per frame.
- Playback loop via `requestAnimationFrame`.
- `new ClipkitExporter(canvas, renderer).export(source, opts)` — frame-by-frame WebCodecs encode → mp4-muxer → MP4 Blob → file download.

## Editing the demo

Edit `DEMO_SOURCE` in `src/App.tsx`. The schema is `@clipkit/protocol`'s `Source`. Try adding more elements, animations, or keyframes.

## Known gaps (Phase 2a scope)

- No audio path. `audio` elements are no-ops.
- No caption rendering. `caption` elements are no-ops.
- No `composition` element nesting (renderer doesn't recurse yet).
