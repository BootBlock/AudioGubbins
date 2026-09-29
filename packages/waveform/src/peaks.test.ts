/**
 * The pyramid: its shape, its building in any order, its cache format, and the
 * columns a view reads from it, each held to a brute-force reading of the
 * samples themselves.
 */

import { describe, expect, it } from 'vitest';

import { StandardLayouts, discreteLayout, sampleRate } from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { frameBlock } from '@audiogubbins/audio-engine';

import { PeakBuilder } from './peak-builder.js';
import { decodePeaks, encodePeaks, crc32 } from './peak-codec.js';
import { summariseBucket } from './bucket-summary.js';
import {
  columnPeaks,
  readBucketColumns,
  readPyramidColumns,
  readSampleColumns,
} from './peak-columns.js';
import {
  CHUNK_FRAMES,
  DETAIL_BUCKET_FRAMES,
  DetailKind,
  chunkCount,
  detailFor,
  levelFor,
  peakGeometry,
} from './peak-geometry.js';
import { WaveformPeakPyramid, packedChannels } from './peak-pyramid.js';
import { fromSteps } from './quantisation.js';

const RATE = expectSuccess(sampleRate(48_000));

/** A seeded sequence in [-1, 1), so a signal is the same every run. */
function noise(frames: number, seed: number, scale = 0.9): Float32Array {
  let state = seed >>> 0;
  const out = new Float32Array(frames);
  for (let index = 0; index < frames; index += 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    out[index] = (state / 2 ** 31 - 1) * scale;
  }
  return out;
}

/** Builds a pyramid of `channels`, reading its chunks in `order`. */
function built(channels: readonly Float32Array[], order: readonly number[]): PeakBuilder {
  const frames = channels[0]?.length ?? 0;
  const builder = new PeakBuilder(peakGeometry(frames, channels.length));
  const layout = expectSuccess(discreteLayout(channels.length));
  for (const chunk of order) {
    const start = chunk * CHUNK_FRAMES;
    const count = Math.min(CHUNK_FRAMES, frames - start);
    const block = expectSuccess(
      frameBlock(
        layout,
        RATE,
        channels.map((channel) => channel.slice(start, start + count)),
      ),
    );
    builder.addChunk(chunk, block, count);
  }
  return builder;
}

function inOrder(frames: number): number[] {
  return Array.from({ length: Math.ceil(frames / CHUNK_FRAMES) }, (_, index) => index);
}

describe('the shape of a pyramid', () => {
  it('has levels of 256 frames a bucket and four times each above, up to one bucket', () => {
    const geometry = peakGeometry(1_000_000, 2);
    expect(geometry.levels.map((level) => level.bucketFrames)).toEqual([
      256, 1024, 4096, 16_384, 65_536, 262_144, 1_048_576,
    ]);
    expect(geometry.levels.at(-1)?.buckets).toBe(1);
    expect(chunkCount(geometry)).toBe(16);
    expect(levelFor(geometry, 255)).toBe(0);
    expect(levelFor(geometry, 5000)).toBe(2);
    expect([4, 16, 255, 256].map(detailFor)).toEqual([
      DetailKind.Samples,
      DetailKind.Buckets,
      DetailKind.Buckets,
      DetailKind.Pyramid,
    ]);
  });
});

