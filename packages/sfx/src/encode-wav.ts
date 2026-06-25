// Stereo 16-bit PCM WAV encoder. Turns a rendered Sfx into bytes you can serve,
// write to disk, or wrap in a Blob/object-URL for an `audio` element's `source`.
// Self-contained so the editor can render → encode → drop-on-timeline without a
// dependency on @clipkit/score.

import type { Sfx } from './sfx.js';

/** Encode rendered stereo audio as a 16-bit PCM WAV (interleaved L/R). */
export function encodeWav(audio: Sfx): Uint8Array {
  const { left, right, sampleRate } = audio;
  const n = Math.min(left.length, right.length);
  const bytes = new Uint8Array(44 + n * 4);
  const dv = new DataView(bytes.buffer);
  const put = (o: number, s: string): void => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };

  put(0, 'RIFF'); dv.setUint32(4, 36 + n * 4, true); put(8, 'WAVE');
  put(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 2, true);
  dv.setUint32(24, sampleRate, true); dv.setUint32(28, sampleRate * 4, true);
  dv.setUint16(32, 4, true); dv.setUint16(34, 16, true);
  put(36, 'data'); dv.setUint32(40, n * 4, true);

  const clamp = (x: number): number => Math.max(-1, Math.min(1, x));
  let o = 44;
  for (let i = 0; i < n; i++) {
    dv.setInt16(o, Math.round(clamp(left[i]!) * 32767), true); o += 2;
    dv.setInt16(o, Math.round(clamp(right[i]!) * 32767), true); o += 2;
  }
  return bytes;
}
