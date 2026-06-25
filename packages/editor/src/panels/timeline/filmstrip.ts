// Filmstrip frame sampler (EDITORS — ruled by Ian 2026-06-12:
// FRONTEND ONLY, no backend, no storage). Per source URL, a hidden
// <video> seeks to requested media times and captures frames as
// ImageBitmaps held in an in-memory LRU. Nothing is persisted — the
// cache lives for the session and rebuilds on reload.
//
// Usage: filmstripFrame(url, mediaTime, height, onReady) returns the
// cached frame or null; when null, it queues a decode and calls
// onReady once the frame lands so the caller can redraw.

const MAX_FRAMES_PER_URL = 240; // LRU cap; visible clips request few.

interface Pending {
  mediaTime: number;
  height: number;
  key: string;
}

class Sampler {
  readonly #video: HTMLVideoElement;
  #ready = false;
  #failed = false;
  #aspect = 16 / 9;
  readonly #cache = new Map<string, ImageBitmap>();
  readonly #queue: Pending[] = [];
  #seeking = false;
  readonly #listeners = new Set<() => void>();

  constructor(url: string) {
    const v = document.createElement('video');
    v.muted = true;
    v.crossOrigin = 'anonymous';
    v.preload = 'auto';
    v.playsInline = true;
    v.src = url;
    this.#video = v;
    const onLoaded = (): void => {
      this.#ready = true;
      if (v.videoWidth && v.videoHeight) this.#aspect = v.videoWidth / v.videoHeight;
      this.#pump();
    };
    v.addEventListener('loadeddata', onLoaded, { once: true });
    v.addEventListener('error', () => {
      this.#failed = true;
      this.#queue.length = 0;
    });
    // Some browsers need a load() nudge for metadata.
    v.load();
  }

  get aspect(): number {
    return this.#aspect;
  }

  onReady(cb: () => void): void {
    this.#listeners.add(cb);
  }

  /** Cached frame, or null (decode queued). */
  frame(mediaTime: number, height: number): ImageBitmap | null {
    if (this.#failed) return null;
    const key = bucketKey(mediaTime, height);
    const hit = this.#cache.get(key);
    if (hit) {
      // LRU touch.
      this.#cache.delete(key);
      this.#cache.set(key, hit);
      return hit;
    }
    if (!this.#queue.some((p) => p.key === key)) {
      this.#queue.push({ mediaTime, height, key });
      this.#pump();
    }
    return null;
  }

  #pump(): void {
    if (this.#seeking || !this.#ready || this.#failed) return;
    const next = this.#queue.shift();
    if (!next) return;
    if (this.#cache.has(next.key)) {
      this.#pump();
      return;
    }
    this.#seeking = true;
    const v = this.#video;
    const onSeeked = (): void => {
      v.removeEventListener('seeked', onSeeked);
      createImageBitmap(v, { resizeHeight: Math.round(next.height * 2), resizeQuality: 'low' })
        .then((bmp) => {
          this.#cache.set(next.key, bmp);
          while (this.#cache.size > MAX_FRAMES_PER_URL) {
            const oldest = this.#cache.keys().next().value;
            if (oldest === undefined) break;
            this.#cache.get(oldest)?.close();
            this.#cache.delete(oldest);
          }
          for (const cb of this.#listeners) cb();
        })
        .catch(() => {
          // CORS-tainted or decode failure → give up on this URL.
          this.#failed = true;
        })
        .finally(() => {
          this.#seeking = false;
          this.#pump();
        });
    };
    v.addEventListener('seeked', onSeeked);
    try {
      v.currentTime = Math.max(0, next.mediaTime);
    } catch {
      v.removeEventListener('seeked', onSeeked);
      this.#seeking = false;
      this.#failed = true;
    }
  }
}

const samplers = new Map<string, Sampler>();

function bucketKey(mediaTime: number, height: number): string {
  // Quantize to 0.5s so adjacent requests share a decode.
  return `${Math.round(mediaTime * 2) / 2}:${height}`;
}

/**
 * Cached filmstrip frame for `url` at `mediaTime` (seconds into the
 * media), scaled to `height` px. Returns null while decoding; calls
 * `onReady` when a newly-decoded frame for this URL is available.
 */
export function filmstripFrame(
  url: string,
  mediaTime: number,
  height: number,
  onReady: () => void,
): ImageBitmap | null {
  let s = samplers.get(url);
  if (!s) {
    s = new Sampler(url);
    s.onReady(onReady);
    samplers.set(url, s);
  } else {
    s.onReady(onReady);
  }
  return s.frame(mediaTime, height);
}
