// Caption windowing — split a caption's words into CHUNKS, and pick the chunk
// active at a given time. Shared by the renderer (what to draw at time t) and
// the editor timeline (drawing chunk blocks) so they always agree.
//
//   max_length = number → max LETTERS per chunk (grow word-by-word until the
//                          next word would exceed the budget).
//   max_length = 'auto' → auto word-chunking (a few words; break on pauses).
//   max_length = absent → one chunk (the whole transcript shows at once).

import type { CaptionWord } from '@clipkit/protocol';

export interface CaptionChunk {
  words: CaptionWord[];
  /** Index of the chunk's first word within the element's `words`. */
  startIndex: number;
  /** Chunk time window (element-local seconds): first word start … last word end. */
  start: number;
  end: number;
}

// Defaults for 'auto' word-chunking.
const AUTO_MAX_WORDS = 6;
const AUTO_MAX_GAP = 0.6;
const AUTO_MAX_DURATION = 3;

export function chunkCaptionWords(
  words: readonly CaptionWord[],
  maxLength: number | 'auto' | undefined,
): CaptionChunk[] {
  if (words.length === 0) return [];

  const groups: CaptionWord[][] = [];
  if (maxLength === undefined) {
    groups.push([...words]);
  } else if (maxLength === 'auto') {
    let cur: CaptionWord[] = [];
    for (const w of words) {
      if (cur.length > 0) {
        const prev = cur[cur.length - 1]!;
        if (cur.length >= AUTO_MAX_WORDS || w.start - prev.end >= AUTO_MAX_GAP || w.end - cur[0]!.start > AUTO_MAX_DURATION) {
          groups.push(cur);
          cur = [];
        }
      }
      cur.push(w);
    }
    if (cur.length > 0) groups.push(cur);
  } else {
    // Character budget.
    let cur: CaptionWord[] = [];
    let chars = 0;
    for (const w of words) {
      const wlen = w.text.trim().length;
      const next = cur.length > 0 ? chars + 1 + wlen : wlen; // +1 for the space
      if (cur.length > 0 && next > maxLength) {
        groups.push(cur);
        cur = [];
        chars = 0;
      }
      chars = cur.length > 0 ? chars + 1 + wlen : wlen;
      cur.push(w);
    }
    if (cur.length > 0) groups.push(cur);
  }

  const chunks: CaptionChunk[] = [];
  let idx = 0;
  for (const g of groups) {
    chunks.push({ words: g, startIndex: idx, start: g[0]!.start, end: g[g.length - 1]!.end });
    idx += g.length;
  }
  return chunks;
}

/**
 * The chunk to show at element-local time `t`: the last chunk that has started
 * (so a chunk lingers through silent gaps until the next begins). Returns null
 * before the first chunk starts.
 */
export function activeCaptionChunk(chunks: readonly CaptionChunk[], t: number): CaptionChunk | null {
  let active: CaptionChunk | null = null;
  for (const c of chunks) {
    if (c.start <= t) active = c;
    else break;
  }
  return active;
}
