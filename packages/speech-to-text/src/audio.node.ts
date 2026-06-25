// Node audio extraction — any audio/video file → 16 kHz mono PCM, via the
// system `ffmpeg` (already a Clipkit toolchain dependency). This is the only
// Node-specific piece; the transcription engine itself is env-agnostic.
//
// Import path: `@clipkit/speech-to-text/node`.

import { spawn } from 'node:child_process';
import type { MonoAudio } from './types.js';

const SAMPLE_RATE = 16000;

/**
 * Decode an audio/video file to 16 kHz mono float PCM. Requires `ffmpeg` on PATH.
 * Works for any container ffmpeg reads (mp4, mov, mp3, wav, m4a, webm, …).
 */
export async function decodeAudioFile(path: string): Promise<MonoAudio> {
  // -f f32le: raw 32-bit float little-endian; -ac 1: mono; -ar 16000: 16 kHz.
  const args = ['-i', path, '-f', 'f32le', '-ac', '1', '-ar', String(SAMPLE_RATE), '-hide_banner', '-loglevel', 'error', 'pipe:1'];
  const chunks: Buffer[] = [];
  const errChunks: Buffer[] = [];

  await new Promise<void>((resolve, reject) => {
    const ff = spawn('ffmpeg', args);
    ff.stdout.on('data', (d: Buffer) => chunks.push(d));
    ff.stderr.on('data', (d: Buffer) => errChunks.push(d));
    ff.on('error', (e) => reject(new Error(`ffmpeg failed to start (is it installed?): ${e.message}`)));
    ff.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${Buffer.concat(errChunks).toString().trim()}`));
    });
  });

  const buf = Buffer.concat(chunks);
  // Float32 view over the raw bytes (copy into an aligned ArrayBuffer).
  const samples = new Float32Array(buf.byteLength / 4);
  for (let i = 0; i < samples.length; i++) samples[i] = buf.readFloatLE(i * 4);
  return { samples, sampleRate: SAMPLE_RATE };
}
