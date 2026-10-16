/**
 * A game preview's varispeed stream (ADR-0104): a stream played at a ratio of
 * whole 4,096ths by the canonical resampler run with whole steps, so its pitch
 * and speed change together, its output stays at its source's rate, and its
 * filter's cost at each grade is the one `resampling-grade.ts` states.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import {
  MAXIMUM_QUALITY,
  ResamplingGrade,
  StandardLayouts,
  VARISPEED_DENOMINATOR,
  convertedFrameCount,
  derivedSampleCount,
  namedQualityMode,
  sampleRate,
  type EditPlan,
  type PlanSegment,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import { ResamplingQuality, type CanonicalDsp } from '../dsp/canonical-dsp.js';
import { REFERENCE_DSP } from '../dsp/reference/reference-dsp.js';
import {
  VARISPEED_MOST_TAPS,
  resamplingQualityOf,
  varispeedTableBytes,
} from '../dsp/resampling-grade.js';
import { wasmDsp } from '../dsp/wasm/wasm-dsp.js';
import { dspModuleExports } from '../testing/dsp-module.js';
import { RACKED_ASSET, rackedMedia } from '../testing/racked-plan.js';
import { editedSource } from './edited-source.js';
import { allocateBlock } from './frame-block.js';
import { memorySource } from './memory-source.js';
import type { PcmSource } from './pcm-source.js';
import { ProcessedStart } from './processed-content.js';
import { resampledSource, varispeedSource } from './resampled-source.js';

const RATE = expectSuccess(sampleRate(48_000));
const MONO = StandardLayouts.mono;
const FRAMES = 3_000;
const SIGNAL = Float32Array.from({ length: FRAMES }, (_, frame) =>
  Math.fround(Math.sin(frame / 7) * 0.5 + ((frame % 13) - 6) / 64),
);

function sourceAt(rate: number): PcmSource {
  const block = allocateBlock(MONO, expectSuccess(sampleRate(rate)), FRAMES);
  block.channels[0]?.set(SIGNAL);
  return expectSuccess(memorySource(block));
}

/** Every frame `source` gives, read in chunks of 512. */
async function everything(source: PcmSource): Promise<number[]> {
  const heard: number[] = [];
  const block = allocateBlock(source.layout, source.sampleRate, 512);
  for (let at = 0; ; at += 512) {
    const got = await source.read(derivedSampleCount(at), block);
    heard.push(...(block.channels[0]?.subarray(0, got) ?? []));
    if (got < 512) return heard;
  }
}

let wasm: CanonicalDsp;

beforeAll(async () => {
  wasm = expectSuccess(wasmDsp(await dspModuleExports()));
});

