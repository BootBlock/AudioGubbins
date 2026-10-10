/**
 * A codec worker's decoded stream for the storage's tests (ADR-0090): a FLAC
 * file's first bytes, which recognition routes to a decode, a description of
 * its stream, blocks of a ramp, and a stream played from a list that records
 * what the storage told it.
 */

import { StandardLayouts, derivedSampleCount, type DomainFailure } from '@audiogubbins/domain';
import type { DecodedStreamDescription, DecodedStreamMessage } from '@audiogubbins/import-export';

import type { DecodedStream } from '../decoded-stream.js';

/** The first bytes of a FLAC file, which recognition names and the registry routes to a decode. */
export const FLAC_BYTES = (() => {
  const bytes = new Uint8Array(4_096);
  bytes.set([0x66, 0x4c, 0x61, 0x43, 0x00, 0x00, 0x00, 0x22]);
  for (let index = 8; index < bytes.length; index += 1) bytes[index] = (index * 7) & 0xff;
  return bytes;
})();

export const DESCRIPTION: DecodedStreamDescription = {
  codec: 'flac',
  sampleRate: 48_000,
  layout: StandardLayouts.stereo,
  statedFrames: derivedSampleCount(2_400),
  bitRate: 900_000,
  leadingFrames: derivedSampleCount(0),
  decoder: { implementation: 'codec-module', name: 'claxon', version: '0.4.3' },
  metadata: {
    text: { title: 'Rain on tin' },
    loops: [
      {
        start: derivedSampleCount(600),
        length: derivedSampleCount(1_200),
        playCount: 'endless',
        direction: 'forward',
        name: 'Body',
      },
    ],
    cues: [{ position: derivedSampleCount(300), name: 'Drip' }],
  },
};

/** A planar block of `frames` frames of the test's ramp, from frame `from`. */
export function block(from: number, frames: number): DecodedStreamMessage {
  const channels = [0, 1].map((channel) =>
    Float32Array.from(
      { length: frames },
      (_, index) => ((from + index) % 997) / 1_000 - channel / 4,
    ),
  );
  return { kind: 'block', channels, frames };
}

/** The stream of a whole decode: the description, the blocks, and the end. */
export function wholeStream(
  description: DecodedStreamDescription = DESCRIPTION,
): readonly DecodedStreamMessage[] {
  return [
    { kind: 'description', description },
    block(0, 1_000),
    block(1_000, 1_400),
    { kind: 'end', frames: derivedSampleCount(2_400) },
  ];
}

/** A codec worker's stream played from a list, recording what the storage told it. */
export class FakeStream implements DecodedStream {
  readonly refusals: DomainFailure[] = [];
  read = 0;
  closed = false;
  readonly #messages: readonly DecodedStreamMessage[];
  readonly #onRead: (read: number) => void;

  constructor(
    messages: readonly DecodedStreamMessage[],
    onRead: (read: number) => void = () => undefined,
  ) {
    this.#messages = messages;
    this.#onRead = onRead;
  }

  next(): Promise<DecodedStreamMessage | undefined> {
    if (this.closed) return Promise.resolve(undefined);
    const message = this.#messages[this.read];
    this.read += 1;
    this.#onRead(this.read);
    return Promise.resolve(message);
  }

  refuse(failure: DomainFailure): void {
    this.refusals.push(failure);
    this.closed = true;
  }

  close(): void {
    this.closed = true;
  }
}
