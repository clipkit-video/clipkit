# @clipkit/renderer

Render a [ClipKit](https://clipkit.dev) `Source` to an **MP4 on your own machine** —
headless Chrome + WebCodecs, driven by Playwright. It's the Node-side renderer for
[`@clipkit/runtime`](https://www.npmjs.com/package/@clipkit/runtime): the runtime is
the engine; this is the thin harness that drives it headless and writes a file.

```bash
npm install @clipkit/renderer
```

> **Requires Google Chrome (or Chromium) installed.** The renderer launches your
> *system* Chrome via Playwright — the bundled Chromium ships without WebCodecs,
> which the MP4 exporter needs.

## Usage

```ts
import { render } from '@clipkit/renderer';
import { writeFile } from 'node:fs/promises';

const source = {
  clipkit_version: '1.1',
  output_format: 'mp4',
  width: 1280,
  height: 720,
  duration: 3,
  frame_rate: 30,
  background_color: '#0a0a12',
  elements: [
    {
      id: 'title', type: 'text', track: 1, time: 0, duration: 3,
      x: 640, y: 360, x_anchor: 0.5, y_anchor: 0.5, width: 1000,
      text: 'Hello, ClipKit', text_align: 'center',
      font_size: 80, fill_color: '#ffffff',
      animations: [{ type: 'fade-in', time: 0, duration: 0.6 }],
    },
  ],
};

const { buffer } = await render({ source, onProgress: (f, t) => console.log(`${f}/${t}`) });
await writeFile('out.mp4', buffer);
```

## API

### `render(options): Promise<RenderResult>`

| Option | Type | Default | |
|---|---|---|---|
| `source` | `Source` | — | the ClipKit document to render (required) |
| `backend` | `'auto' \| 'webgpu' \| 'webgl2'` | `'auto'` | force a runtime backend; `'webgl2'` is the most portable |
| `resolution` | `'source' \| '480p' … '4k'` | `'source'` | output height tier (keeps the Source aspect) |
| `bitrate` | `number` | auto | video bitrate, bits/second |
| `onProgress` | `(frame, total) => void` | — | per-frame progress |
| `timeoutMs` | `number` | `300000` | fail if no result within this window |
| `showBrowser` | `boolean` | `false` | show the Chrome window (debugging) |

`RenderResult` = `{ buffer, ext: 'mp4', mime: 'video/mp4', width, height, durationSec, frameRate }`.

## What this does and doesn't do

- ✅ **Does:** `Source` → **MP4 (H.264)** locally, the same compositor + WebCodecs
  encoder as the ClipKit editor, in headless Chrome. Free, runs anywhere with Chrome.
- ❌ **Doesn't:** ProRes / AV1 / transparent formats, a hosted rendering API, or GPU-
  accelerated server rendering. Those live in ClipKit's hosted service at
  [clipkit.dev](https://clipkit.dev).

## License

Apache-2.0. (It loads `@clipkit/runtime`, which is licensed under the BSL 1.1.)
