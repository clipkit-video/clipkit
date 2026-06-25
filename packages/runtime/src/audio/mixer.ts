// Offline audio mixing for export.
//
// Schedules each audio element — AND each video element's embedded
// audio track — on an OfflineAudioContext at its `time`, trimmed by
// `trim_start`/`trim_duration`, rate-adjusted by `playback_rate`
// (videos), capped at `duration`, with gain set from `volume`. The
// rendered AudioBuffer goes to the encoder.
//
// Volume keyframe animations are NOT applied in v1 — the static `volume`
// is used. Animating volume requires running a separate Web Audio graph
// per element with a GainNode driven by automation; small refactor when
// we want it.

import type { AudioElement, Element, Keyframe, Source, VideoElement } from '@clipkit/protocol';
import { interpolateKeyframes } from '../animation/keyframes.js';
import { mapToMediaTime, rateOf, timeRemapOf, trimDurationOf, trimWindow } from '../assets/media-time.js';
import { fadeBreakpoints } from './fades.js';
import { createMasterLimiter } from './limiter.js';
import { scheduleVarispeedRun, varispeedRuns } from './varispeed.js';
import { getLogger } from '../logger.js';

/** One ancestor group's time scope: translate by start, then warp. */
interface TimeScope {
  start: number;
  dur: number;
  remap: Keyframe[] | null;
}

interface SoundEntry {
  el: AudioElement | VideoElement;
  chain: TimeScope[];
}

/** Recursively collect sound elements with their ancestor time scopes. */
function collectSound(
  elements: readonly Element[],
  chain: TimeScope[],
  parentDur: number,
  out: SoundEntry[],
): void {
  for (const el of elements) {
    const start = numberOr(el.time, 0);
    const dur = parseDuration(el.duration, parentDur - start);
    if (el.type === 'audio' || el.type === 'video') {
      out.push({ el: el as AudioElement | VideoElement, chain });
    } else if (el.type === 'group') {
      const kids = (el as { elements?: Element[] }).elements;
      if (Array.isArray(kids)) {
        collectSound(kids, [...chain, { start, dur, remap: timeRemapOf((el as { time_remap?: unknown }).time_remap) }], dur, out);
      }
    }
  }
}

export interface MixOptions {
  /** Sample rate of the output buffer. Common: 48000 (matches AAC defaults). */
  sampleRate?: number;
  /** Number of channels. 2 = stereo. */
  numberOfChannels?: number;
}

const DEFAULT_SAMPLE_RATE = 48000;
const DEFAULT_CHANNELS = 2;

/**
 * Render all `audio` elements in a Source to a single mixed AudioBuffer.
 *
 * @param source         The Source being exported.
 * @param audioBuffers   Map of element.source URL → decoded AudioBuffer (preloaded).
 * @param totalDuration  Duration of the export in seconds.
 * @param options        Sample rate / channels override.
 */
