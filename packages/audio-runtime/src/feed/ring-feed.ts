/**
 * A graph input's audio read from a ring the feeder worker writes, where
 * memory can be shared.
 *
 * The quickest way audio crosses into the worklet: no message per block, and
 * nothing allocated to read one. The ring's reader is taken once, when the
 * graph is loaded, and read in place each quantum.
 */

import type { ChannelLayout } from '@audiogubbins/domain';
import type { AudioFrameBlock } from '@audiogubbins/audio-engine';

import { FillTally, type ProcessorFeed } from './processor-feed.js';
import type { RingReader } from './sample-ring.js';

/** A feed over the reader of a ring, whose channels are the layout's. */
export class RingFeed implements ProcessorFeed {
  readonly layout: ChannelLayout;
  readonly #reader: RingReader;
  readonly #tally = new FillTally();

  constructor(reader: RingReader, layout: ChannelLayout) {
    this.#reader = reader;
    this.layout = layout;
  }

  get suppliedFrames(): number {
    return this.#tally.suppliedFrames;
  }

  get finished(): boolean {
    return this.#tally.finished;
  }

  ready(frames: number): boolean {
    return this.#reader.ready(frames);
  }

  fill(into: AudioFrameBlock): number {
    const got = this.#reader.read(into);
    this.#tally.record(into.frames, got, this.#reader.ended);
    return got;
  }

  beginQuantum(): void {
    this.#tally.beginQuantum();
  }

  clear(): void {
    this.#reader.clear();
    this.#tally.clear();
  }
}
