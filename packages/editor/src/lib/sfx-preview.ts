// Browser-side SFX preview + drop helpers. The catalog's renderSfx() gives us
// raw stereo PCM (a finished Sfx); here we either (a) play it through WebAudio
// for an instant preview, or (b) encode it to a WAV object-URL so it can be
// dropped on the timeline as a runtime-native `audio` element.
//
// Client-only: AudioContext / Blob / URL exist in the browser. The single
// shared AudioContext is created lazily on the first user gesture (a click),
// which is what browsers require for audio to start.

import { encodeWav, type Sfx } from '@clipkit/sfx';

let ctx: AudioContext | null = null;
let current: AudioBufferSourceNode | null = null;

function audioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  return ctx;
}

/** Stop whatever preview is currently playing (no-op if nothing is). */
export function stopSfx(): void {
  if (current) {
    try { current.stop(); } catch { /* already stopped */ }
    current = null;
  }
}

/**
 * Play a rendered Sfx once through the shared AudioContext. Cuts off any
 * preview already playing (clicking around the catalog never stacks sounds).
 * Returns the duration in seconds, or 0 if audio isn't available.
 */
export function playSfx(sfx: Sfx): number {
  const ac = audioContext();
  if (!ac) return 0;
  if (ac.state === 'suspended') void ac.resume();
  stopSfx();

  const n = Math.min(sfx.left.length, sfx.right.length);
  const buf = ac.createBuffer(2, n, sfx.sampleRate);
  // getChannelData().set() sidesteps copyToChannel's strict typed-array generic.
  buf.getChannelData(0).set(sfx.left.subarray(0, n));
  buf.getChannelData(1).set(sfx.right.subarray(0, n));

  const src = ac.createBufferSource();
  src.buffer = buf;
  src.connect(ac.destination);
  src.onended = () => { if (current === src) current = null; };
  src.start();
  current = src;
  return n / sfx.sampleRate;
}

/** Length of a rendered Sfx in seconds. */
export function sfxDuration(sfx: Sfx): number {
  return Math.min(sfx.left.length, sfx.right.length) / sfx.sampleRate;
}

/**
 * Encode a rendered Sfx to a WAV blob and return an object-URL usable as an
 * `audio` element's `source`. Caller owns the URL — revoke it when the element
 * that references it is removed (or on unmount) to avoid leaking blobs.
 */
export function sfxToObjectUrl(sfx: Sfx): string {
  const wav = encodeWav(sfx);
  // Copy into a fresh ArrayBuffer so the Blob owns contiguous bytes.
  const blob = new Blob([wav.slice().buffer], { type: 'audio/wav' });
  return URL.createObjectURL(blob);
}
