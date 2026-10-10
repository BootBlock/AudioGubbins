import {
  FailureKind,
  StandardLayouts,
  failure,
  sampleCount,
  type DomainResult,
  type SampleCount,
} from '@audiogubbins/domain';
import { describe, expect, it } from 'vitest';

import {
  readDecodedStreamMessage,
  readEncodedStreamMessage,
  readRenderedStreamMessage,
  readStreamReceiverMessage,
} from './stream-message-reading.js';
import type {
  DecodedStreamMessage,
  EncodedStreamMessage,
  RenderedStreamMessage,
  StreamReceiverMessage,
} from './stream-messages.js';

function frames(count: number): SampleCount {
  const read = sampleCount(count);
  if (!read.ok) throw new Error(read.failures[0].summary);
  return read.value;
}

const FAILED = failure('codec-runtime.malformed', FailureKind.IntegrityViolation, 'It broke.');

/** Why a message was refused: the field it names. */
function refusedField<T>(read: DomainResult<T>): unknown {
  return read.ok ? undefined : read.failures[0].details?.['field'];
}

describe('stream messages that crossed between workers', () => {
  it('reads each message of a decoded import as it was sent', () => {
    const messages: readonly DecodedStreamMessage[] = [
      {
        kind: 'description',
        description: {
          sampleRate: 44_100,
          layout: StandardLayouts.stereo,
          statedFrames: frames(1_000),
          metadata: { text: { title: 'Rain' }, loops: [] },
        },
      },
      {
        kind: 'description',
        description: {
          sampleRate: 48_000,
          layout: StandardLayouts.mono,
          statedFrames: undefined,
          metadata: {},
        },
      },
      { kind: 'block', channels: [Float32Array.of(0.5, -0.5)], frames: 2 },
      { kind: 'end', frames: frames(2) },
      { kind: 'failed', failure: FAILED },
    ];
    for (const message of messages) {
      const read = readDecodedStreamMessage(structuredClone(message));
      expect(read.ok ? read.value : read.failures).toEqual(message);
    }
  });

  it('refuses a block whose planes are not one per channel of its frames', () => {
    const plane = new Float32Array(4);
    expect(refusedField(readDecodedStreamMessage({ kind: 'block', channels: [], frames: 4 }))).toBe(
      'channels',
    );
    expect(
      refusedField(
        readDecodedStreamMessage({
          kind: 'block',
          channels: [plane, new Float32Array(3)],
          frames: 4,
        }),
      ),
    ).toBe('channels');
    expect(
      refusedField(readDecodedStreamMessage({ kind: 'block', channels: [plane], frames: 0 })),
    ).toBe('channels');
    const many = Array.from({ length: 257 }, () => new Float32Array(1));
    expect(
      refusedField(readDecodedStreamMessage({ kind: 'block', channels: many, frames: 1 })),
    ).toBe('channels');
  });

  it('refuses a description of no rate, a forged layout or a malformed map', () => {
    const description = {
      sampleRate: 44_100,
      layout: StandardLayouts.stereo,
      metadata: {},
    };
    const read = (changed: object) =>
      refusedField(
        readDecodedStreamMessage({
          kind: 'description',
          description: { ...description, ...changed },
        }),
      );
    expect(read({ sampleRate: 0 })).toBe('description.sampleRate');
    expect(read({ layout: { roles: ['centre', 'centre'] } })).toBe('description.layout');
    expect(read({ metadata: { text: { mood: 'Calm' } } })).toBe('description.metadata.text.mood');
    expect(read({ statedFrames: -1 })).toBe('description.statedFrames');
  });

  it('reads each message of an encoded export and of a rendered one', () => {
    const encoded: readonly EncodedStreamMessage[] = [
      { kind: 'body', bytes: Uint8Array.of(1, 2, 3) },
      {
        kind: 'finished',
        file: { head: Uint8Array.of(4), tail: new Uint8Array(0), dropped: [{ kind: 'cues' }] },
      },
      { kind: 'failed', failure: FAILED },
    ];
    for (const message of encoded) {
      const read = readEncodedStreamMessage(structuredClone(message));
      expect(read.ok ? read.value : read.failures).toEqual(message);
    }
    const rendered: readonly RenderedStreamMessage[] = [
      { kind: 'block', channels: [Float32Array.of(1), Float32Array.of(-1)], frames: 1 },
      { kind: 'end', frames: frames(1) },
      { kind: 'failed', failure: FAILED },
    ];
    for (const message of rendered) {
      const read = readRenderedStreamMessage(structuredClone(message));
      expect(read.ok ? read.value : read.failures).toEqual(message);
    }
    expect(refusedField(readRenderedStreamMessage({ kind: 'description' }))).toBe('kind');
  });

  it('reads credit of at least one, and a refusal', () => {
    const messages: readonly StreamReceiverMessage[] = [
      { kind: 'ready', credit: 3 },
      { kind: 'refused', failure: FAILED },
    ];
    for (const message of messages) {
      const read = readStreamReceiverMessage(structuredClone(message));
      expect(read.ok ? read.value : read.failures).toEqual(message);
    }
    expect(refusedField(readStreamReceiverMessage({ kind: 'ready', credit: 0 }))).toBe('credit');
    expect(refusedField(readStreamReceiverMessage({ kind: 'ready', credit: 1.5 }))).toBe('credit');
    expect(refusedField(readStreamReceiverMessage({ kind: 'refused', failure: {} }))).toBe(
      'failure.code',
    );
  });
});
