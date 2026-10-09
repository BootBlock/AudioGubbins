/**
 * What a loopback calibration captured, read from its capture channel
 * (`REQ-REC-095`).
 *
 * The capture starts before the signal is played, and the frame the signal
 * left the engine at is known only once playback has started, so the blocks
 * are held as they arrive, by the context frame each begins at, until the
 * frames from that one onwards are in. It is a measurement of a second or so,
 * not a recording: the page holds it, bounded, and lets it go once measured. A
 * gap or a capture that ends early refuses the measurement, since a round trip
 * read across lost frames would be wrong by their number.
 */

import { FailureKind, fail, failure, succeed, type DomainResult } from '@audiogubbins/domain';
import type { CaptureEvent } from '@audiogubbins/audio-runtime';

/** A block of the capture, at the context frame it begins at. */
interface Block {
  readonly frame: number;
  readonly channels: readonly Float32Array[];
}

/** What is waited for: the frames from `from` for `length`, and who waits. */
interface Wanted {
  readonly from: number;
  readonly length: number;
  readonly answer: (result: DomainResult<readonly Float32Array[]>) => void;
}

function refused(code: string, summary: string): DomainResult<never> {
  return fail(failure(`recording.${code}`, FailureKind.Rejected, summary));
}

/** The frames of each channel of `blocks` from `from` for `length`. */
function framesOf(blocks: readonly Block[], from: number, length: number): readonly Float32Array[] {
  const channels = (blocks[0]?.channels ?? []).map(() => new Float32Array(length));
  for (const block of blocks) {
    const start = Math.max(from, block.frame);
    const end = Math.min(from + length, block.frame + (block.channels[0]?.length ?? 0));
    if (end <= start) continue;
    block.channels.forEach((samples, channel) => {
      channels[channel]?.set(
        samples.subarray(start - block.frame, end - block.frame),
        start - from,
      );
    });
  }
  return channels;
}

/** Holds a calibration's capture until the frames it measures are in. */
export class LoopbackCapture {
  readonly #mostFrames: number;
  readonly #blocks: Block[] = [];
  #heldFrames = 0;
  /** The frame after the last that arrived. */
  #reached = 0;
  #first: number | undefined;
  #problem: DomainResult<never> | undefined;
  #wanted: Wanted | undefined;

  /**
   * Reads `events` until they end, holding at most `mostFrames` frames: past
   * them the signal is taken as never having been played.
   */
  constructor(events: AsyncIterable<CaptureEvent>, mostFrames: number) {
    this.#mostFrames = mostFrames;
    void this.#read(events);
  }

  /** The frames of each channel from context frame `from`, `length` of them, once in; or why not. */
  framesFrom(from: number, length: number): Promise<DomainResult<readonly Float32Array[]>> {
    return new Promise((answer) => {
      this.#wanted = { from, length, answer };
      this.#forgetBefore(from);
      this.#settle();
    });
  }

  async #read(events: AsyncIterable<CaptureEvent>): Promise<void> {
    for await (const event of events) {
      this.#take(event);
      this.#settle();
      if (this.#problem !== undefined) return;
    }
    this.#problem ??= refused(
      'loopback-ended',
      'The capture ended before the calibration signal was heard back.',
    );
    this.#settle();
  }

  #take(event: CaptureEvent): void {
    switch (event.kind) {
      case 'begin':
        this.#first = event.frame;
        this.#reached = event.frame;
        return;
      case 'block': {
        const length = event.channels[0]?.length ?? 0;
        this.#blocks.push({ frame: event.frame, channels: event.channels });
        this.#heldFrames += length;
        this.#reached = event.frame + length;
        this.#forgetBefore(this.#wanted?.from);
        if (this.#heldFrames > this.#mostFrames) {
          this.#problem = refused(
            'loopback-signal-late',
            'The calibration signal did not start playing in time, so nothing could be measured.',
          );
        }
        return;
      }
      case 'gap':
        this.#problem = refused(
          'loopback-gap',
          'Part of the capture was lost while measuring, so the measurement would be wrong. Measure again.',
        );
        return;
      case 'end':
        this.#problem = refused(
          'loopback-ended',
          event.reason === 'failed'
            ? `The capture failed before the calibration signal was heard back: ${event.summary}`
            : 'The capture ended before the calibration signal was heard back.',
        );
        return;
    }
  }

  /** Lets go of the blocks that end before `from`, which no measurement reads. */
  #forgetBefore(from: number | undefined): void {
    if (from === undefined) return;
    while (this.#blocks.length > 0) {
      const block = this.#blocks[0];
      const length = block?.channels[0]?.length ?? 0;
      if (block === undefined || block.frame + length > from) return;
      this.#blocks.shift();
      this.#heldFrames -= length;
    }
  }

  /** Answers whoever waits, once their frames are in or the capture cannot give them. */
  #settle(): void {
    const wanted = this.#wanted;
    if (wanted === undefined) return;
    if (this.#first !== undefined && this.#first > wanted.from) {
      this.#answer(
        wanted,
        refused(
          'loopback-capture-late',
          'The capture began after the calibration signal was played, so the round trip cannot be measured. Measure again.',
        ),
      );
    } else if (this.#reached >= wanted.from + wanted.length) {
      this.#answer(wanted, succeed(framesOf(this.#blocks, wanted.from, wanted.length)));
    } else if (this.#problem !== undefined) {
      this.#answer(wanted, this.#problem);
    }
  }

  #answer(wanted: Wanted, result: DomainResult<readonly Float32Array[]>): void {
    this.#wanted = undefined;
    this.#blocks.length = 0;
    this.#heldFrames = 0;
    wanted.answer(result);
  }
}
