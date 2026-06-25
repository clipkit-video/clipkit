// AudioScheduler — schedules every `audio` element AND every `video`
// element's embedded audio track in the Source on the engine's
// AudioContext, locked to the TransportClock.
//
// Video audio: decodeAudioData accepts MP4 containers directly (it
// extracts the first audio track), so videos go through the exact same
// decode path. Silent videos fail decode quietly and are skipped.
// `playback_rate` (video-only) maps to AudioBufferSourceNode.playbackRate
// and scales all offset math.
//
// Why this design:
//   - Audio plays through `AudioBufferSourceNode.start(when, offset)`.
//     That's sample-accurate scheduling on the audio thread — no per-frame
//     re-sync, no HTMLAudioElement drift correction.
//   - Decoding goes through `audioContext.decodeAudioData(arrayBuffer)`,
//     the same primitive the runtime's export path uses. The decoded
//     AudioBuffer is mathematically identical → preview audio is
//     bit-equivalent to what shows up in the exported MP4 (modulo the
//     context's native sample rate, which in practice is 48 kHz on both
//     paths).
//   - Decoded buffers are cached per URL so editing an unrelated element
//     doesn't re-fetch / re-decode the audio.
//   - Sync against the clock is "stop everything, restart what should
//     be playing." Simple, always correct, idempotent.
//
// Not in v1 (documented gaps):
//   - Keyframe-animated volume — only the scalar `volume` field is read.
//     Animatable volume can layer in via a separate GainNode automation
//     pass driven by the clock; out of scope for the sprint.
//   - Per-track loop with explicit loopStart/loopEnd. v1 supports
//     `element.loop: true` for the simple "play through, loop the whole
//     trim window" case.
//
// CORS: audio URLs must serve `Access-Control-Allow-Origin` headers
// reachable from the playback origin, same as the runtime's loader.

import type { Source, AudioElement, VideoElement } from '@clipkit/protocol';
import { createMasterLimiter, fadeBreakpoints, rateOf, trimDurationOf, trimWindow } from '@clipkit/runtime';
import type { ClockState, TransportClock } from './clock.js';

interface Track {
  /** Element id for diagnostics. */
  readonly id: string;
  /** Decoded audio. */
  readonly buffer: AudioBuffer;
  /** Composition time the audio starts playing, in seconds. */
  readonly startSec: number;
  /** Composition time the audio stops playing, in seconds. */
  readonly endSec: number;
  /** Offset into the buffer at startSec, in seconds (from `trim_start`). */
  readonly trimStart: number;
  /** Length of buffer playback (after trim), in seconds. */
  readonly trimDuration: number;
  /** Volume as a 0..1 gain multiplier (schema is 0..100). */
  readonly gain: number;
  /** Whether to loop within the trim window. */
  readonly loop: boolean;
  /** Media seconds consumed per timeline second (video playback_rate). */
  readonly rate: number;
  /** audio_fade_in seconds (0 = none). */
  readonly fadeIn: number;
  /** audio_fade_out seconds (0 = none). */
  readonly fadeOut: number;
  /** Reusable gain node so volume can be changed without re-creating. */
  readonly gainNode: GainNode;
  /**
   * PREVIEW-ONLY gain (mute/solo, the editors' lens rule) — sits
   * after the authored volume+fade gain, never serialized anywhere.
   */
  readonly previewNode: GainNode;
  /** Per-track stereo meter taps (post mute/solo, so meters show what you hear). */
  readonly analyserL: AnalyserNode;
  readonly analyserR: AnalyserNode;
  /** Currently-scheduled source node, or null when stopped. */
  node: AudioBufferSourceNode | null;
}

/** Peak amplitude per channel. 0 = silence, 1 = 0 dBFS; values >1 are "over"
 *  (above full scale, possible on pre-limiter element taps when boosted). The
 *  meters map this to a dB scale, so it is intentionally NOT clamped. */
export interface StereoPeak {
  l: number;
  r: number;
}

export interface AudioLevels {
  /** Master L/R peaks, post-limiter (what you hear). */
  master: StereoPeak;
  /** Per-element L/R peaks (post volume + mute/solo, pre-master), by id. */
  elements: Record<string, StereoPeak>;
}

