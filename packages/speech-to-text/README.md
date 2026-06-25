# @clipkit/speech-to-text

Transcribe an audio/video source into **word-timestamped captions** for Clipkit.

One Whisper model (via [Transformers.js](https://github.com/huggingface/transformers.js) / ONNX) runs the **same** in the browser (WebGPU/WASM) and in Node (`onnxruntime-node`) — no paid API, no native binaries, MIT-licensed weights. The output maps straight onto the protocol's `caption` element `words[]`.

**Authoring-time only.** The runtime never sees this package — it just renders the `words[]` we produce. The protocol is unchanged; this is the layer that *fills* a caption.

## Pipeline

```
audio/video file ──decode──▶ 16 kHz mono PCM ──transcribe──▶ TranscriptResult ──toCaptionWords──▶ caption.words[]
                  (env-specific)               (Whisper/ONNX)                   (the protocol bridge)
```

- **`transcribe(audio, opts?)`** — 16 kHz mono PCM → word-timestamped transcript. Env-agnostic.
- **`toCaptionWords(result, opts?)`** — transcript → `caption` element `words[]`. Pure; the one place this meets the protocol.
- **Audio decode is env-specific** — import from the matching entry point.

## Node

```ts
import { transcribe, toCaptionWords } from '@clipkit/speech-to-text';
import { decodeAudioFile } from '@clipkit/speech-to-text/node'; // needs ffmpeg on PATH

const audio = await decodeAudioFile('clip.mp4');
const result = await transcribe(audio, { model: 'Xenova/whisper-base' });
const words = toCaptionWords(result);
// → a caption element:  { type: 'caption', time: 0, track: 3, words }
```

## Browser

```ts
import { transcribe, toCaptionWords } from '@clipkit/speech-to-text';
import { decodeAudioBlob } from '@clipkit/speech-to-text/browser'; // WebAudio

const audio = await decodeAudioBlob(file);            // a File/Blob
const result = await transcribe(audio);               // WebGPU when available
```

## Models

`model` is any Whisper variant on the Hugging Face hub; default `Xenova/whisper-base`. Trade size/speed for accuracy: `whisper-tiny(.en)` (~40 MB, fast) → `whisper-base` → `whisper-small` (~250 MB). `.en` variants are English-only and faster. The model downloads once and is cached (browser cache / Node fs).

## Notes

- **Word timestamps** use Whisper's `return_timestamps: 'word'`. Quality scales with model size; for tight sync, prefer `base`/`small`.
- **`offset`** on `toCaptionWords` shifts absolute audio times to be relative to the caption element's `time` (the protocol stores word times relative to the element).
- On Node, `onnxruntime-node` may print a harmless `mutex lock failed` line during process **teardown** (after results are produced) — an upstream thread-pool cleanup quirk, not a transcription error.

## Verify

```
npm run build && node --test test/caption.test.mjs   # protocol bridge (fast, no model)
node test/smoke.mjs [file]                            # end-to-end (downloads a model)
```
