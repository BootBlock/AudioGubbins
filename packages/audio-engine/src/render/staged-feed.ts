/**
 * A graph input's audio in an offline render, read ahead one chunk at a time.
 *
 * A source reads asynchronously, from storage or a decoder, and a kernel may
 * not wait. So before each chunk the renderer stages the chunk's frames of
 * every source, awaiting each read, and the executor's graph inputs then take
 * them without waiting. Only one chunk of each source is ever held, whatever
 * the length of the render (REQ-PROD-009).
 */

import {
  addSamples,
  flatMapResult,
  sampleCount,
  type ChannelLayout,
  type SampleCount,
} from '@audiogubbins/domain';

import type { CancellationSignal } from '../cancellation.js';
import type { InputFeed } from '../nodes/node-implementation.js';
import { allocateBlock, blockView, type AudioFrameBlock } from '../pcm/frame-block.js';
import type { PcmSource } from '../pcm/pcm-source.js';

/** A source's frames for the chunk being rendered. */
export class StagedFeed implements InputFeed {
  readonly #source: PcmSource;
  readonly #start: SampleCount;
  readonly #staging: AudioFrameBlock;
  #staged = 0;
  #given = 0;

  /** A feed of `source` from `start`, staging at most `chunkFrames` frames at a time. */
  constructor(source: PcmSource, start: SampleCount, chunkFrames: number) {
    this.#source = source;
    this.#start = start;
    this.#staging = allocateBlock(source.layout, source.sampleRate, chunkFrames);
  }

  get layout(): ChannelLayout {
    return this.#source.layout;
  }

  /** Reads the `frames` frames from `position`, counted from the start of the render. */
  async stage(position: number, frames: number, signal?: CancellationSignal): Promise<void> {
    const from = flatMapResult(sampleCount(position), (offset) => addSamples(this.#start, offset));
    // The renderer counts whole frames it has already sized the render by.
    if (!from.ok) throw new Error(from.failures[0].summary);
    const past = this.#source.length !== undefined && from.value >= this.#source.length;
    this.#staged = past
      ? 0
      : await this.#source.read(from.value, blockView(this.#staging, 0, frames), signal);
    this.#given = 0;
  }

  fill(into: AudioFrameBlock): number {
    const count = Math.max(0, Math.min(into.frames, this.#staged - this.#given));
    this.#staging.channels.forEach((channel, index) => {
      into.channels[index]?.set(channel.subarray(this.#given, this.#given + count));
    });
    this.#given += count;
    return count;
  }
}