export class AudioScheduler {
  readonly #ctx: AudioContext;
  readonly #clock: TransportClock;
  readonly #unsubscribe: () => void;
  readonly #bufferCache = new Map<string, AudioBuffer>();
  #tracks: Track[] = [];
  #setSourceVersion = 0;
  #disposed = false;
  /** Preview gains by element id (mute/solo); survives setSource. */
  #previewGains = new Map<string, number>();
  readonly #masterGain: GainNode;
  readonly #limiter: DynamicsCompressorNode;
  readonly #masterAnalyserL: AnalyserNode;
  readonly #masterAnalyserR: AnalyserNode;
  #meterScratch: Float32Array<ArrayBuffer> | null = null;

  constructor(audioContext: AudioContext, clock: TransportClock) {
    this.#ctx = audioContext;
    this.#clock = clock;
    this.#unsubscribe = clock.subscribe((state) => this.#sync(state));
    // All tracks route through one master bus: sum → limiter → destination.
    // The limiter is the shared clip-protection stage (transparent below
    // 0 dBFS), identical to the export mixer, so preview matches the render.
    // Meters tap POST-limiter via a channel splitter, so the L/R bars show
    // exactly what you hear.
    this.#masterGain = audioContext.createGain();
    this.#limiter = createMasterLimiter(audioContext);
    this.#masterGain.connect(this.#limiter);
    this.#limiter.connect(audioContext.destination);
    const m = this.#makeStereoMeter(this.#limiter);
    this.#masterAnalyserL = m.analyserL;
    this.#masterAnalyserR = m.analyserR;
  }

