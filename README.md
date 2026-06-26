# ClipKit

**The video runtime for agents.** ClipKit turns a JSON timeline — the open
**ClipKit Protocol** — into rendered video on the GPU. Describe a video as
structured data; get an MP4. Built for AI agents and the developers shipping them.

[clipkit.dev](https://clipkit.dev) · [Docs](https://clipkit.dev/docs) · [Protocol](https://clipkit.dev/docs/protocol) · [Agent quickstarts](https://clipkit.dev/docs/mcp)

<div align="center">
  <video src="https://api.clipkit.dev/storage/v1/object/public/remote-assets/clipkit-promo.mp4" controls muted playsinline width="760"></video>
</div>

<p align="center"><sub><b>↑ Made with ClipKit.</b> Every frame of this promo was rendered from a ClipKit Protocol document — no editor, no timeline UI, just structured data. <a href="https://api.clipkit.dev/storage/v1/object/public/remote-assets/clipkit-promo.mp4">▶&nbsp;Play</a> if it doesn't load inline.</sub></p>

## Quick start

```bash
npm install -g @clipkit/cli

clipkit new my-video.json                 # scaffold a Source
clipkit render my-video.json -o out.mp4   # render locally (headless Chrome)
```

…or from code:

```ts
import { render } from '@clipkit/renderer';
import { writeFile } from 'node:fs/promises';

const { buffer } = await render({ source });   // source = a ClipKit Protocol document
await writeFile('out.mp4', buffer);
```

Local rendering uses your installed Google Chrome (for WebCodecs). For GPU-accelerated
and pro-format (ProRes / AV1 / transparent) output, render on the hosted service with
`clipkit render --cloud`.

## What's here

A monorepo; each package publishes to npm under the `@clipkit` scope.

| Package | What it is |
|---|---|
| [`@clipkit/protocol`](packages/protocol) | the ClipKit Protocol — schema, types, validation |
| [`@clipkit/runtime`](packages/runtime) | the engine — WebGPU/WebGL2 compositor + WebCodecs encoder |
| [`@clipkit/renderer`](packages/renderer) | render a Source to MP4 locally (headless Chrome) |
| [`@clipkit/editor`](packages/editor) | a configurable, embeddable editor over the schema |
| [`@clipkit/editor-core`](packages/editor-core) | the editor's UI-free data layer |
| [`@clipkit/playback`](packages/playback) | browser playback engine |
| [`@clipkit/patterns`](packages/patterns) | composable motion-graphics units |
| [`@clipkit/sfx`](packages/sfx) | procedural sound-effects synthesis |
| [`@clipkit/music-analysis`](packages/music-analysis) | beat / tempo analysis for authoring |
| [`@clipkit/speech-to-text`](packages/speech-to-text) | transcription → captions |
| [`@clipkit/lint`](packages/lint) | protocol-aware validation + plain-language summaries |
| [`@clipkit/mcp-server`](packages/mcp-server) | an MCP server so agents can author + render video |
| [`@clipkit/cli`](packages/cli) | the local-first CLI |

## For AI agents

ClipKit ships an MCP server — point your agent at it and it can build, validate,
preview, and render ClipKit videos:

```bash
npx -y @clipkit/cli mcp        # stdio MCP server
```

See the [agent quickstarts](https://clipkit.dev/docs/mcp) for Claude, Cursor, and more.

## License

Apache-2.0 — **except [`@clipkit/runtime`](packages/runtime)**, which is under the
[Business Source License 1.1](LICENSING.md) and converts to Apache-2.0 four years after
each release. In plain terms: use it, embed it, build your own product on it, and render
for your own customers — all free. The one thing you can't do is offer a competing
*hosted* ClipKit-rendering service. See [LICENSING.md](LICENSING.md) and
[TRADEMARK.md](TRADEMARK.md).