export async function mixSourceAudio(
  source: Source,
  audioBuffers: Map<string, AudioBuffer>,
  totalDuration: number,
  options: MixOptions = {},
): Promise<AudioBuffer | null> {
  const sampleRate = options.sampleRate ?? DEFAULT_SAMPLE_RATE;
  const channels = options.numberOfChannels ?? DEFAULT_CHANNELS;
  const totalFrames = Math.ceil(totalDuration * sampleRate);

  const soundEntries: SoundEntry[] = [];
  collectSound(source.elements, [], totalDuration, soundEntries);
  if (soundEntries.length === 0) return null;

  // OfflineAudioContext renders deterministically with no realtime constraint.
  const ctx = new OfflineAudioContext({
    numberOfChannels: channels,
    length: totalFrames,
    sampleRate,
  });

  // Master bus: every source sums into masterGain, then passes through a fixed
  // safety limiter to the destination. The limiter is transparent below 0 dBFS
  // and only engages when the sum would otherwise clip — identical to the
  // preview scheduler's master bus, so export matches what you hear.
  const masterGain = ctx.createGain();
  const limiter = createMasterLimiter(ctx);
  masterGain.connect(limiter).connect(ctx.destination);

  let scheduledCount = 0;
  for (const { el: element, chain } of soundEntries) {
    const url = String(element.source ?? '');
    const buffer = audioBuffers.get(url);
    if (!buffer) {
      // Expected for silent videos; a real miss for audio elements.
      if (element.type === 'audio') {
        getLogger().warn(`Audio element ${element.id ?? '(no id)'} skipped — buffer not preloaded for ${url}`);
      }
      continue;
    }

    const ownRemap =
      element.type === 'video' ? timeRemapOf((element as VideoElement).time_remap) : null;
    const warped = ownRemap !== null || chain.some((c) => c.remap !== null);

    if (warped) {
      // Varispeed (§5.3.2/§5.8.3): sample the effective media-time
      // function through the warp chain, split into monotonic runs,
      // schedule each (reversed buffer for backward runs). Fades are
      // not applied under warps in v1; volume is.
      const elStart = numberOr(element.time, 0);
      const elDur = parseDuration(element.duration, totalDuration);
      const rate0 =
        element.type === 'video' ? rateOf((element as VideoElement).playback_rate) : 1;
      const mediaAt = (t: number): number | null => {
        let c = t;
        for (const scope of chain) {
          if (c < scope.start || c > scope.start + scope.dur) return null;
          c -= scope.start;
          if (scope.remap) c = Math.max(0, interpolateKeyframes(scope.remap, c));
        }
        if (c < elStart || c > elStart + elDur) return null;
        const m = mapToMediaTime(
          c,
          {
            elementStart: elStart,
            trimStart: clampNonNeg(numberOr(element.trim_start, 0)),
            trimDuration: trimDurationOf(element.trim_duration),
            rate: rate0,
            loop: element.loop === true,
            timeRemap: ownRemap,
          },
          buffer.duration,
        );
        return Math.max(0, Math.min(m, buffer.duration));
      };
      const volumePct0 = numberOr(element.volume, 100);
      const gain0 = Math.max(0, volumePct0 / 100);
      for (const run of varispeedRuns(mediaAt, 0, totalDuration)) {
        scheduleVarispeedRun(ctx, buffer, run, masterGain, run.t0, gain0);
        scheduledCount++;
      }
      continue;
    }

    // Static path — translate-only chains: the audible window is the
    // element's own, offset by its ancestors' starts.
    const chainOffset = chain.reduce((a, c) => a + c.start, 0);
    const startTime = clampNonNeg(chainOffset + numberOr(element.time, 0));
    // playback_rate only exists on video; audio elements run at 1.
    const rate =
      element.type === 'video' ? rateOf((element as VideoElement).playback_rate) : 1;
    const window = trimWindow(
      {
        trimStart: clampNonNeg(numberOr(element.trim_start, 0)),
        trimDuration: trimDurationOf(element.trim_duration),
      },
      buffer.duration,
    );

    // Bail if scheduling is past the end of the export.
    if (startTime >= totalDuration) continue;
    if (window.length <= 0) continue;

    // Timeline seconds the element occupies; media plays at `rate`.
    const elementDuration = parseDuration(element.duration, window.length / rate);
    const timelineCap = Math.min(elementDuration, totalDuration - startTime);
    // start()'s duration argument is in BUFFER seconds.
    const bufferPlayDuration = Math.min(window.length, timelineCap * rate);
    if (bufferPlayDuration <= 0) continue;

    const sourceNode = ctx.createBufferSource();
    sourceNode.buffer = buffer;
    sourceNode.playbackRate.value = rate;

    const gainNode = ctx.createGain();
    const volumePct = numberOr(element.volume, 100);
    const baseGain = Math.max(0, volumePct / 100);
    gainNode.gain.value = baseGain;

    // audio_fade_in / audio_fade_out — piecewise-linear gain envelope
    // over the element's timeline window (shared with the preview
    // scheduler via fades.ts).
    const fadeIn = Math.max(0, numberOr(element.audio_fade_in, 0));
    const fadeOut = Math.max(0, numberOr(element.audio_fade_out, 0));
    if (fadeIn > 0 || fadeOut > 0) {
      const points = fadeBreakpoints(0, timelineCap, fadeIn, fadeOut);
      gainNode.gain.setValueAtTime(baseGain * points[0]!.gain, startTime);
      for (const p of points.slice(1)) {
        gainNode.gain.linearRampToValueAtTime(baseGain * p.gain, startTime + p.tau);
      }
    }

    sourceNode.connect(gainNode).connect(masterGain);
    if (element.loop) {
      sourceNode.loop = true;
      sourceNode.loopStart = window.start;
      sourceNode.loopEnd = window.start + window.length;
      // Looping nodes ignore start()'s duration in some implementations;
      // stop explicitly at the element's timeline end.
      sourceNode.start(startTime, window.start);
      sourceNode.stop(startTime + timelineCap);
    } else {
      sourceNode.start(startTime, window.start, bufferPlayDuration);
    }
    scheduledCount++;
  }

  if (scheduledCount === 0) return null;

  return ctx.startRendering();
}

function numberOr(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function numberOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function parseDuration(v: unknown, fallback: number): number {
  if (v === 'auto' || v === 'end' || v == null) return fallback;
  return numberOr(v, fallback);
}

function clampNonNeg(n: number): number {
  return n < 0 ? 0 : n;
}
