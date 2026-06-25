// TransportClock — the composition playhead.
//
// The clock represents *composition time* — "where is the playhead in
// this Source?". Its underlying time source is `AudioContext.currentTime`
// because that's the highest-precision monotonic clock the browser
// exposes (sample-accurate, audio-thread-priority, doesn't drift).
//
// The AudioContext is treated as a clock substrate, not as "the audio
// player". A composition with zero `audio` elements still uses the
// same context as its clock source — it just doesn't schedule any
// audio sources on it. See SPRINT.md § "Audio is just an element".
//
// Internal model:
//   - When PAUSED:  `now()` returns `#anchorPosition` (the held position).
//   - When PLAYING: `now()` returns
//                   `#anchorPosition + (ctx.currentTime - #anchorCtxTime)`.
//
// Every transition (play / pause / seek) re-anchors the pair so the
// linear mapping above stays correct without per-tick state.

import type { Unsubscribe } from './types.js';

/**
 * Snapshot of the clock's current state. Delivered to subscribers on
 * any state change (play / pause / seek). `position` is the composition
 * time at the moment of the change — not the live playhead. Use
 * `clock.now()` for the live value.
 */
export interface ClockState {
  playing: boolean;
  position: number;
}

export class TransportClock {
  readonly #ctx: AudioContext;
  #playing = false;
  #anchorPosition: number;
  #anchorCtxTime = 0;
  readonly #listeners = new Set<(state: ClockState) => void>();
  #disposed = false;

  /**
   * @param audioContext  The precision time source. The clock does not
   *                      own the context — the caller is responsible for
   *                      its lifecycle.
   * @param initialTime   Composition time to start at, in seconds.
   *                      Default `0`. Clamped to `>= 0`.
   */
  constructor(audioContext: AudioContext, initialTime = 0) {
    this.#ctx = audioContext;
    this.#anchorPosition = Math.max(0, initialTime);
  }

  /** True while the playhead is advancing. */
  get playing(): boolean {
    return this.#playing;
  }

  /**
   * Current composition time, in seconds. Computed on demand from the
   * AudioContext clock — call any time, get the live value. Returns the
   * last held position when paused.
   */
  now(): number {
    if (!this.#playing) return this.#anchorPosition;
    return this.#anchorPosition + (this.#ctx.currentTime - this.#anchorCtxTime);
  }

  /**
   * Resume advancing the playhead from its current position. No-op if
   * already playing or disposed. Resumes the AudioContext if needed —
   * some browsers start it suspended until a user gesture.
   *
   * Resolves once the state has been broadcast to subscribers; awaiting
   * `play()` guarantees `playing === true` is visible to listeners.
   */
  async play(): Promise<void> {
    if (this.#disposed) throw new Error('TransportClock is disposed');
    if (this.#playing) return;
    if (this.#ctx.state === 'suspended') {
      await this.#ctx.resume();
    }
    // Re-check after the await — disposed / paused could have changed.
    if (this.#disposed) return;
    if (this.#playing) return;
    this.#anchorCtxTime = this.#ctx.currentTime;
    this.#playing = true;
    this.#notify();
  }

  /**
   * Stop advancing. The playhead holds at the current position.
   * No-op if already paused or disposed.
   */
  pause(): void {
    if (this.#disposed) return;
    if (!this.#playing) return;
    // Snapshot the live position *before* flipping the playing flag —
    // `now()` reads it via the playing-branch formula.
    this.#anchorPosition = this.now();
    this.#playing = false;
    this.#notify();
  }

  /**
   * Jump the playhead to `time` (seconds, clamped to `>= 0`). Preserves
   * play / pause state. Notifies subscribers so consumers tied to the
   * old position (frame buffer, audio sources) can invalidate.
   */
  seek(time: number): void {
    if (this.#disposed) return;
    this.#anchorPosition = Math.max(0, time);
    if (this.#playing) {
      // Re-anchor so the playing-branch formula continues from `time`.
      this.#anchorCtxTime = this.#ctx.currentTime;
    }
    this.#notify();
  }

  /**
   * Subscribe to state changes. Fires once immediately with the current
   * state, then again on every play / pause / seek. Returns an unsubscribe
   * function. Listener exceptions are caught and logged, never propagated
   * back to the caller of `play / pause / seek`.
   */
  subscribe(listener: (state: ClockState) => void): Unsubscribe {
    if (this.#disposed) return () => {};
    this.#listeners.add(listener);
    this.#deliver(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /**
   * Detach all subscribers and mark the clock disposed. Does not close
   * the AudioContext (the caller owns its lifecycle). Idempotent.
   */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#playing = false;
    this.#listeners.clear();
  }

  // ── Internal ────────────────────────────────────────────────────────

  #notify(): void {
    const state: ClockState = {
      playing: this.#playing,
      position: this.now(),
    };
    for (const listener of this.#listeners) {
      this.#deliverState(listener, state);
    }
  }

  #deliver(listener: (state: ClockState) => void): void {
    this.#deliverState(listener, {
      playing: this.#playing,
      position: this.now(),
    });
  }

  #deliverState(
    listener: (state: ClockState) => void,
    state: ClockState,
  ): void {
    try {
      listener(state);
    } catch (err) {
      // One buggy subscriber shouldn't break the clock for other
      // subscribers or for the caller of play/pause/seek.
      // eslint-disable-next-line no-console
      console.error('[TransportClock] subscriber threw:', err);
    }
  }
}
