// Audio loader. Fetches a URL and decodes it into an AudioBuffer that we
// can later play (preview) or mix offline (export).
//
// Uses the regular (non-offline) AudioContext to decode because
// decodeAudioData isn't exposed on OfflineAudioContext. The resulting
// AudioBuffer is detached from any context and can be used in either.

let sharedDecodeContext: AudioContext | null = null;

function getDecodeContext(): AudioContext {
  if (!sharedDecodeContext) {
    sharedDecodeContext = new AudioContext();
    // Most browsers auto-suspend until a user gesture; suspend explicitly
    // to avoid burning cycles during decode (we don't play through this one).
    void sharedDecodeContext.suspend();
  }
  return sharedDecodeContext;
}

/**
 * Fetch + decode a URL into an AudioBuffer. Throws on network or decode
 * errors; callers should let the error propagate through preload().
 */
export async function loadAudio(url: string): Promise<AudioBuffer> {
  // 10s fetch timeout (mirrors loadImage): a dead/stalled URL (e.g. a retired
  // host) otherwise dangles a connection and leans entirely on preload()'s
  // per-asset guard. AbortController cancels the fetch itself.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 10000);
  let response: Response;
  try {
    response = await fetch(url, { mode: 'cors', signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    throw new Error(`Failed to fetch audio ${url}: HTTP ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const ctx = getDecodeContext();
  // decodeAudioData returns a Promise in the modern API.
  return ctx.decodeAudioData(arrayBuffer);
}
