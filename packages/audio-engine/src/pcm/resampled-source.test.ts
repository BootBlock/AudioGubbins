/**
 * The resampled source read from anywhere: the frames it writes from the
 * middle are the frames a read from its first frame writes, on both DSP
 * paths, and reaching the middle reads no more of its source the further in
 * it is.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import {
  StandardLayouts,
  sampleCount,
  sampleRate,
  type SampleCount,
  type SampleRate,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import { ResamplingQuality, type CanonicalDsp } from '../dsp/canonical-dsp.js';
import { REFERENCE_DSP } from '../dsp/reference/reference-dsp.js';
import { wasmDsp } from '../dsp/wasm/wasm-dsp.js';
import { dspModuleExports } from '../testing/dsp-module.js';
import { allocateBlock } from './frame-block.js';
import { assertReadableInto, framesAvailable, type PcmSource } from './pcm-source.js';
import { resampledSource } from './resampled-source.js';

const STEREO = StandardLayouts.stereo;

/** Frames the resampled source reads from its source at a time; see `resampled-source.ts`. */
const INPUT_CHUNK = 4_096;

function rate(value: number): SampleRate {
  return expectSuccess(sampleRate(value));
}

function frames(value: number): SampleCount {
  return expectSuccess(sampleCount(value));
}

/** The sample at `position` of channel `channel`: a ramp on the left, half of it inverted on the right. */
function sampleAt(position: number, channel: number): number {
  const ramp = ((position % 97) - 48) / 64;
  return channel === 0 ? ramp : -ramp / 2;
}

/**
 * A stereo source whose every frame is a function of its position, so a read
 * anywhere costs the same, which counts the frames read from it.
 */
function countingSource(
  at: SampleRate,
  length: number,
): { readonly source: PcmSource; readonly framesRead: () => number } {
  let framesRead = 0;
  const bounded = frames(length);
  const source: PcmSource = {
    layout: STEREO,
    sampleRate: at,
    length: bounded,
    read: (start, into) => {
      assertReadableInto(source, into);
      const count = framesAvailable(bounded, start, into.frames);
      into.channels.forEach((channel, index) => {
        for (let frame = 0; frame < count; frame += 1)
          channel[frame] = sampleAt(start + frame, index);
      });
      framesRead += count;
      return Promise.resolve(count);
    },
    release: () => undefined,
  };
  return { source, framesRead: () => framesRead };
}

/** Reads `count` frames from `start` in reads of `chunk`, one array per channel. */
async function readRange(
  source: PcmSource,
  start: number,
  count: number,
  chunk: number,
): Promise<Float32Array[]> {
  const out = source.layout.roles.map(() => new Float32Array(count));
  const block = allocateBlock(source.layout, source.sampleRate, chunk);
  for (let offset = 0; offset < count; offset += chunk) {
    const read = await source.read(frames(start + offset), block);
    block.channels.forEach((channel, index) =>
      out[index]?.set(channel.subarray(0, Math.min(read, count - offset)), offset),
    );
  }
  return out;
}

const CONVERSIONS = [
  { from: 44_100, to: 48_000, quality: ResamplingQuality.Maximum },
  { from: 48_000, to: 44_100, quality: ResamplingQuality.High },
  { from: 96_000, to: 32_000, quality: ResamplingQuality.Draft },
] as const;

let wasm: CanonicalDsp;

beforeAll(async () => {
  wasm = expectSuccess(wasmDsp(await dspModuleExports()));
});

describe.each([
  ['the WebAssembly module', () => wasm],
  ['the reference path', () => REFERENCE_DSP],
])('a resampled source on %s', (_path, dspOf) => {
  it.each(CONVERSIONS)(
    'writes from the middle the bits a read from the start writes, $from Hz to $to Hz',
    async ({ from, to, quality }) => {
      const convertedOf = (): PcmSource =>
        expectSuccess(
          resampledSource(dspOf(), countingSource(rate(from), 60_000).source, rate(to), quality),
        );
      const start = 12_345;
      const count = 3_000;
      const fromZero = await readRange(convertedOf(), 0, start + count, 1_000);
      const fromMiddle = await readRange(convertedOf(), start, count, 700);
      expect(fromMiddle).toEqual(fromZero.map((channel) => channel.subarray(start)));

      // And after reading on, back to the middle again.
      const seeking = convertedOf();
      await readRange(seeking, 0, 20_000, 1_000);
      expect(await readRange(seeking, start, count, 500)).toEqual(fromMiddle);
    },
  );

  it.each(CONVERSIONS)(
    'reads no more of its source to start further in, $from Hz to $to Hz',
    async ({ from, to, quality }) => {
      const count = 2_000;
      const readFrom = async (start: number): Promise<number> => {
        const { source, framesRead } = countingSource(rate(from), 1_000_000_000);
        const converted = expectSuccess(resampledSource(dspOf(), source, rate(to), quality));
        await readRange(converted, start, count, count);
        converted.release();
        return framesRead();
      };
      const near = await readFrom(10_000);
      const far = await readFrom(5_000_000);
      const resampler = expectSuccess(
        dspOf().createResampler({ from: rate(from), to: rate(to), channels: 2, quality }),
      );
      // The input the frames span, the filter's reach each side, and a chunk
      // read whole at each end.
      const bound = (count * from) / to + 2 * resampler.lookahead + 2 * INPUT_CHUNK;
      resampler.release();
      expect(near).toBeLessThanOrEqual(bound);
      expect(far).toBeLessThanOrEqual(bound);
    },
  );
});

describe('a resampled source whose read failed part way', () => {
  it('seeks for the read after it, which writes what a conversion from the start writes', async () => {
    const { from, to, quality } = CONVERSIONS[0];
    const fresh = expectSuccess(
      resampledSource(REFERENCE_DSP, countingSource(rate(from), 60_000).source, rate(to), quality),
    );
    const expected = await readRange(fresh, 0, 10_000, 10_000);
    const { source } = countingSource(rate(from), 60_000);
    let failed = false;
    const failingOnce: PcmSource = {
      ...source,
      read: (start, into, signal) => {
        if (start > 0 && !failed) {
          failed = true;
          return Promise.reject(new Error('The file went away.'));
        }
        return source.read(start, into, signal);
      },
    };
    const converted = expectSuccess(resampledSource(REFERENCE_DSP, failingOnce, rate(to), quality));

    await expect(readRange(converted, 0, 10_000, 10_000)).rejects.toThrow('The file went away.');

    // The same read again: the resampler has already given some of it.
    expect(await readRange(converted, 0, 10_000, 10_000)).toEqual(expected);
  });
});

describe('a resampled source read by two readers at once', () => {
  it('gives each read what it would read alone', async () => {
    const { from, to, quality } = CONVERSIONS[0];
    const convertedOf = (): PcmSource =>
      expectSuccess(
        resampledSource(
          REFERENCE_DSP,
          countingSource(rate(from), 60_000).source,
          rate(to),
          quality,
        ),
      );
    const alone = await readRange(convertedOf(), 0, 30_000, 30_000);
    const shared = convertedOf();

    const [early, late] = await Promise.all([
      readRange(shared, 0, 10_000, 10_000),
      readRange(shared, 20_000, 10_000, 10_000),
    ]);

    expect(early).toEqual(alone.map((channel) => channel.subarray(0, 10_000)));
    expect(late).toEqual(alone.map((channel) => channel.subarray(20_000, 30_000)));
  });
});