describe('building a pyramid', () => {
  const frames = 5 * CHUNK_FRAMES + 12_345;
  const signal = [noise(frames, 1), noise(frames, 2, 0.3)];

  it('keeps each bucket of level zero as the samples give it, the envelope rounded outward', () => {
    const builder = built(signal, inOrder(frames));
    const level = builder.levels[0];
    const left = signal[0];
    for (const bucket of [0, 17, level!.buckets - 1]) {
      const samples = left!.subarray(bucket * 256, Math.min(frames, (bucket + 1) * 256));
      const low = Math.min(...samples);
      const high = Math.max(...samples);
      const minimum = fromSteps(level!.channels[0]!.minimum[bucket]!);
      const maximum = fromSteps(level!.channels[0]!.maximum[bucket]!);
      expect(minimum).toBeLessThanOrEqual(low);
      expect(low - minimum).toBeLessThan(1 / 8192);
      expect(maximum).toBeGreaterThanOrEqual(high);
      expect(maximum - high).toBeLessThan(1 / 8192);
      const rms = Math.sqrt(samples.reduce((sum, one) => sum + one * one, 0) / samples.length);
      expect(fromSteps(level!.channels[0]!.rms[bucket]!)).toBeCloseTo(rms, 3);
    }
  });

  it('builds the same pyramid whatever order its chunks arrive in', () => {
    const forwards = built(signal, inOrder(frames));
    const shuffled = built(signal, [3, 5, 0, 4, 1, 2]);
    expect(shuffled.levels).toEqual(forwards.levels);
    expect(forwards.levels.every((level) => level.known.every((one) => one === 1))).toBe(true);
  });

  it('finishes each bucket above as soon as its last child is in, and answers the runs it finished', () => {
    const builder = new PeakBuilder(peakGeometry(4 * CHUNK_FRAMES, 1));
    const block = (chunk: number) =>
      expectSuccess(frameBlock(StandardLayouts.mono, RATE, [noise(CHUNK_FRAMES, chunk)]));
    const first = builder.addChunk(0, block(0), CHUNK_FRAMES);
    // One chunk is 256 buckets of level zero, 64 of level one, 16, 4, then 1 of level four.
    expect(first.map((run) => [run.level, run.first, run.channels[0]!.minimum.length])).toEqual([
      [0, 0, 256],
      [1, 0, 64],
      [2, 0, 16],
      [3, 0, 4],
      [4, 0, 1],
    ]);
    builder.addChunk(2, block(2), CHUNK_FRAMES);
    const last = builder.addChunk(1, block(1), CHUNK_FRAMES);
    expect(last.at(-1)?.level).toBe(4);
    const top = builder.addChunk(3, block(3), CHUNK_FRAMES).at(-1);
    expect([top?.level, top?.first]).toEqual([5, 0]);
  });

  it('weighs a short last bucket by the frames it holds, and marks full scale and non-finite samples', () => {
    const frames = 256 + 10;
    const samples = new Float32Array(frames);
    samples.fill(0.5, 0, 256);
    samples.fill(1, 256, frames);
    samples[3] = Number.NaN;
    const builder = built([samples], [0]);
    const [base, above] = builder.levels;
    expect(base?.channels[0]?.clipped).toEqual(new Uint8Array([1, 1]));
    // The mean square above is (255 × 0.25 + 10 × 1) / 265 over the finite samples it holds.
    const expected = Math.sqrt((255 * 0.25 + 10) / 265);
    expect(fromSteps(above!.channels[0]!.rms[0]!)).toBeCloseTo(expected, 2);
  });
});

