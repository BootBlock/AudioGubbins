/**
 * The capture processor's input as each quantum gives it (ADR-0070).
 *
 * The node's input takes exactly the input's channels, so a quantum's input
 * has them all, except where no source is connected or the source has stopped
 * giving audio: the browser then hands the processor no channels at all. Time
 * goes on regardless, so those frames are taken as silence, which keeps every
 * frame of a take at the context frame it was captured at, and they are
 * counted and reported, so a silence that was never captured is said rather
 * than passed off as the input's.
 */

import { channelCount, type ChannelLayout, type SampleRate } from '@audiogubbins/domain';

import { RENDER_QUANTUM_FRAMES } from '../processor/loaded-graph.js';

/** The input's shape, and its channels as the processor reads them. */
export class CaptureInput {
  readonly layout: ChannelLayout;
  readonly channels: number;
  readonly sampleRate: SampleRate;
  /** The quantum's channels, each the input's or silence, rebound every quantum. */
  readonly #dry: Float32Array[];
  /** A quantum of silence, made once, for a channel the input did not give. */
  readonly #silence = new Float32Array(RENDER_QUANTUM_FRAMES);
  #absent = 0;

  constructor(layout: ChannelLayout, sampleRate: SampleRate) {
    this.layout = layout;
    this.channels = channelCount(layout);
    this.sampleRate = sampleRate;
    this.#dry = new Array<Float32Array>(this.channels).fill(this.#silence);
  }

  /**
   * The quantum's channels from the node's `input`, a channel it lacks as
   * silence. The arrays are the browser's, read and never written.
   */
  dry(input: readonly Float32Array[]): readonly Float32Array[] {
    let absent = false;
    for (let channel = 0; channel < this.channels; channel += 1) {
      const given = input[channel];
      absent ||= given === undefined;
      this.#dry[channel] = given ?? this.#silence;
    }
    if (absent) this.#absent += RENDER_QUANTUM_FRAMES;
    return this.#dry;
  }

  /** The frames taken as silence since the last call, and none from then. */
  takeAbsent(): number {
    const absent = this.#absent;
    this.#absent = 0;
    return absent;
  }
}
