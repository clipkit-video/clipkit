// Transcription Web Worker — runs Whisper (Transformers.js) OFF the main thread
// so the editor UI stays responsive during inference. The main thread decodes
// the audio (WebAudio) and transfers the PCM samples here (zero-copy); we run
// the model and post the transcript back.
//
// Bundlers (webpack/Next) pick this up via `new Worker(new URL('./transcribe.
// worker.js', import.meta.url), { type: 'module' })` — see CaptionTranscribe.

import { transcribe } from '@clipkit/speech-to-text';

// `self` typed loosely to avoid pulling the webworker lib into the editor's
// DOM-typed project (the two libs conflict on shared globals).
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage: (message: unknown) => void;
};

interface Request {
  samples: Float32Array;
  sampleRate: number;
  model?: string;
}

ctx.onmessage = async (e: MessageEvent): Promise<void> => {
  const { samples, sampleRate, model } = e.data as Request;
  try {
    const result = await transcribe(
      { samples, sampleRate },
      { model, onProgress: (info) => ctx.postMessage({ type: 'progress', info }) },
    );
    ctx.postMessage({ type: 'result', result });
  } catch (err) {
    ctx.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
