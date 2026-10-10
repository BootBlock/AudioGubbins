import {
  FailureKind,
  StandardLayouts,
  discreteLayout,
  fail,
  failure,
  succeed,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { describe, expect, it } from 'vitest';

import { decodedAnalysis } from '../testing/codec-fakes.js';
import { soundBound, soundChannelsOf, soundRefusal, type SoundChannels } from './sound-bound.js';

const channels = (count: number): SoundChannels => ({ kind: 'read', count });

/** Eight channels, as where the file's analysis could not read them. */
const UNREAD: SoundChannels = {
  kind: 'assumed',
  reason: 'AudioGubbins does not import this kind of file.',
};

describe("the bound on extracting a picture's sound", () => {
  it('is a quarter of what the page says it has, or a fixed gibibyte where it says nothing', () => {
    expect(soundBound({ availableMemoryBytes: 4e9 })).toBe(1e9);
    expect(soundBound({ availableMemoryBytes: undefined })).toBe(1024 ** 3);
  });

  it('lets a short picture through', () => {
    // A minute at 48 kHz in eight channels is 92 MB, beside a 20 MB file.
    expect(soundRefusal(20e6, 60, 48_000, UNREAD, 1e9)).toBeUndefined();
  });

  it('counts the sound at the channels its analysis read: 2, 6 and 12', () => {
    // A minute at 48 kHz is 11.52 MB a channel.
    expect(soundRefusal(0, 60, 48_000, channels(2), 23_040_000)).toBeUndefined();
    expect(soundRefusal(1, 60, 48_000, channels(2), 23_040_000)).toBeDefined();
    expect(soundRefusal(0, 60, 48_000, channels(6), 69_120_000)).toBeUndefined();
    expect(soundRefusal(1, 60, 48_000, channels(6), 69_120_000)).toBeDefined();
    // Twelve channels need more than the eight once assumed, and are refused at that.
    expect(soundRefusal(0, 60, 48_000, channels(12), 92_160_000)).toBe(
      'Extracting the picture’s sound needs up to 138 MB: the 0 MB file, read whole, and 1 ' +
        'minutes of sound in 12 channels. This page can spare 92 MB for it.',
    );
  });

  it('refuses an hour-long reel, saying what it needs and what the page can spare', () => {
    // 1.5 GB of file and 1.4 GB of sound in two channels.
    expect(soundRefusal(1.5e9, 3600, 48_000, channels(2), 1e9)).toBe(
      'Extracting the picture’s sound needs up to 2.9 GB: the 1.5 GB file, read whole, and 60 ' +
        'minutes of sound in 2 channels. This page can spare 1 GB for it.',
    );
  });

  it('counts at eight channels where they could not be read, and says why', () => {
    // 1.5 GB of file and 5.5 GB of sound, counted at eight channels.
    expect(soundRefusal(1.5e9, 3600, 48_000, UNREAD, 1e9)).toBe(
      'Extracting the picture’s sound needs up to 7 GB: the 1.5 GB file, read whole, and 60 ' +
        'minutes of sound in up to 8 channels. This page can spare 1 GB for it. Its channels ' +
        'are counted at 8, the most a picture’s sound is commonly delivered in, because they ' +
        'could not be read: AudioGubbins does not import this kind of file.',
    );
  });

  it('counts the file and its sound together, since both are held while it decodes', () => {
    expect(soundRefusal(0, 60, 48_000, UNREAD, 92_160_000)).toBeUndefined();
    expect(soundRefusal(1, 60, 48_000, UNREAD, 92_160_000)).toBeDefined();
  });

  it('refuses a picture that does not say how long it is', () => {
    expect(soundRefusal(1000, Number.POSITIVE_INFINITY, 48_000, channels(2), 1e9)).toBe(
      'The picture does not say how long it is, so the memory its sound needs cannot be told.',
    );
  });
});

describe("the channels a picture's sound is counted at", () => {
  it('are those of the stream its analysis describes', () => {
    expect(soundChannelsOf(succeed(decodedAnalysis(StandardLayouts.stereo)))).toEqual(channels(2));
    expect(soundChannelsOf(succeed(decodedAnalysis(StandardLayouts.surround5_1)))).toEqual(
      channels(6),
    );
    expect(soundChannelsOf(succeed(decodedAnalysis(expectSuccess(discreteLayout(12)))))).toEqual(
      channels(12),
    );
  });

  it('are assumed, with the reason, where the analysis refused the file or failed', () => {
    const refusal = failure('codecs.unrecognised', FailureKind.Rejected, 'The file is not audio.');
    expect(
      soundChannelsOf(succeed({ kind: 'refused', failure: refusal, alternatives: [] })),
    ).toEqual({ kind: 'assumed', reason: 'The file is not audio.' });
    const stopped = failure('codecs.worker-fault', FailureKind.Unrecoverable, 'It stopped.');
    expect(soundChannelsOf(fail(stopped))).toEqual({ kind: 'assumed', reason: 'It stopped.' });
  });
});
