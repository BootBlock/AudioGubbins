import { describe, expect, it } from 'vitest';

import {
  MAXIMUM_QUALITY,
  QualityLevel,
  StandardLayouts,
  namedQualityMode,
  sampleRate,
  type QualitySettings,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import { REFERENCE_DSP } from '../dsp/reference/reference-dsp.js';
import { sineOfTurns } from '../dsp/reference/primitives.js';
import { ProcessedStart } from './processed-content.js';
import { StretchedContent, stretchWindow } from './stretched-content.js';

const RATE = expectSuccess(sampleRate(48_000));
const STREAM = { sampleRate: RATE, layout: StandardLayouts.stereo };

/** A stereo tone of `frequency` hertz, the right channel half the left, read in order. */
function tone(frames: number, frequency: number) {
  const left = Float32Array.from({ length: frames }, (_, n) =>
    Math.fround(0.5 * sineOfTurns((n * frequency) / RATE)),
  );
  const right = left.map((sample) => sample / 2);
  const reads: number[] = [];
  return {
    reads,
    input: {
      length: frames,
      read: (start: number, count: number, into: readonly Float32Array[]) => {
        reads.push(start);
        into[0]?.set(left.subarray(start, start + count));
        into[1]?.set(right.subarray(start, start + count));
        return Promise.resolve();
      },
    },
    left,
  };
}

function stretched(
  frames: number,
  length: number,
  quality: QualitySettings = MAXIMUM_QUALITY.settings,
  start: ProcessedStart = ProcessedStart.Canonical,
) {
  const source = tone(frames, 1_000);
  const content = new StretchedContent(source.input, STREAM, length, {
    quality,
    dsp: REFERENCE_DSP,
    start,
  });
  return { content, source };
}

async function readAll(content: StretchedContent, frames: number, piece: number) {
  const out = [new Float32Array(frames), new Float32Array(frames)];
  for (let start = 0; start < frames; start += piece) {
    const count = Math.min(piece, frames - start);
    await content.read(
      start,
      count,
      out.map((channel) => channel.subarray(start, start + count)),
    );
  }
  return out;
}

/** The frequency of `samples` from their upward zero crossings, in hertz. */
function frequencyOf(samples: Float32Array): number {
  const crossings: number[] = [];
  for (let n = 1; n < samples.length; n += 1) {
    const before = samples[n - 1] ?? 0;
    const after = samples[n] ?? 0;
    if (before < 0 && after >= 0) crossings.push(n - 1 + before / (before - after));
  }
  const first = crossings[0] ?? 0;
  const last = crossings.at(-1) ?? 0;
  return ((crossings.length - 1) * RATE) / (last - first);
}

function rms(samples: Float32Array): number {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length);
}

describe('StretchedContent', () => {
  it('sizes its window to at least 80 ms of frames, as a power of two', () => {
    expect(stretchWindow(48_000)).toBe(4_096);
    expect(stretchWindow(44_100)).toBe(4_096);
    expect(stretchWindow(96_000)).toBe(8_192);
    expect(stretchWindow(8_000)).toBe(1_024);
  });

  it.each([
    ['twice as long', 9_600, 19_200],
    ['half as long', 19_200, 9_600],
    ['a little longer', 14_400, 15_841],
  ])('makes a tone %s without changing its pitch or its level', async (_, frames, length) => {
    const { content } = stretched(frames, length);
    const [left, right] = await readAll(content, length, 1_000);
    // The middle, clear of where the windows meet the stream's ends.
    const middle = (left ?? new Float32Array()).subarray(4_096, length - 4_096);
    expect(frequencyOf(middle)).toBeCloseTo(1_000, 0);
    expect(rms(middle)).toBeCloseTo(0.5 / Math.SQRT2, 2);
    const rightMiddle = (right ?? new Float32Array()).subarray(4_096, length - 4_096);
    expect(rms(rightMiddle)).toBeCloseTo(0.25 / Math.SQRT2, 2);
  });

  it('gives the same bits however its reads are cut, and from its start after a read behind', async () => {
    const whole = await readAll(stretched(9_600, 19_200).content, 19_200, 19_200);
    const { content, source } = stretched(9_600, 19_200);
    const pieces = await readAll(content, 19_200, 997);
    expect(pieces).toEqual(whole);
    // Each frame of the stream is read once, in order.
    expect(source.reads).toEqual([...source.reads].sort((a, b) => a - b));
    const again = [new Float32Array(500), new Float32Array(500)];
    await content.read(6_000, 500, again);
    expect(again[0]).toEqual(whole[0]?.subarray(6_000, 6_500));
    expect(source.reads.at(-1)).toBeGreaterThan(0);
  });

  it('runs at the quality it is given, so a lower overlap is another sound', async () => {
    const draft = namedQualityMode(QualityLevel.Draft).settings;
    const best = await readAll(stretched(9_600, 19_200).content, 19_200, 19_200);
    const quick = await readAll(stretched(9_600, 19_200, draft).content, 19_200, 19_200);
    expect(quick).not.toEqual(best);
    const middle = (quick[0] ?? new Float32Array()).subarray(4_096, 19_200 - 4_096);
    expect(frequencyOf(middle)).toBeCloseTo(1_000, 0);
  });

  it('passes a stream through unchanged when its length is the stream’s', async () => {
    const { content, source } = stretched(4_800, 4_800);
    const [left] = await readAll(content, 4_800, 333);
    expect(left).toEqual(source.left);
  });

  it('starts a preview a few frames before a later read rather than from the stream’s start', async () => {
    const { content, source } = stretched(
      48_000,
      96_000,
      MAXIMUM_QUALITY.settings,
      ProcessedStart.Preview,
    );
    const into = [new Float32Array(1_000), new Float32Array(1_000)];
    await content.read(80_000, 1_000, into);
    expect(Math.min(...source.reads)).toBeGreaterThan(30_000);
    const middle = (into[0] ?? new Float32Array()).subarray(0, 1_000);
    expect(rms(middle)).toBeCloseTo(0.5 / Math.SQRT2, 1);
  });
});

describe('a stretched stream whose read failed part way', () => {
  it('starts afresh for the read after it, rather than adding to a frame half added', async () => {
    const whole = await readAll(stretched(20_000, 30_000).content, 30_000, 1_000);
    const source = tone(20_000, 1_000);
    let reads = 0;
    const content = new StretchedContent(
      {
        length: source.input.length,
        read: (start, count, into) => {
          reads += 1;
          if (reads === 3) return Promise.reject(new Error('The file went away.'));
          return source.input.read(start, count, into);
        },
      },
      STREAM,
      30_000,
      { quality: MAXIMUM_QUALITY.settings, dsp: REFERENCE_DSP, start: ProcessedStart.Canonical },
    );
    const out = [new Float32Array(1_000), new Float32Array(1_000)];
    const failed = [new Float32Array(10_000), new Float32Array(10_000)];
    await expect(content.read(0, 10_000, failed)).rejects.toThrow('The file went away.');

    // Further on than the failed read reached, so only a stream that knows
    // it was interrupted starts again.
    await content.read(20_000, 1_000, out);

    expect(out).toEqual(whole.map((channel) => channel.subarray(20_000, 21_000)));
  });
});
