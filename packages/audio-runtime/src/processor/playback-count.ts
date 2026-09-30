/**
 * Where playback is, counted on the audio thread: the timeline frame that
 * has left the graph and reached the output.
 *
 * Only the audio thread can know it. The main thread's clock lags the audio
 * thread, and cannot see an underrun, which delays the audio and not the
 * context's clock. So the processor counts the frames it has run through the
 * graph since the audio began, at timeline frame `base`: a quantum an
 * underrun leaves unrun counts nothing. A frame fed in reaches the output the
 * graph's latency later, so the count is the frames run less the latency,
 * never negative, and once every feed has ended it stops at the last frame
 * they supplied, which reached the output as many frames ago as the graph has
 * run on since.
 */

import type { CountedPosition } from '../protocol/processor-messages.js';

/** The count of one stream of audio, from where it begins. */
export class PlaybackCount {
  /** The timeline frame the audio begins at. */
  #base = 0;

  /** The frames the graph has run since the audio began. */
  #processed = 0;

  /** The most frames any feed supplied in each quantum run, summed. */
  #supplied = 0;

  /** Counts afresh, from audio beginning at timeline frame `base`. */
  restart(base: number): void {
    this.#base = base;
    this.#processed = 0;
    this.#supplied = 0;
  }

  /** Counts a quantum of `frames` frames run through the graph, the feeds having supplied `supplied`. */
  ran(frames: number, supplied: number): void {
    this.#processed += frames;
    this.#supplied += supplied;
  }

  /**
   * Whether the last frame the feeds supplied has left a graph of `latency`
   * frames, once every feed has ended.
   */
  heardEnd(latency: number): boolean {
    return this.#processed - latency >= this.#supplied;
  }

  /**
   * Where playback is, with the next quantum at context frame `nextFrame`:
   * the timeline frame that reaches the output then, or, while the audio's
   * first frame is still passing through the graph's `latency`, that first
   * frame and the context frame it arrives at. `ended` says every feed has
   * ended, which stops the count at their last frame.
   */
  at(nextFrame: number, latency: number, ended: boolean): CountedPosition {
    const out = this.#processed - latency;
    if (out < 0) return { contextFrame: nextFrame - out, position: this.#base };
    const heard = ended ? Math.min(out, this.#supplied) : out;
    return { contextFrame: nextFrame - (out - heard), position: this.#base + heard };
  }
}