describe.each([
  ['the WebAssembly module', () => wasm],
  ['the reference path', () => REFERENCE_DSP],
])('a varispeed on %s', (_path, dspOf) => {
  it('plays its source as a conversion of the same reduced ratio would, at its source’s own rate', async () => {
    // 6,144 / 4,096 is 3 / 2: what a conversion from 72 kHz to 48 kHz makes.
    const played = expectSuccess(
      varispeedSource(dspOf(), sourceAt(48_000), 6_144, ResamplingQuality.High),
    );
    const converted = expectSuccess(
      resampledSource(dspOf(), sourceAt(72_000), RATE, ResamplingQuality.High),
    );

    expect(played.sampleRate).toBe(RATE);
    expect(played.length).toBe(convertedFrameCount(FRAMES, 6_144, VARISPEED_DENOMINATOR));
    expect(played.length).toBe(2_000);
    expect(await everything(played)).toEqual(await everything(converted));
  });

  it('plays two octaves down at a project rate as low as a sample rate may be, which no declared rate could', async () => {
    const low = expectSuccess(sampleRate(8_000));
    const block = allocateBlock(MONO, low, FRAMES);
    block.channels[0]?.set(SIGNAL);
    const played = expectSuccess(
      varispeedSource(dspOf(), expectSuccess(memorySource(block)), 1_024, ResamplingQuality.Draft),
    );

    expect(played.sampleRate).toBe(low);
    expect(await everything(played)).toHaveLength(4 * FRAMES);
  });

  it.each([ResamplingGrade.Draft, ResamplingGrade.High, ResamplingGrade.Maximum])(
    'has at %s no more taps, and holds no larger a table, than its grade states',
    (grade) => {
      const played = (numerator: number) =>
        expectSuccess(
          varispeedSource(dspOf(), sourceAt(48_000), numerator, resamplingQualityOf(grade)),
        );

      // Two octaves up the filter is longest; just below, in lowest terms, it has every phase.
      expect(2 * played(16_384).lookahead + 1).toBe(VARISPEED_MOST_TAPS[grade]);
      const widest = played(16_383);
      expect(widest.coefficients.tableBytes).toBe(
        (2 * widest.lookahead + 1) * 8 * VARISPEED_DENOMINATOR + VARISPEED_DENOMINATOR,
      );
      for (const numerator of [1_024, 3_001, 4_095, 4_097, 8_191, 12_345, 16_383, 16_384]) {
        const one = played(numerator);
        expect(2 * one.lookahead + 1, String(numerator)).toBeLessThanOrEqual(
          VARISPEED_MOST_TAPS[grade],
        );
        expect(one.coefficients.tableBytes, String(numerator)).toBeLessThanOrEqual(
          varispeedTableBytes(grade),
        );
      }
    },
  );
});

describe('a plan’s varispeed stream, read by an edited source', () => {
  function whole(source: PlanSegment['source'], length: number): PlanSegment {
    return {
      source,
      start: derivedSampleCount(0),
      length: derivedSampleCount(length),
      reversed: false,
      stages: [],
    };
  }

  it('sounds as the canonical resampler plays its segment, at the reading’s grade', async () => {
    const numerator = 5_000;
    const heard = convertedFrameCount(FRAMES, numerator, VARISPEED_DENOMINATOR);
    const plan: EditPlan = {
      streams: [
        { sampleRate: RATE, layout: MONO, segments: [whole({ kind: 'stream', stream: 1 }, heard)] },
        {
          sampleRate: RATE,
          layout: MONO,
          segments: [whole({ kind: 'stream', stream: 2 }, FRAMES)],
          processing: { kind: 'varispeed', numerator, denominator: VARISPEED_DENOMINATOR },
        },
        {
          sampleRate: RATE,
          layout: MONO,
          segments: [whole({ kind: 'media', asset: RACKED_ASSET }, FRAMES)],
        },
      ],
    };
    const draft = namedQualityMode('draft').settings;
    const source = expectSuccess(
      editedSource(plan, [rackedMedia([SIGNAL], RATE)], MONO, REFERENCE_DSP, {
        processing: {
          listening: () => {
            throw new Error('No chain is run.');
          },
          measurementBytes: () => {
            throw new Error('No chain is run.');
          },
          prepare: () => {
            throw new Error('No chain is run.');
          },
          prepareLive: () => {
            throw new Error('No chain is run.');
          },
        },
        quality: draft,
        start: ProcessedStart.Preview,
      }),
    );
    const direct = expectSuccess(
      varispeedSource(REFERENCE_DSP, sourceAt(48_000), numerator, ResamplingQuality.Draft),
    );
    const atMaximum = expectSuccess(
      varispeedSource(REFERENCE_DSP, sourceAt(48_000), numerator, ResamplingQuality.Maximum),
    );

    const rendered = await everything(source);
    expect(rendered).toHaveLength(heard);
    expect(rendered).toEqual(await everything(direct));
    expect(rendered).not.toEqual(await everything(atMaximum));
    expect(MAXIMUM_QUALITY.settings.resampling).not.toBe(draft.resampling);
    source.release();
  });
});