describe('the cache format', () => {
  const frames = 2 * CHUNK_FRAMES + 99;
  const signal = [noise(frames, 5), noise(frames, 6)];
  const builder = built(signal, inOrder(frames));
  const source = { identity: 'test-tone', revision: 'r1', sampleRate: 48_000 };
  const expected = { ...source, frames, channels: 2 };

  it('reads back the levels it wrote, as views onto the bytes', () => {
    const bytes = encodePeaks(builder.geometry, builder.levels, source);
    const decoded = expectSuccess(decodePeaks(bytes, expected, true));
    expect(decoded.levels.map((level) => level.channels)).toEqual(
      builder.levels.map((level) => level.channels),
    );
    expect(decoded.levels[0]?.channels[0]?.minimum.buffer).toBe(bytes.buffer);
    expect(new WaveformPeakPyramid(decoded.geometry, decoded.levels).complete).toBe(true);
  });

  it('refuses a cache of another source, revision, rate or shape, a torn one and a changed one', () => {
    const bytes = encodePeaks(builder.geometry, builder.levels, source);
    const refusal = (value: Uint8Array<ArrayBuffer>, what = expected): string | undefined => {
      const read = decodePeaks(value, what, true);
      return read.ok ? undefined : read.failures[0].summary;
    };
    expect(refusal(bytes, { ...expected, identity: 'other' })).toMatch(/another source/u);
    expect(refusal(bytes, { ...expected, revision: 'r2' })).toMatch(/another source/u);
    expect(refusal(bytes, { ...expected, sampleRate: 44_100 })).toMatch(/sample rate/u);
    expect(refusal(bytes, { ...expected, frames: frames + 1 })).toMatch(/length/u);
    expect(refusal(bytes.slice(0, bytes.length - 10))).toMatch(/torn/u);
    const changed = bytes.slice();
    changed[changed.length - 100] = (changed[changed.length - 100] ?? 0) ^ 1;
    expect(refusal(changed)).toMatch(/checksum/u);
    const future = bytes.slice();
    future[4] = 9;
    expect(refusal(future)).toMatch(/format version/u);
    expect(expectFailureCode(decodePeaks(new Uint8Array(3), expected, true))).toBe(
      'waveform.cache-refused',
    );
  });

  it('computes the CRC-32 zlib does', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
});

describe('reading columns', () => {
  const frames = 3 * CHUNK_FRAMES;
  const signal = [noise(frames, 9)];
  const builder = built(signal, inOrder(frames));
  const pyramid = new WaveformPeakPyramid(builder.geometry, builder.levels);

  function bruteForce(start: number, width: number, columns: number) {
    return Array.from({ length: columns }, (_, column) => {
      const from = Math.floor(start + column * width);
      const to = Math.floor(start + (column + 1) * width);
      const samples = signal[0]!.subarray(from, to);
      return [Math.min(...samples), Math.max(...samples)] as const;
    });
  }

  it('draws a column from the pyramid no narrower than the samples it covers, and no wider than a bucket either side', () => {
    const span = { start: 1000.5, framesPerColumn: 1234.25, columns: 100 };
    const into = columnPeaks(128);
    readPyramidColumns(pyramid, 0, span, into);
    expect(into.columns).toBe(100);
    bruteForce(span.start, span.framesPerColumn, 100).forEach(([low, high], column) => {
      expect(into.known[column]).toBe(1);
      expect(into.minimum[column]).toBeLessThanOrEqual(low);
      expect(into.maximum[column]).toBeGreaterThanOrEqual(high);
    });
  });

  it('draws a column from the samples exactly where it is narrower than a detail bucket', () => {
    const span = { start: 500, framesPerColumn: 3, columns: 50 };
    const into = columnPeaks(64);
    readPyramidColumns(pyramid, 0, span, into);
    readSampleColumns({ start: 400, channels: [signal[0]!.slice(400, 800)] }, 0, span, into);
    bruteForce(500, 3, 50).forEach(([low, high], column) => {
      expect(into.minimum[column]).toBe(low);
      expect(into.maximum[column]).toBe(high);
    });
  });

  it('draws a column from detail buckets no narrower than its samples and no wider than a detail bucket either side', () => {
    const start = 4096;
    const count = 8192;
    const [window] = packedChannels(1, count / DETAIL_BUCKET_FRAMES);
    for (let bucket = 0; bucket < count / DETAIL_BUCKET_FRAMES; bucket += 1) {
      summariseBucket(signal[0]!, start + bucket * DETAIL_BUCKET_FRAMES, 16, window!, bucket);
    }
    const span = { start: 5000.5, framesPerColumn: 37.25, columns: 150 };
    const into = columnPeaks(160);
    readPyramidColumns(pyramid, 0, span, into);
    readBucketColumns(
      { start, frames: count, bucketFrames: DETAIL_BUCKET_FRAMES, channels: [window!] },
      0,
      span,
      into,
    );
    bruteForce(span.start, span.framesPerColumn, 150).forEach(([low, high], column) => {
      expect(into.minimum[column]).toBeLessThanOrEqual(low);
      expect(into.maximum[column]).toBeGreaterThanOrEqual(high);
      const from = Math.floor(span.start + column * span.framesPerColumn);
      const to = Math.floor(span.start + (column + 1) * span.framesPerColumn);
      const wider = signal[0]!.subarray(
        Math.floor(from / DETAIL_BUCKET_FRAMES) * DETAIL_BUCKET_FRAMES,
        Math.ceil(to / DETAIL_BUCKET_FRAMES) * DETAIL_BUCKET_FRAMES,
      );
      expect(into.minimum[column]).toBeGreaterThanOrEqual(Math.min(...wider) - 1 / 8192);
      expect(into.maximum[column]).toBeLessThanOrEqual(Math.max(...wider) + 1 / 8192);
    });
  });

  it('leaves a column a window does not hold whole as the pyramid drew it', () => {
    const span = { start: 0, framesPerColumn: 100, columns: 40 };
    const into = columnPeaks(40);
    readPyramidColumns(pyramid, 0, span, into);
    const coarse = [...into.maximum];
    readSampleColumns({ start: 1000, channels: [signal[0]!.slice(1000, 2000)] }, 0, span, into);
    expect(into.known.every((known, column) => column >= 40 || known === 1)).toBe(true);
    expect([...into.maximum.slice(0, 10)]).toEqual(coarse.slice(0, 10));
    expect([...into.maximum.slice(20, 40)]).toEqual(coarse.slice(20, 40));
    expect(into.maximum[10]).toBe(Math.max(...signal[0]!.subarray(1000, 1100)));
  });

  it('marks a column pending until every bucket it reads is known', () => {
    const partial = new WaveformPeakPyramid(peakGeometry(frames, 1));
    const into = columnPeaks(16);
    readPyramidColumns(partial, 0, { start: 0, framesPerColumn: 4096, columns: 16 }, into);
    expect([...into.known]).toEqual(new Array(16).fill(0));
  });
});