  /**
   * Hang a stereo meter tap (channel splitter → two analysers) off a node.
   * A small explicit-stereo gain sits in front so a MONO source up-mixes to
   * both channels — otherwise the right meter would read silence on mono
   * clips. Analysers are leaf taps; they don't feed the audio path.
   */
  #makeStereoMeter(src: AudioNode): { analyserL: AnalyserNode; analyserR: AnalyserNode } {
    const tap = this.#ctx.createGain();
    tap.channelCountMode = 'explicit';
    tap.channelCount = 2;
    tap.channelInterpretation = 'speakers';
    src.connect(tap);
    const splitter = this.#ctx.createChannelSplitter(2);
    tap.connect(splitter);
    const analyserL = this.#ctx.createAnalyser();
    const analyserR = this.#ctx.createAnalyser();
    analyserL.fftSize = 256;
    analyserR.fftSize = 256;
    splitter.connect(analyserL, 0);
    splitter.connect(analyserR, 1);
    return { analyserL, analyserR };
  }

  /**
   * Set PREVIEW-ONLY per-element gains (mute = 0, solo = others 0).
   * Multiplies on top of the authored volume/fades; never written
   * into the Source. Unlisted ids reset to 1.
   */
  setPreviewGains(gains: Readonly<Record<string, number>>): void {
    this.#previewGains = new Map(Object.entries(gains));
    for (const t of this.#tracks) {
      t.previewNode.gain.value = this.#previewGains.get(t.id) ?? 1;
    }
  }

  /** Current stereo peak levels for the mixer's meters. */
  getLevels(): AudioLevels {
    const elements: Record<string, StereoPeak> = {};
    for (const t of this.#tracks) {
      if (t.id) {
        elements[t.id] = { l: this.#peakOf(t.analyserL), r: this.#peakOf(t.analyserR) };
      }
    }
    return {
      master: { l: this.#peakOf(this.#masterAnalyserL), r: this.#peakOf(this.#masterAnalyserR) },
      elements,
    };
  }

  #peakOf(analyser: AnalyserNode): number {
    const n = analyser.fftSize;
    if (!this.#meterScratch || this.#meterScratch.length < n) {
      this.#meterScratch = new Float32Array(new ArrayBuffer(n * 4));
    }
    const buf = this.#meterScratch.subarray(0, n) as Float32Array<ArrayBuffer>;
    analyser.getFloatTimeDomainData(buf);
    let peak = 0;
    for (let i = 0; i < n; i++) {
      const v = Math.abs(buf[i]!);
      if (v > peak) peak = v;
    }
    return peak; // raw — may exceed 1.0 (over 0 dBFS); the meter maps it to dB
  }

  /**
   * Decode and schedule every `audio` element in the Source. Resolves
   * once all audio is decoded and tracks are aligned to the current
   * clock state. Rejects if any decode fails — the engine surfaces
   * via `onError`.
   *
   * Safe to call concurrently; only the most recent call's tracks
   * are kept. Earlier in-flight decodes that resolve after a newer
   * setSource are discarded.
   */
  async setSource(source: Source): Promise<void> {
    if (this.#disposed) return;
    const version = ++this.#setSourceVersion;

    const soundElements = source.elements.filter(
      (e): e is AudioElement | VideoElement =>
        e.type === 'audio' || e.type === 'video',
    );

    // Decode (or read from cache) in parallel. Videos without an audio
    // track fail decode — expected; skip them quietly.
    const built = await Promise.all(
      soundElements.map(async (el) => {
        const url = el.source;
        let buffer = this.#bufferCache.get(url);
        if (!buffer) {
          try {
            buffer = await this.#fetchAndDecode(url);
          } catch (err) {
            if (el.type === 'audio') throw err;
            return null; // silent video
          }
          if (this.#disposed || version !== this.#setSourceVersion) return null;
          this.#bufferCache.set(url, buffer);
        }
        return this.#buildTrack(el, buffer);
      }),
    );

    if (this.#disposed || version !== this.#setSourceVersion) return;

    // Stop existing tracks before swapping the array.
    for (const t of this.#tracks) this.#stopTrack(t);

    this.#tracks = built.filter((t): t is Track => t !== null);

    // Align to current clock state — if we're already playing, this
    // starts the newly-decoded tracks at the right offset.
    this.#sync({
      playing: this.#clock.playing,
      position: this.#clock.now(),
    });
  }

  /**
   * Tear everything down — unsubscribe from the clock, stop all source
   * nodes, disconnect gain nodes, clear the decode cache. Idempotent.
   */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#unsubscribe();
    for (const t of this.#tracks) {
      this.#stopTrack(t);
      t.gainNode.disconnect();
      t.previewNode.disconnect();
      t.analyserL.disconnect();
      t.analyserR.disconnect();
    }
    this.#tracks = [];
    this.#bufferCache.clear();
    this.#masterGain.disconnect();
    this.#limiter.disconnect();
    this.#masterAnalyserL.disconnect();
    this.#masterAnalyserR.disconnect();
  }

  // ── Internal ────────────────────────────────────────────────────────

  async #fetchAndDecode(url: string): Promise<AudioBuffer> {
    const response = await fetch(url, { mode: 'cors' });
    if (!response.ok) {
      throw new Error(`Audio fetch failed (${response.status}) for ${url}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    // decodeAudioData runs on the audio thread and is the same call used
    // by the runtime's export path. The returned AudioBuffer is detached
    // from the context that decoded it.
    return this.#ctx.decodeAudioData(arrayBuffer);
  }

  #buildTrack(el: AudioElement | VideoElement, buffer: AudioBuffer): Track {
    const startSec = numberOrZero(el.time);
    // playback_rate is video-only; audio elements run at 1.
    const rate = el.type === 'video' ? rateOf((el as VideoElement).playback_rate) : 1;
    const window = trimWindow(
      {
        trimStart: Math.max(0, numberOrZero(el.trim_start)),
        trimDuration: trimDurationOf(el.trim_duration),
      },
      buffer.duration,
    );
    const trimStart = window.start;
    const trimDuration = window.length;

    // Element timeline duration. 'auto' / 'end' / undefined → fall back
    // to the trimmed buffer length at the playback rate (the engine
    // knows the composition's total length and could pass it in, but
    // for v1 we let natural length win).
    const elementDuration =
      typeof el.duration === 'number' ? el.duration : trimDuration / rate;

    // Volume scalar; ignore Keyframe[] (documented gap). No upper clamp — this
    // matches the export mixer, so boosting past 100% works in preview too; the
    // master limiter (not a hard clamp) contains the result.
    const rawVolume = typeof el.volume === 'number' ? el.volume : 100;
    const gain = Math.max(0, rawVolume) / 100;

    const gainNode = this.#ctx.createGain();
    gainNode.gain.value = gain;
    // source → gainNode (volume+fades) → previewNode (mute/solo) → master bus,
    // with a stereo meter tap hung off previewNode (post mute/solo).
    const previewNode = this.#ctx.createGain();
    previewNode.gain.value = this.#previewGains.get(el.id ?? '') ?? 1;
    gainNode.connect(previewNode);
    previewNode.connect(this.#masterGain);
    const { analyserL, analyserR } = this.#makeStereoMeter(previewNode);

    return {
      id: el.id ?? '',
      buffer,
      startSec,
      endSec: startSec + elementDuration,
      trimStart,
      trimDuration,
      gain,
      loop: el.loop === true,
      rate,
      fadeIn: Math.max(0, numberOrZero(el.audio_fade_in)),
      fadeOut: Math.max(0, numberOrZero(el.audio_fade_out)),
      gainNode,
      previewNode,
      analyserL,
      analyserR,
      node: null,
    };
  }

  #sync(state: ClockState): void {
    if (this.#disposed) return;

    // Stop everything first. This handles pause + every seek correctly
    // — the next branch restarts whatever should be playing.
    for (const t of this.#tracks) this.#stopTrack(t);

    if (!state.playing) return;

    const compositionTime = state.position;
    const ctxNow = this.#ctx.currentTime;

    for (const t of this.#tracks) {
      // localOffset is "how far into the track's timeline are we?"
      // Negative means the track starts in the future.
      const localOffset = compositionTime - t.startSec;
      const trackTimelineLength = t.endSec - t.startSec;

      if (compositionTime >= t.endSec) continue; // already past the end
      if (trackTimelineLength <= 0) continue;

      let when: number;
      let offset: number;
      let duration: number;
      let elapsedTimeline: number;

      if (localOffset < 0) {
        // Track is in the future — schedule with a positive delay.
        when = ctxNow - localOffset;
        offset = t.trimStart;
        // start()'s duration is in BUFFER seconds; the timeline length
        // converts through the playback rate.
        duration = Math.min(t.trimDuration, trackTimelineLength * t.rate);
        elapsedTimeline = 0;
      } else {
        // Track is currently active — start immediately at the right offset.
        when = ctxNow;
        const offsetIntoTrim = localOffset * t.rate;
        if (offsetIntoTrim >= t.trimDuration && !t.loop) {
          // Past the playable audio (timeline is longer than the clip).
          continue;
        }
        offset = t.trimStart + (offsetIntoTrim % t.trimDuration);
        duration = (trackTimelineLength - localOffset) * t.rate;
        elapsedTimeline = localOffset;
      }

      this.#startTrack(t, when, offset, duration, elapsedTimeline, trackTimelineLength);
    }
  }

  #startTrack(
    t: Track,
    when: number,
    offset: number,
    duration: number,
    elapsedTimeline: number,
    trackTimelineLength: number,
  ): void {
    const node = this.#ctx.createBufferSource();
    node.buffer = t.buffer;
    node.playbackRate.value = t.rate;
    if (t.loop) {
      node.loop = true;
      node.loopStart = t.trimStart;
      node.loopEnd = t.trimStart + t.trimDuration;
    }
    node.connect(t.gainNode);

    // audio_fade_in / audio_fade_out — schedule the same piecewise
    // envelope the export mixer uses, picked up mid-curve when starting
    // partway through (seek into a fade region lands at the right gain).
    const g = t.gainNode.gain;
    g.cancelScheduledValues(when);
    if (t.fadeIn > 0 || t.fadeOut > 0) {
      const points = fadeBreakpoints(elapsedTimeline, trackTimelineLength, t.fadeIn, t.fadeOut);
      g.setValueAtTime(t.gain * points[0]!.gain, when);
      for (const p of points.slice(1)) {
        g.linearRampToValueAtTime(t.gain * p.gain, when + (p.tau - elapsedTimeline));
      }
    } else {
      g.setValueAtTime(t.gain, when);
    }

    node.start(when, offset, duration);
    t.node = node;
  }

  #stopTrack(t: Track): void {
    if (!t.node) return;
    try {
      t.node.stop();
    } catch {
      // Already stopped — node.stop() throws if called twice. Ignore.
    }
    t.node.disconnect();
    t.node = null;
  }
}

function numberOrZero(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}
