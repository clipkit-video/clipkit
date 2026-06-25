// The protocol bridge — the ONE place transcription meets the Clipkit protocol.
//
// A `caption` element's `words` are `{ text, start, end }` with start/end in
// seconds RELATIVE TO THE ELEMENT'S `time` (PROTOCOL.md §5.x). Transcript words
// are absolute in the source audio, so mapping is: subtract the element's start
// offset, clamp to ≥ 0 (the schema requires nonnegative), drop empties.
//
// This file imports only the protocol's `CaptionWord` type — no model, no audio.
// It's pure and the part that's verified against the schema.

import type { CaptionWord } from '@clipkit/protocol';
import type { TranscriptResult, TranscriptWord } from './types.js';

export interface ToCaptionWordsOptions {
  /**
   * Seconds of source audio that the caption element's `time` corresponds to —
   * i.e. where the element starts on the timeline, in the audio's clock. Word
   * timings are shifted by `-offset` so they read relative to the element.
   * Default 0 (the caption element starts at the audio's start).
   */
  offset?: number;
  /** Drop words shorter than this many seconds (model noise). Default 0. */
  minDuration?: number;
}

/** Map a transcript's words onto a `caption` element's `words[]` (§ protocol). */
export function toCaptionWords(
  result: TranscriptResult,
  options: ToCaptionWordsOptions = {},
): CaptionWord[] {
  const { offset = 0, minDuration = 0 } = options;
  const out: CaptionWord[] = [];
  for (const w of result.words) {
    const text = w.text.trim();
    if (!text) continue;
    const start = Math.max(0, w.start - offset);
    const end = Math.max(start, w.end - offset);
    if (end - start < minDuration) continue;
    out.push({ text, start, end });
  }
  return out;
}

/** Convenience: the full caption-element fields ready to spread into an element. */
export function toCaptionFields(
  result: TranscriptResult,
  options: ToCaptionWordsOptions = {},
): { type: 'caption'; words: CaptionWord[] } {
  return { type: 'caption', words: toCaptionWords(result, options) };
}

/** One caption-sized phrase: where it starts in the audio, plus its words. */
export interface CaptionSegment {
  /** Absolute start of the segment in the source audio (seconds). */
  start: number;
  /** Words, times RELATIVE to this segment's `start` (ready for a caption element). */
  words: CaptionWord[];
}

export interface ToCaptionSegmentsOptions {
  /** Max words per segment. Default 6. */
  maxWords?: number;
  /** A silent gap (seconds) between words at/above this starts a new segment. Default 0.6. */
  maxGap?: number;
  /** Max segment duration (seconds) before forcing a break. Default 3. */
  maxDuration?: number;
}

/**
 * Group timed words into caption-sized PHRASES. A new phrase starts when the
 * current one hits `maxWords`, a silent gap ≥ `maxGap` opens, or it exceeds
 * `maxDuration`. Pure and generic — the single source of truth for "how big is
 * a caption segment," shared by transcription and the editor's manual split.
 */
export function segmentWords<T extends { start: number; end: number }>(
  words: readonly T[],
  options: ToCaptionSegmentsOptions = {},
): T[][] {
  const { maxWords = 6, maxGap = 0.6, maxDuration = 3 } = options;
  const groups: T[][] = [];
  let cur: T[] = [];
  const flush = (): void => { if (cur.length > 0) groups.push(cur); cur = []; };
  for (const w of words) {
    if (cur.length > 0) {
      const prev = cur[cur.length - 1]!;
      if (cur.length >= maxWords || w.start - prev.end >= maxGap || w.end - cur[0]!.start > maxDuration) flush();
    }
    cur.push(w);
  }
  flush();
  return groups;
}

/**
 * Split a transcript into caption-sized PHRASES — one `caption` element each.
 * A whole-video transcript renders as an unreadable single line; segmenting it
 * into short phrases is how real auto-captions display. Each segment's words are
 * rebased to its own `start`, ready to drop into a `caption` element at
 * `time = mediaStart + segment.start`.
 */
export function toCaptionSegments(
  result: TranscriptResult,
  options: ToCaptionSegmentsOptions = {},
): CaptionSegment[] {
  const words = result.words.filter((w) => w.text.trim().length > 0);
  return segmentWords(words, options).map((group) => {
    const base = group[0]!.start;
    return {
      start: base,
      words: group.map((w) => ({ text: w.text.trim(), start: Math.max(0, w.start - base), end: Math.max(0, w.end - base) })),
    };
  });
}

export type { TranscriptResult, TranscriptWord };
