import { describe, expect, it } from 'vitest';

import {
  MAXIMUM_QUALITY,
  MaskEffect,
  QualityLevel,
  StandardLayouts,
  derivedSampleCount,
  namedQualityMode,
  spectralPlacement,
  unsafeBrandId,
  type EffectChain,
} from '@audiogubbins/domain';

import { FrameGeometry } from '../spectral/spectral-frames.js';
import { scalingChain } from '../testing/scaling-chain.js';
import {
  SPECTRAL_RATE,
  amplitudeAt,
  noise,
  readAllOf,
  rectangleEdit,
  spectralOver,
  tones,
} from '../testing/spectral-signals.js';
import { ProcessedContent, ProcessedStart } from './processed-content.js';
import { REFERENCE_DSP } from '../dsp/reference/reference-dsp.js';

/** A chain of nothing, which the scaling chain's processing runs as a scale. */
const CHAIN: EffectChain = { id: unsafeBrandId<'EffectChainId'>('33333333-chain'), slots: [] };

const LENGTH = 24_000;
const WHOLE = { start: 0, end: LENGTH };
const NYQUIST = SPECTRAL_RATE / 2;

function sameBits(left: Float32Array, right: Float32Array): boolean {
  if (left.length !== right.length) return false;
  const a = new Uint32Array(left.buffer, left.byteOffset, left.length);
  const b = new Uint32Array(right.buffer, right.byteOffset, right.length);
  return a.every((bits, index) => bits === b[index]);
}

/** The energy of `made` less `expected` from `from` to `to`, as a share of `expected`'s. */
function relativeError(
  made: Float32Array,
  expected: Float32Array,
  from: number,
  to: number,
): number {
  let error = 0;
  let energy = 0;
  for (let n = from; n < to; n += 1) {
    error += ((made[n] ?? 0) - (expected[n] ?? 0)) ** 2;
    energy += (expected[n] ?? 0) ** 2;
  }
  return error / energy;
}

describe('the frames of a spectral edit', () => {
  it('centres frame k at k · H and finds the frames that reach a span', () => {
    const geometry = new FrameGeometry(1_024, 8, 10_000);
    expect(geometry.hop).toBe(128);
    expect(geometry.bins).toBe(513);
    expect(geometry.first(10)).toBe(1_280 - 512);
    // The first frame reaching 0 ends just past it; the one before ends at it.
    expect(geometry.firstReaching(0)).toBe(-3);
    expect(geometry.first(-3) + 1_024).toBeGreaterThan(0);
    expect(geometry.first(-4) + 1_024).toBe(0);
    expect(geometry.lastFrame).toBe(geometry.lastBefore(10_000));
    expect(geometry.first(geometry.lastFrame)).toBeLessThan(10_000);
    expect(geometry.first(geometry.lastFrame + 1)).toBeGreaterThanOrEqual(10_000);
  });
});

