// URL → asset loaders.
//
// All functions throw on failure; callers can wrap in try/catch or let the
// error propagate through the scene's preload step. The runtime's public
// API has a single preload() boundary; once that resolves, render() can
// be called synchronously without worrying about async loads.

/**
 * Load an image URL and decode it into an ImageBitmap. ImageBitmaps are
 * preferred over HTMLImageElement here because they can be uploaded to
 * GPU textures without re-decoding.
 */
export async function loadImage(url: string): Promise<ImageBitmap> {
  // 10s fetch timeout. Without this a single stalled CDN (hotlink-
  // protected images on URL-snapshotted pages especially) hangs the
  // entire Promise.all in runtime.preload() and the worker never
  // resolves "ready".
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 10000);
  let response: Response;
  try {
    response = await fetch(url, { mode: 'cors', signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    throw new Error(`Failed to fetch image ${url}: HTTP ${response.status}`);
  }
  const blob = await response.blob();
  // imageOrientation: 'from-image' respects EXIF orientation; colorSpaceConversion: 'none'
  // skips browser color-space tweaks that can shift colors slightly.
  return createImageBitmap(blob, {
    imageOrientation: 'from-image',
    premultiplyAlpha: 'none', // we premultiply on the GPU during upload
    colorSpaceConversion: 'none',
  });
}

/**
 * Load a video URL into an HTMLVideoElement. Resolves once the video has
 * enough data to seek and sample frames (`loadeddata`). Caller can then
 * `video.currentTime = t` and read frames.
 */
export async function loadVideo(url: string): Promise<HTMLVideoElement> {
  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.muted = true; // required for autoplay-on-seek in some browsers
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;

  await new Promise<void>((resolve, reject) => {
    const onLoaded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(`Failed to load video ${url}`));
    };
    const cleanup = () => {
      video.removeEventListener('loadeddata', onLoaded);
      video.removeEventListener('error', onError);
    };
    video.addEventListener('loadeddata', onLoaded);
    video.addEventListener('error', onError);
  });

  return video;
}

/**
 * Seek a video to the given time and resolve once the new frame is ready
 * to be sampled. Necessary for deterministic frame-by-frame export.
 */
export function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    const target = Math.max(0, Math.min(video.duration || Number.POSITIVE_INFINITY, time));
    if (Math.abs(video.currentTime - target) < 1e-4) {
      resolve();
      return;
    }
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      resolve();
    };
    video.addEventListener('seeked', onSeeked);
    video.currentTime = target;
  });
}
