/**
 * The sound of a reference picture, decoded by the codec worker (ADR-0090) as
 * an import is: the file read where it lies, block by block, by the codecs
 * that serve its format here, at its own rate and in its own channels, never
 * by a browser decoder the codecs do not choose and never read whole.
 *
 * The page reads the decoded stream over a channel of its own, with credit, so
 * at most a few blocks wait unread, and keeps each block as it arrives: the
 * sound is the session's asset, which no storage keeps. The stream must be the
 * one the file's analysis described, at its rate and in its channels, and is
 * refused where it is not, or where it runs past the frames the page can hold.
 * The decode's own answer ends the reading where the worker ended the request
 * without its stream, as a worker that faulted does, so the page never waits
 * on a stream that will not come.
 */

import { CreditedReceiver, type AnalysedStream } from '@audiogubbins/codec-runtime';
import {
  FailureKind,
  failure,
  layoutsMatch,
  type DomainFailure,
  type DomainResult,
} from '@audiogubbins/domain';
import { readDecodedStreamMessage, type DecodedStreamMessage } from '@audiogubbins/import-export';

import type { CodecServices, DecodedFile } from '../codecs/codec-services.js';
import type { DecodeSound, DecodedSound } from './picture-sound.js';

/** The blocks asked for and not yet read: each at most 1 MiB (the worker's bound). */
const CREDIT_WINDOW = 4;

/** The stream decoded is not the one the file's analysis described. */
const NOT_ANALYSED: DomainFailure = failure(
  'picture.sound-not-analysed',
  FailureKind.IntegrityViolation,
  'The picture’s sound decoded at another rate or in other channels than its file says, so it was stopped.',
);

/** The stream did not begin with its description. */
const UNDESCRIBED: DomainFailure = failure(
  'picture.sound-undescribed',
  FailureKind.IntegrityViolation,
  'The picture’s sound arrived without saying what it is, so it was stopped.',
);

/** The stream ran past the frames the page can hold. */
function pastLimit(limit: number): DomainFailure {
  return failure(
    'picture.sound-past-limit',
    FailureKind.Rejected,
    `The picture’s sound ran past the ${String(limit)} frames this page can spare memory for, so it was stopped.`,
  );
}

/** A stream read, or why it ended without its sound. */
type Received =
  | {
      readonly kind: 'sound';
      readonly blocks: readonly (readonly Float32Array[])[];
      readonly frames: number;
    }
  | { readonly kind: 'ended'; readonly failure: DomainFailure };

/**
 * Reads the stream `receiver` takes, as `expected` describes it, keeping at
 * most `limit` frames. Rejects with the signal's reason once `signal` aborts.
 */
async function receive(
  receiver: CreditedReceiver<DecodedStreamMessage>,
  expected: AnalysedStream,
  limit: number,
  signal: AbortSignal,
): Promise<Received> {
  const refuse = (reason: DomainFailure): Received => {
    receiver.refuse(reason);
    return { kind: 'ended', failure: reason };
  };
  const first = await receiver.next(signal);
  if (!first.ok) return { kind: 'ended', failure: first.failures[0] };
  if (first.value.kind === 'failed') return { kind: 'ended', failure: first.value.failure };
  if (first.value.kind !== 'description') return refuse(UNDESCRIBED);
  const { description } = first.value;
  if (
    description.sampleRate !== expected.sampleRate ||
    !layoutsMatch(description.layout, expected.layout)
  ) {
    return refuse(NOT_ANALYSED);
  }
  const blocks: (readonly Float32Array[])[] = [];
  let frames = 0;
  for (;;) {
    const message = await receiver.next(signal);
    if (!message.ok) return { kind: 'ended', failure: message.failures[0] };
    switch (message.value.kind) {
      case 'block': {
        const block = message.value;
        if (block.channels.length !== expected.layout.roles.length) return refuse(NOT_ANALYSED);
        frames += block.frames;
        if (frames > limit) return refuse(pastLimit(limit));
        blocks.push(block.channels);
        break;
      }
      case 'end':
        return { kind: 'sound', blocks, frames };
      case 'failed':
        return { kind: 'ended', failure: message.value.failure };
      case 'description':
        return refuse(UNDESCRIBED);
    }
  }
}

/** Decodes a picture's sound through `codecs` (see the module comment). */
export function codecSoundDecoder(codecs: Pick<CodecServices, 'decode'>): DecodeSound {
  return async (file, expected, limit, signal) => {
    const channel = new MessageChannel();
    const receiver = new CreditedReceiver(channel.port1, readDecodedStreamMessage, CREDIT_WINDOW);
    // Stops the reading where the person abandons the sound, or where the
    // worker answers the request with a failure: its stream may never end.
    const reading = new AbortController();
    const abandon = (): void => {
      reading.abort(signal.reason);
    };
    signal.addEventListener('abort', abandon, { once: true });
    const decoding = codecs
      .decode(file, channel.port2, () => undefined, signal)
      .then((decoded): DomainResult<DecodedFile> => {
        if (!decoded.ok) reading.abort(decoded.failures[0]);
        return decoded;
      });
    try {
      let received: Received;
      try {
        received = await receive(receiver, expected, limit, reading.signal);
      } catch (error) {
        // Only an abort ends the reading by throwing: its reason is the
        // decode's failure, or the person's abandoning, whose result is
        // dropped.
        if (!reading.signal.aborted) throw error;
        const decoded = await decoding;
        return signal.aborted || decoded.ok
          ? 'The picture’s sound was abandoned.'
          : decoded.failures[0].summary;
      }
      const decoded = await decoding;
      if (received.kind === 'ended') return received.failure.summary;
      if (!decoded.ok) return decoded.failures[0].summary;
      const sound: DecodedSound = {
        sampleRate: expected.sampleRate,
        layout: expected.layout,
        frames: received.frames,
        blocks: received.blocks,
        decoder: decoded.value.decoder,
      };
      return sound;
    } finally {
      signal.removeEventListener('abort', abandon);
      receiver.close();
    }
  };
}