describe('a stream changed by a spectral edit', () => {
  it('leaves every sample no changed frame reaches as its input, bit for bit', async () => {
    const input = [noise(1, LENGTH), noise(2, LENGTH)];
    const edit = rectangleEdit(
      { kind: 'attenuate', gain: 0 },
      { start: 10_000, end: 12_000 },
      {
        low: 1_000,
        high: 3_000,
      },
    );
    const [left, right] = await readAllOf(spectralOver(input, edit).content, 4_096);
    const geometry = new FrameGeometry(1_024, MAXIMUM_QUALITY.settings.spectralOverlap, LENGTH);
    const reached = {
      start: geometry.first(Math.ceil(10_000 / geometry.hop)),
      end: geometry.first(Math.floor(12_000 / geometry.hop)) + 1_024,
    };
    for (const [made, given] of [
      [left, input[0]],
      [right, input[1]],
    ] as const) {
      if (made === undefined || given === undefined) throw new Error('Two channels were read.');
      expect(sameBits(made.subarray(0, reached.start), given.subarray(0, reached.start))).toBe(
        true,
      );
      expect(sameBits(made.subarray(reached.end), given.subarray(reached.end))).toBe(true);
      expect(
        sameBits(
          made.subarray(reached.start, reached.end),
          given.subarray(reached.start, reached.end),
        ),
      ).toBe(false);
    }
  });

  it('removes a tone in the band and keeps a tone outside it', async () => {
    const input = [tones(LENGTH, [1_000, 0.5], [5_000, 0.5])];
    const edit = rectangleEdit({ kind: 'attenuate', gain: 0 }, WHOLE, { low: 500, high: 1_500 });
    const [made = new Float32Array()] = await readAllOf(spectralOver(input, edit).content, 4_096);
    expect(amplitudeAt(made, 1_000, 2_048, LENGTH - 2_048)).toBeLessThan(0.005);
    expect(amplitudeAt(made, 5_000, 2_048, LENGTH - 2_048)).toBeCloseTo(0.5, 2);
  });

  it('attenuates a tone in the band by the gain', async () => {
    const input = [tones(LENGTH, [1_000, 0.5])];
    const edit = rectangleEdit({ kind: 'attenuate', gain: 0.5 }, WHOLE, { low: 500, high: 1_500 });
    const [made = new Float32Array()] = await readAllOf(spectralOver(input, edit).content, 4_096);
    expect(amplitudeAt(made, 1_000, 2_048, LENGTH - 2_048)).toBeCloseTo(0.25, 3);
  });

  it('isolates the band, reducing the rest of its span', async () => {
    const input = [tones(LENGTH, [1_000, 0.5], [5_000, 0.5])];
    const edit = rectangleEdit({ kind: 'isolate', gain: 0 }, WHOLE, { low: 500, high: 1_500 });
    const [made = new Float32Array()] = await readAllOf(spectralOver(input, edit).content, 4_096);
    expect(amplitudeAt(made, 1_000, 2_048, LENGTH - 2_048)).toBeCloseTo(0.5, 2);
    expect(amplitudeAt(made, 5_000, 2_048, LENGTH - 2_048)).toBeLessThan(0.005);
  });

  it('heals a burst into the tone around it', async () => {
    const clean = tones(LENGTH, [1_000, 0.5]);
    const burst = noise(9, LENGTH);
    const input = clean.map((sample, n) =>
      n >= 12_000 && n < 12_100 ? Math.fround(sample + (burst[n] ?? 0)) : sample,
    );
    // A frame changes where the mask covers its centre, so the mask covers
    // the centre of every frame that holds a sample of the burst, half a
    // resolution either side of it, as the burst drawn on a spectrogram does.
    const resolution = 1_024;
    const half = resolution / 2;
    const edit = rectangleEdit(
      { kind: 'heal' },
      { start: 12_000 - half, end: 12_100 + half },
      { low: 0, high: NYQUIST },
      { resolution },
    );
    const [made = new Float32Array()] = await readAllOf(spectralOver([input], edit).content, 4_096);
    const error = (signal: Float32Array): number => {
      let sum = 0;
      for (let n = 11_000; n < 13_000; n += 1) sum += ((signal[n] ?? 0) - (clean[n] ?? 0)) ** 2;
      return sum;
    };
    expect(error(made)).toBeLessThan(error(input) * 0.2);
  });

  it('takes no border from a frame cut short by the stream’s ends', async () => {
    // A steady tone healed over a mask half a frame from either end of the
    // stream: every frame bordering it holds samples past the stream, where a
    // frame cut short measures a spread of magnitude the tone does not have.
    const input = tones(LENGTH, [440, 0.3]);
    const resolution = 2_048;
    const edit = rectangleEdit(
      { kind: 'heal' },
      { start: resolution / 2, end: LENGTH - resolution / 2 },
      { low: 40, high: 10_000 },
      { resolution },
    );
    const [made = new Float32Array()] = await readAllOf(spectralOver([input], edit).content, 4_096);
    expect(relativeError(made, input, 0, LENGTH)).toBeLessThan(1e-6);
  });

  it('heals a burst in a tone over the range the domain places a heal of it in', async () => {
    // A sound longer than the edit's range, as an asset is, and the range
    // and the mask the domain places a heal of a selection of the burst at.
    const whole = 4 * LENGTH;
    const clean = tones(whole, [440, 0.3]);
    const burst = noise(11, whole);
    const input = clean.map((sample, n) =>
      n >= 48_000 && n < 48_200 ? Math.fround(sample + (burst[n] ?? 0)) : sample,
    );
    const resolution = 2_048;
    const placed = spectralPlacement(
      {
        shapes: [
          {
            kind: 'rectangle',
            effect: MaskEffect.Add,
            range: {
              start: derivedSampleCount(48_000 - resolution / 2),
              end: derivedSampleCount(48_200 + resolution / 2),
            },
            band: { low: 0, high: NYQUIST },
          },
        ],
        feather: { time: 0, frequency: 0 },
      },
      resolution,
      whole,
      'heal',
    );
    const [shape] = placed?.mask.shapes ?? [];
    if (placed === undefined || shape?.kind !== 'rectangle') throw new Error('Not placed.');
    const edit = rectangleEdit({ kind: 'heal' }, shape.range, shape.band, { resolution });
    const range = input.subarray(placed.start, placed.end);
    const [made = new Float32Array()] = await readAllOf(spectralOver([range], edit).content, 4_096);
    const cleanRange = clean.subarray(placed.start, placed.end);
    expect(relativeError(made, cleanRange, 0, range.length)).toBeLessThan(
      relativeError(range, cleanRange, 0, range.length) * 0.2,
    );
  });

  it('takes the masked part of a chain’s output in place of its input', async () => {
    const input = [noise(3, LENGTH)];
    const band = { low: 1_000, high: 8_000 };
    const range = { start: 6_000, end: 15_000 };
    const removed = await readAllOf(
      spectralOver(input, rectangleEdit({ kind: 'attenuate', gain: 0 }, range, band)).content,
      4_096,
    );
    // A chain that scales by nothing makes of the masked area what removing it makes.
    const silent = scalingChain({ factor: 0 });
    const processed = await readAllOf(
      spectralOver(
        input,
        rectangleEdit(
          {
            kind: 'process',
            chain: CHAIN,
            input: StandardLayouts.mono,
          },
          range,
          band,
        ),
        {
          wet: (stream) =>
            new ProcessedContent(
              CHAIN,
              {
                layout: StandardLayouts.mono,
                sampleRate: SPECTRAL_RATE,
                length: stream.length,
                read: (start, frames, into, signal) => stream.read(start, frames, into, signal),
              },
              StandardLayouts.mono,
              {
                processing: silent.processing,
                quality: MAXIMUM_QUALITY.settings,
                start: ProcessedStart.Canonical,
                dsp: REFERENCE_DSP,
              },
            ),
        },
      ).content,
      4_096,
    );
    expect(sameBits(processed[0] ?? new Float32Array(), removed[0] ?? new Float32Array())).toBe(
      true,
    );
    // The chain was run once, from the stream's start.
    expect(silent.starts).toEqual([0]);
  });

  it('gives the same bits however it is read: whole, in odd chunks, or from part way', async () => {
    const input = [noise(4, LENGTH)];
    const edit = rectangleEdit(
      { kind: 'heal' },
      { start: 7_000, end: 9_000 },
      { low: 200, high: 9_000 },
      { feather: { time: 300, frequency: 400 } },
    );
    const [whole = new Float32Array()] = await readAllOf(spectralOver(input, edit).content, LENGTH);
    const [chunked = new Float32Array()] = await readAllOf(spectralOver(input, edit).content, 997);
    const [partWay = new Float32Array()] = await readAllOf(
      spectralOver(input, edit).content,
      1_500,
      8_123,
    );
    expect(sameBits(chunked, whole)).toBe(true);
    expect(sameBits(partWay, whole.subarray(8_123))).toBe(true);
  });

  it('starts again where a read behind the last asks', async () => {
    const input = [noise(5, LENGTH)];
    const edit = rectangleEdit(
      { kind: 'attenuate', gain: 0.25 },
      { start: 3_000, end: 20_000 },
      { low: 0, high: 6_000 },
    );
    const { content } = spectralOver(input, edit);
    const [whole = new Float32Array()] = await readAllOf(spectralOver(input, edit).content, LENGTH);
    const later = new Float32Array(2_000);
    await content.read(15_000, 2_000, [later]);
    const earlier = new Float32Array(2_000);
    await content.read(5_000, 2_000, [earlier]);
    expect(sameBits(later, whole.subarray(15_000, 17_000))).toBe(true);
    expect(sameBits(earlier, whole.subarray(5_000, 7_000))).toBe(true);
  });

  it('reads its segments once, forwards, however many frames overlap', async () => {
    const input = [noise(6, LENGTH)];
    const edit = rectangleEdit({ kind: 'attenuate', gain: 0 }, WHOLE, { low: 0, high: NYQUIST });
    const { content, reads } = spectralOver(input, edit);
    await readAllOf(content, 512);
    expect(reads).toEqual([...reads].sort((a, b) => a - b));
    expect(new Set(reads).size).toBe(reads.length);
  });

  it('acts only on the channels it names', async () => {
    const input = [noise(7, LENGTH), noise(8, LENGTH)];
    const edit = rectangleEdit(
      { kind: 'attenuate', gain: 0 },
      WHOLE,
      { low: 0, high: NYQUIST },
      { channels: [1] },
    );
    const [left = new Float32Array(), right = new Float32Array()] = await readAllOf(
      spectralOver(input, edit).content,
      4_096,
    );
    expect(sameBits(left, input[0] ?? new Float32Array())).toBe(true);
    expect(amplitudeAt(right, 1_000, 2_048, LENGTH - 2_048)).toBeLessThan(0.01);
  });

  it('frames by the quality’s spectral overlap, so a preview’s quality makes its own answer', async () => {
    const input = [noise(10, LENGTH)];
    const edit = rectangleEdit(
      { kind: 'heal' },
      { start: 9_000, end: 10_000 },
      { low: 100, high: 5_000 },
    );
    const draft = namedQualityMode(QualityLevel.Draft).settings;
    const [maximum = new Float32Array()] = await readAllOf(
      spectralOver(input, edit).content,
      4_096,
    );
    const [drafted = new Float32Array()] = await readAllOf(
      spectralOver(input, edit, { quality: draft }).content,
      4_096,
    );
    expect(draft.spectralOverlap).not.toBe(MAXIMUM_QUALITY.settings.spectralOverlap);
    expect(sameBits(maximum, drafted)).toBe(false);
  });
});
