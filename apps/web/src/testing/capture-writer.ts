/**
 * The capture processor's end of a take, as a test drives it: the replies the
 * processor gives the page as a take begins and stops, and the blocks it posts
 * on the capture channel, which the storage worker reads.
 */

import { FromCaptureKind } from '@audiogubbins/audio-runtime';

import type { FakeCapture } from './recording-fakes.js';

/** The capture's latest take, begun on `firstFrame`, written by a test. */
export class CaptureWriter {
  readonly #capture: FakeCapture;
  readonly #port: MessagePort;
  readonly #rate: number;
  readonly #channels: number;
  #frame: number;

  /** The latest take `capture` was asked for, its first frame `firstFrame`. */
  constructor(capture: FakeCapture, firstFrame: number, rate = 48_000, channels = 2) {
    const port = capture.channels.at(-1);
    if (port === undefined) throw new Error('The capture was asked for no take.');
    this.#capture = capture;
    this.#port = port;
    this.#rate = rate;
    this.#channels = channels;
    this.#frame = firstFrame;
  }

  /**
   * The take begins: the channel says so, and the processor tells the page
   * which frame is the take's first, `retrospective` frames before Record's.
   */
  begin(retrospective = 0): void {
    this.#port.postMessage({
      kind: 'begin',
      frame: this.#frame,
      sampleRate: this.#rate,
      channels: this.#channels,
      transport: 'posted',
    });
    this.#capture.say({
      kind: FromCaptureKind.Recording,
      firstFrame: this.#frame,
      startFrame: this.#frame + retrospective,
      retrospectiveFrames: retrospective,
    });
  }

  /** Posts `frames` frames, every sample of channel `c` at frame `f` given by `sample`. */
  post(frames: number, sample: (channel: number, frame: number) => number): void {
    for (let from = 0; from < frames; from += 4_096) {
      const length = Math.min(4_096, frames - from);
      const block = Array.from({ length: this.#channels }, (_, channel) =>
        Float32Array.from({ length }, (_unused, index) => sample(channel, from + index)),
      );
      this.#port.postMessage(
        { kind: 'block', frame: this.#frame, channels: block },
        block.map((channel) => channel.buffer),
      );
      this.#frame += length;
    }
  }

  /** The take ended: the channel says so, and the processor tells the page. */
  end(): void {
    this.#port.postMessage({ kind: 'end', frame: this.#frame, reason: 'stopped' });
    this.#capture.say({
      kind: FromCaptureKind.Stopped,
      endFrame: this.#frame,
      reason: 'stopped',
    });
  }
}
