// The transcription engine — Whisper via Transformers.js (ONNX). The SAME model
// runs in the browser (WebGPU/WASM) and in Node (onnxruntime-node); the library
// picks the provider for the environment, so this file is env-agnostic.
//
// Input is always 16 kHz mono PCM (Float32). Output is a word-timestamped
// transcript. Map it onto the protocol with `toCaptionWords` (caption.ts).

import type { MonoAudio, TranscriptResult, TranscriptWord } from './types.js';

// Transformers.js's `pipeline()` factory has a giant overload union that tsc
// can't represent through our re-export; we only use the ASR task, so narrow it
// to a plain async factory at the boundary.
type AsrFn = (
  audio: Float32Array,
  opts: Record<string, unknown>,
) => Promise<{ text?: string; chunks?: Array<{ text: string; timestamp: [number, number | null] }> }>;
type PipelineFactory = (
  task: 'automatic-speech-recognition',
  model: string,
  opts: Record<string, unknown>,
) => Promise<AsrFn>;

// The ML engine (Transformers.js → onnxruntime, ~350 MB installed) is an
// OPTIONAL peer so the package installs lean. It is loaded on first use;
// absence fails here with an install hint, keeping every entry point
// importable without it.
let factory: Promise<PipelineFactory> | undefined;
function loadPipelineFactory(): Promise<PipelineFactory> {
  if (!factory) {
    factory = import('@huggingface/transformers').then(
      (m) => m.pipeline as unknown as PipelineFactory,
      () => {
        factory = undefined;
        throw new Error(
          'Local transcription needs the optional Whisper engine:\n\n  npm i @huggingface/transformers\n',
        );
      },
    );
  }
  return factory;
}

/** Whisper variants — size/speed/accuracy trade-off. `.en` are English-only. */
export type WhisperModel =
  | 'Xenova/whisper-tiny'
  | 'Xenova/whisper-tiny.en'
  | 'Xenova/whisper-base'
  | 'Xenova/whisper-base.en'
  | 'Xenova/whisper-small'
  | 'Xenova/whisper-small.en'
  | (string & {});

export interface TranscribeOptions {
  /** Model id (Hugging Face). Default 'Xenova/whisper-base'. */
  model?: WhisperModel;
  /** Force a language (e.g. 'en'); omit to auto-detect. Multilingual models only. */
  language?: string;
  /** Quantized weights — smaller download, slightly lower accuracy. Default true. */
  quantized?: boolean;
  /** Progress callback (model download). `progress` is 0..100 where known. */
  onProgress?: (info: { status: string; file?: string; progress?: number }) => void;
}

const SAMPLE_RATE = 16000;

// One cached pipeline per model id — loading is expensive; reuse across calls.
const pipelines = new Map<string, Promise<AsrFn>>();

function getPipeline(model: string, quantized: boolean, onProgress?: TranscribeOptions['onProgress']): Promise<AsrFn> {
  const key = `${model}:${quantized}`;
  let p = pipelines.get(key);
  if (!p) {
    p = loadPipelineFactory().then((pipeline) =>
      pipeline('automatic-speech-recognition', model, {
        dtype: quantized ? 'q8' : 'fp32',
        progress_callback: onProgress,
      }),
    );
    p.catch(() => pipelines.delete(key));
    pipelines.set(key, p);
  }
  return p;
}

/**
 * Transcribe 16 kHz mono PCM into a word-timestamped transcript.
 *
 * @example
 * const audio = await decodeAudioFile('clip.mp4'); // from '@clipkit/speech-to-text/node'
 * const result = await transcribe(audio);
 * const words = toCaptionWords(result);            // → caption element words[]
 */
export async function transcribe(
  audio: MonoAudio,
  options: TranscribeOptions = {},
): Promise<TranscriptResult> {
  const { model = 'Xenova/whisper-base', language, quantized = true, onProgress } = options;
  if (audio.sampleRate !== SAMPLE_RATE) {
    throw new Error(`transcribe: audio must be ${SAMPLE_RATE} Hz mono (got ${audio.sampleRate} Hz). Decode via '@clipkit/speech-to-text/node' or '/browser'.`);
  }

  const asr = await getPipeline(model, quantized, onProgress);
  const out = await asr(audio.samples, {
    return_timestamps: 'word',
    chunk_length_s: 30,
    stride_length_s: 5,
    language,
  });

  const chunks = out.chunks ?? [];
  const words: TranscriptWord[] = chunks.map((c, i) => {
    const start = c.timestamp[0] ?? 0;
    // The last word can have a null end; fall back to the next word's start or +0.3s.
    const end = c.timestamp[1] ?? (chunks[i + 1]?.timestamp[0] ?? start + 0.3);
    return { text: c.text.trim(), start, end };
  }).filter((w) => w.text.length > 0);

  return {
    text: (out?.text ?? '').trim(),
    words,
    language,
    duration: audio.samples.length / SAMPLE_RATE,
  };
}
