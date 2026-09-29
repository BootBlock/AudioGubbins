/**
 * Phase correlation: Pearson's correlation of pairs of channels over a block.
 *
 * REQ-ARCH-157 asks for phase and correlation analysis. A reading of 1 is two
 * channels in phase, -1 one the inverse of the other, and 0 no relation, which
 * is also what a pair with a silent channel reads, since a channel that does
 * not vary correlates with nothing. The arithmetic is in f64 in a stated order
 * (ADR-0032), so a reading is the same number on every machine: each
 * channel's mean is summed in frame order and divided once; its deviations
 * from the mean, and their squares summed in frame order, are found once
 * however many pairs it is in; each pair's products of deviations are summed
 * in frame order; and the reading is that sum divided by the root of the
 * product of the two sums of squares, held to [-1, 1] against rounding.
 *
 * It runs on the audio thread, so every array it needs is made when it is.
 */

import type { AudioFrameBlock } from '../pcm/frame-block.js';
import { channelAt } from './kernel-ports.js';

/** The slot of a channel no pair names. */
const UNUSED = -1;

/** The correlation of named pairs of a layout's channels. */
export class PairCorrelation {
  /** The pairs, flat: pair `p` is channels `pairs[2p]` and `pairs[2p + 1]`. */
  readonly #pairs: Int32Array;

  /** The channels any pair names, in layout order, each measured once. */
  readonly #measured: Int32Array;

  /** Each channel's place among the measured, or {@link UNUSED}. */
  readonly #slotOf: Int32Array;

  /** The deviations of each measured channel from its mean, a block per slot. */
  readonly #deviations: Float64Array;

  /** The sum of the squared deviations of each measured channel. */
  readonly #squares: Float64Array;
  readonly #blockFrames: number;

  /** Correlates `pairs`, flat, of a layout of `channels` channels, over blocks of at most `blockFrames`. */
  constructor(pairs: readonly number[], channels: number, blockFrames: number) {
    this.#pairs = Int32Array.from(pairs);
    const named = new Set(pairs);
    const measured = Array.from({ length: channels }, (_, channel) => channel).filter((channel) =>
      named.has(channel),
    );
    this.#slotOf = new Int32Array(channels).fill(UNUSED);
    measured.forEach((channel, slot) => {
      this.#slotOf[channel] = slot;
    });
    this.#measured = Int32Array.from(measured);
    this.#blockFrames = blockFrames;
    this.#deviations = new Float64Array(measured.length * blockFrames);
    this.#squares = new Float64Array(measured.length);
  }

  /** Writes the correlation of each pair over the first `frames` frames of `block` into `into`, in pair order. */
  measure(block: AudioFrameBlock, frames: number, into: number[]): void {
    const pairs = this.#pairs;
    const deviations = this.#deviations;
    const squares = this.#squares;
    const stride = this.#blockFrames;
    if (frames === 0) {
      // An empty block has no mean, and so no correlation to read.
      for (let pair = 0; pair * 2 < pairs.length; pair += 1) into[pair] = 0;
      return;
    }
    for (let slot = 0; slot < this.#measured.length; slot += 1) {
      const samples = channelAt(block, this.#measured[slot] ?? 0);
      let sum = 0;
      for (let frame = 0; frame < frames; frame += 1) sum += samples[frame] ?? 0;
      const mean = sum / frames;
      const offset = slot * stride;
      let squared = 0;
      for (let frame = 0; frame < frames; frame += 1) {
        const deviation = (samples[frame] ?? 0) - mean;
        deviations[offset + frame] = deviation;
        squared += deviation * deviation;
      }
      squares[slot] = squared;
    }
    for (let pair = 0; pair * 2 < pairs.length; pair += 1) {
      const first = this.#slotOf[pairs[pair * 2] ?? 0] ?? 0;
      const second = this.#slotOf[pairs[pair * 2 + 1] ?? 0] ?? 0;
      const firstOffset = first * stride;
      const secondOffset = second * stride;
      let cross = 0;
      for (let frame = 0; frame < frames; frame += 1) {
        cross += (deviations[firstOffset + frame] ?? 0) * (deviations[secondOffset + frame] ?? 0);
      }
      const spread = Math.sqrt((squares[first] ?? 0) * (squares[second] ?? 0));
      into[pair] = spread === 0 ? 0 : Math.min(1, Math.max(-1, cross / spread));
    }
  }
}
