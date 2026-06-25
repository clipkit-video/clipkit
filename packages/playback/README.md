# @clipkit/playback

The Clipkit playback engine — turns a `Source` into something a user can hit
Play on and trust. Composes three things behind one API:

- A **TransportClock** as the master playhead. Uses `AudioContext.currentTime`
  as its precision time source, so it never drifts.
- A **worker-based frame producer** running `@clipkit/runtime` against an
  `OffscreenCanvas`. Pre-renders frames into a bounded `VideoFrame` ring
  buffer so heavy scenes never block the main thread.
- A **WebAudio scheduler** that decodes each `audio` element once and
  schedules sample-accurate playback via `AudioBufferSourceNode`. Reuses the
  same decode path the runtime exports through, so preview audio is
  bit-identical to the exported MP4.

```ts
import { PlaybackEngine } from '@clipkit/playback';

const engine = new PlaybackEngine({
  displayCanvas: canvasEl,
  source: mySource,
});

await engine.ready;
engine.onTime((t) => setUiTime(t));
engine.play();

// Live editing — invalidates the frame buffer and reschedules audio,
// preserves the playhead.
await engine.setSource(updatedSource);
```

## Status

Public API (`PlaybackEngine`, `TransportClock`, `BufferStatus`) is committed.
Internals are landing in stages — see `src/clock.ts`, `src/engine.ts`,
`src/worker.ts`. Until the worker lands, the engine renders on the main
thread behind the same API.

## License

Apache-2.0.
