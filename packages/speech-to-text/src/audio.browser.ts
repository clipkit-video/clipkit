// Browser audio extraction — a File/Blob/ArrayBuffer (audio or video) → 16 kHz
// mono PCM, via WebAudio's OfflineAudioContext (decode + resample in one pass).
// The only browser-specific piece; the engine itself is env-agnostic.
//
// Import path: `@clipkit/speech-to-text/browser`.

import type { MonoAudio } from './types.js';

const SAMPLE_RATE = 16000;

/**
 * Decode audio bytes (any format the browser supports — mp4/mov/mp3/wav/webm)
 * to 16 kHz mono float PCM. Pass a File/Blob's ArrayBuffer.
 */
export async function decodeAudioData(data: ArrayBuffer): Promise<MonoAudio> {
  // Decode at native rate first (decodeAudioData needs a real context), then
  // resample to 16 kHz mono with an OfflineAudioContext render pass.
  const tmp = new OfflineAudioContext(1, 1, 44100);
  const decoded = await tmp.decodeAudioData(data.slice(0));
  const frames = Math.ceil(decoded.duration * SAMPLE_RATE);
  const offline = new OfflineAudioContext(1, Math.max(1, frames), SAMPLE_RATE);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();
  return { samples: rendered.getChannelData(0).slice(), sampleRate: SAMPLE_RATE };
}

/** Convenience: decode a File/Blob directly. */
export async function decodeAudioBlob(blob: Blob): Promise<MonoAudio> {
  return decodeAudioData(await blob.arrayBuffer());
}
