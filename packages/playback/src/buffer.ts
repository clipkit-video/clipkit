// FrameBuffer — bounded sorted collection of VideoFrames.
//
// Holds frames received from the worker, indexed by composition time.
// The presenter calls `peekAt(time)` to get the frame to draw; the
// engine periodically calls `prune(time)` to evict frames behind the
// playhead and `setSequenceId(n)` to invalidate everything after a
// seek / setSource.
//
// ─── VideoFrame.close() discipline (best practice from SPRINT.md) ───
// VideoFrames hold GPU memory until close()'d. Every pathway that
// drops a frame from this buffer calls close() exactly once:
//   - Capacity overflow → close the evicted frame
//   - Stale sequence ID at push → close immediately, don't insert
//   - Stale sequence ID at setSequenceId → close all existing
//   - prune() → close all frames before the cutoff
//   - clear() / dispose() → close everything
// Consumers of peekAt() never close — the buffer owns the frame; the
// consumer just reads its pixels.

interface BufferedFrame {
  time: number;
  frame: VideoFrame;
  sequenceId: number;
}

export class FrameBuffer {
  readonly #capacity: number;
  #frames: BufferedFrame[] = [];
  #currentSequenceId = 0;

  /**
   * @param capacity Maximum number of frames held. When pushing a new
   *                 frame would exceed this, the earliest frame is
   *                 closed and dropped.
   */
  constructor(capacity: number) {
    if (capacity <= 0) throw new Error('FrameBuffer capacity must be > 0');
    this.#capacity = capacity;
  }

  /** Current capacity. Fixed at construction. */
  get capacity(): number {
    return this.#capacity;
  }

  /** Current number of buffered frames. */
  get size(): number {
    return this.#frames.length;
  }

  /** Active sequence ID. Frames pushed with a different ID are closed + dropped. */
  get sequenceId(): number {
    return this.#currentSequenceId;
  }

  /**
   * Advance the sequence ID — closes and drops any buffered frames whose
   * ID doesn't match. Called after seek / setSource so stale in-flight
   * frames from the worker land into a freshly-invalidated buffer.
   */
  setSequenceId(id: number): void {
    this.#currentSequenceId = id;
    const kept: BufferedFrame[] = [];
    for (const f of this.#frames) {
      if (f.sequenceId === id) {
        kept.push(f);
      } else {
        f.frame.close();
      }
    }
    this.#frames = kept;
  }

  /**
   * Insert a frame (sorted by time). If `sequenceId` doesn't match the
   * current, the frame is closed and dropped immediately. If capacity
   * is exceeded, the earliest buffered frame is closed and dropped.
   */
  push(time: number, frame: VideoFrame, sequenceId: number): void {
    if (sequenceId !== this.#currentSequenceId) {
      frame.close();
      return;
    }
    const entry: BufferedFrame = { time, frame, sequenceId };
    // Insert sorted. List is small (cap is ~30); linear scan beats binary.
    let inserted = false;
    for (let i = 0; i < this.#frames.length; i++) {
      if (this.#frames[i]!.time > time) {
        this.#frames.splice(i, 0, entry);
        inserted = true;
        break;
      }
    }
    if (!inserted) this.#frames.push(entry);

    while (this.#frames.length > this.#capacity) {
      const evicted = this.#frames.shift();
      evicted?.frame.close();
    }
  }

  /**
   * Return the frame whose time is the latest `<= time`. Caller must
   * not close it — the buffer owns it. Returns null if no buffered
   * frame qualifies (buffer empty, or playhead is before all frames).
   */
  peekAt(time: number): VideoFrame | null {
    for (let i = this.#frames.length - 1; i >= 0; i--) {
      if (this.#frames[i]!.time <= time) {
        return this.#frames[i]!.frame;
      }
    }
    return null;
  }

  /**
   * Seconds of frames currently buffered ahead of `time`. Zero if the
   * buffer is empty or the playhead is past the latest frame.
   */
  aheadSec(time: number): number {
    if (this.#frames.length === 0) return 0;
    const lastTime = this.#frames[this.#frames.length - 1]!.time;
    return Math.max(0, lastTime - time);
  }

  /**
   * Close and drop every frame whose time is strictly before
   * `targetTime - keepBackSec`. The keepBack window holds a small
   * tail in case the presenter's wall clock drifts slightly behind
   * the requested playhead.
   */
  prune(targetTime: number, keepBackSec = 0.05): void {
    const cutoff = targetTime - keepBackSec;
    while (this.#frames.length > 0 && this.#frames[0]!.time < cutoff) {
      const evicted = this.#frames.shift();
      evicted?.frame.close();
    }
  }

  /** Close and drop every frame. The buffer is empty but still usable. */
  clear(): void {
    for (const f of this.#frames) f.frame.close();
    this.#frames = [];
  }

  /** Same as clear(); reserved for symmetry with other engine components. */
  dispose(): void {
    this.clear();
  }
}
