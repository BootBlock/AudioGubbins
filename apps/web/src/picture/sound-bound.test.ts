import type { AnalysedStream } from '@audiogubbins/codec-runtime';
import {
  StandardLayouts,
  discreteLayout,
  sampleCount,
  sampleRate,
  type ChannelLayout,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { describe, expect, it } from 'vitest';

import { decodedAnalysis } from '../testing/codec-fakes.js';
import { soundBound, soundFrameLimit, soundRefusal } from './sound-bound.js';

/** The stream an analysis reads of a sound in `layout` at `rate`, stating `frames` where given. */
function streamOf(layout: ChannelLayout, rate = 48_000, frames?: number): AnalysedStream {
  const analysis = decodedAnalysis(layout);
  if (analysis.kind !== 'decode') throw new Error('The analysis decodes nothing.');
  return {
    ...analysis.stream,
    sampleRate: expectSuccess(sampleRate(rate)),
    statedFrames: frames === undefined ? undefined : expectSuccess(sampleCount(frames)),
  };
}

describe("the bound on extracting a picture's sound", () => {
  it('is a quarter of what the page says it has, or a fixed gibibyte where it says nothing', () => {
    expect(soundBound({ availableMemoryBytes: 4e9 })).toBe(1e9);
    expect(soundBound({ availableMemoryBytes: undefined })).toBe(1024 ** 3);
  });

  it('holds the frames of a channel count that fit, and no more', () => {
    // Two channels of 32-bit samples are eight bytes a frame.
    expect(soundFrameLimit(2, 80)).toBe(10);
    expect(soundFrameLimit(2, 87)).toBe(10);
    expect(soundFrameLimit(6, 24)).toBe(1);
  });

  it('lets a sound through that fits, weighed at its own rate and channels', () => {
    // A minute at 48 kHz in two channels is 23.04 MB; at 44.1 kHz, 21.168 MB.
    expect(soundRefusal(streamOf(StandardLayouts.stereo), 60, 23_040_000)).toBeUndefined();
    expect(soundRefusal(streamOf(StandardLayouts.stereo), 60, 23_039_999)).toBeDefined();
    expect(soundRefusal(streamOf(StandardLayouts.stereo, 44_100), 60, 21_168_000)).toBeUndefined();
    expect(soundRefusal(streamOf(StandardLayouts.surround5_1), 60, 69_120_000)).toBeUndefined();
    expect(soundRefusal(streamOf(StandardLayouts.surround5_1), 60, 69_119_999)).toBeDefined();
  });

  it('weighs the length the stream states before the length the picture plays for', () => {
    // A picture of an hour whose sound states a minute.
    const stated = streamOf(StandardLayouts.stereo, 48_000, 2_880_000);

    expect(soundRefusal(stated, 3600, 23_040_000)).toBeUndefined();
    expect(soundRefusal(stated, Number.POSITIVE_INFINITY, 23_040_000)).toBeUndefined();
  });

  it('says what the sound needs, and what the page can spare', () => {
    expect(soundRefusal(streamOf(StandardLayouts.stereo), 3600, 1e9)).toBe(
      'Extracting the picture’s sound needs 1.4 GB: 60 minutes of sound in 2 channels at 48 kHz. This page can spare 1 GB for it.',
    );
    expect(soundRefusal(streamOf(expectSuccess(discreteLayout(12)), 44_100), 60, 10_000_000)).toBe(
      'Extracting the picture’s sound needs 127 MB: 1 minute of sound in 12 channels at 44.1 kHz. This page can spare 10 MB for it.',
    );
  });

  it('refuses a sound whose length neither the picture nor the stream says', () => {
    expect(soundRefusal(streamOf(StandardLayouts.stereo), Number.POSITIVE_INFINITY, 1e9)).toBe(
      'Neither the picture nor its sound says how long it is, so the memory its sound needs cannot be told.',
    );
  });
});
