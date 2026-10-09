/**
 * A mix a segment reads (ADR-0072): the sample-wise sum of the same frames of
 * two or more later streams of the plan, added in the order the mix states by
 * the domain's one rule for it (`sumInto`), so the engine sounds a punch's
 * crossfades to the same bits as the edit oracle.
 *
 * The plan's validation has already made every mixed stream one of the
 * reading stream's rate and of one layout, so each is read as it is, with no
 * conversion.
 */

import { sumInto, throwIfCancelled, type CancellationSignal } from '@audiogubbins/domain';

import type { ReadableContent } from './plan-content.js';

/** Two or more streams of one rate and layout, read over the same frames and summed in order. */
export class MixedContent implements ReadableContent {
  readonly channels: number;
  readonly #first: ReadableContent;
  readonly #rest: readonly ReadableContent[];
  /** Where each later stream is read before it is added, kept between reads. */
  #scratch: readonly Float32Array[] = [];

  constructor(first: ReadableContent, rest: readonly ReadableContent[]) {
    this.#first = first;
    this.#rest = rest;
    this.channels = first.channels;
  }

  async read(
    start: number,
    frames: number,
    into: readonly Float32Array[],
    signal?: CancellationSignal,
  ): Promise<void> {
    // The first stream's samples are the sum's start as they are, so it is
    // read straight into place and only the later ones need room of their own.
    await this.#first.read(start, frames, into, signal);
    const addend = this.#scratchFor(frames);
    for (const stream of this.#rest) {
      throwIfCancelled(signal);
      await stream.read(start, frames, addend, signal);
      sumInto(into, addend, frames);
    }
  }

  /** Arrays for up to `frames` frames of every channel, grown only when a read needs more. */
  #scratchFor(frames: number): readonly Float32Array[] {
    if ((this.#scratch[0]?.length ?? 0) < frames) {
      this.#scratch = Array.from({ length: this.channels }, () => new Float32Array(frames));
    }
    return this.#scratch.map((array) => array.subarray(0, frames));
  }
}
