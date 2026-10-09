/**
 * A chain that runs as it is heard, previewed from part way (ADR-0060,
 * ADR-0061): playback starts the run at the chain's frame grid, at least its
 * lead-in before the first frame heard, runs the lead-in through unheard, and
 * so gives from that frame what a render from the stream's start gives. A
 * seek ahead starts the run again there rather than running the chain over
 * all it skips.
 */

import { describe, expect, it } from 'vitest';

import {
  MAXIMUM_QUALITY,
  StandardLayouts,
  createDeterministicIdGenerator,
  derivedSampleCount,
  instantiateProcessor,
  type EffectChain,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import {
  PcmDescriptionKind,
  ProcessedStart,
  REFERENCE_DSP,
  allocateBlock,
  describedSource,
  type ChainProcessing,
  type PcmSource,
} from '@audiogubbins/audio-engine';
import { rackedMedia, rackedPlan } from '@audiogubbins/audio-engine/testing';
import { PROCESSOR_TYPES_BY_KEY } from '@audiogubbins/processors';
import { TEST_RATE, learnedProfile, processorValues } from '@audiogubbins/processors/testing';
import { noise, sine } from '@audiogubbins/test-fixtures';

import { chainProcessing } from './chain-run.js';

const ids = createDeterministicIdGenerator(93);
const LENGTH = TEST_RATE;
const TYPE = PROCESSOR_TYPES_BY_KEY.get('noise-reduction');
if (TYPE === undefined) throw new Error('The catalogue has a noise reduction.');
const NOISE_REDUCTION = TYPE;

const hiss = noise(5, { length: LENGTH, amplitude: 0.1 }).channels[0] ?? new Float32Array(0);
const tone = sine(440, { amplitude: 0.25, length: LENGTH }).channels[0] ?? new Float32Array(0);
const SAMPLES = [tone.map((sample, frame) => sample + (hiss[frame] ?? 0))];

// With no smoothing a frame's gains depend on that frame alone, so a run on
// the grid settles to the very bits of a run from the start: a canonical
// chain whose lead-in is finite.
const VALUES = { reduction: 30, smoothing: 0 };
const CHAIN: EffectChain = {
  id: ids.next(),
  slots: [
    {
      ...instantiateProcessor(ids.next(), NOISE_REDUCTION.descriptor),
      values: processorValues(NOISE_REDUCTION, VALUES),
      state: learnedProfile(
        StandardLayouts.mono,
        [noise(9, { length: LENGTH, amplitude: 0.1 }).channels[0] ?? new Float32Array(0)],
        VALUES,
      ),
    },
  ],
};

/** The rack's processing, the frame each run it prepares starts at counted. */
function counted(): { readonly processing: ChainProcessing; readonly starts: number[] } {
  const rack = chainProcessing(PROCESSOR_TYPES_BY_KEY);
  const starts: number[] = [];
  return {
    starts,
    processing: {
      listening: (request) => rack.listening(request),
      measurementBytes: (request) => rack.measurementBytes(request),
      prepareLive: (request) => rack.prepareLive(request),
      prepare: (request, read, signal) => {
        starts.push(request.start);
        return rack.prepare(request, read, signal);
      },
    },
  };
}

function sourceOf(processing: ChainProcessing, start: ProcessedStart): PcmSource {
  return expectSuccess(
    describedSource(
      {
        kind: PcmDescriptionKind.Edited,
        sampleRate: TEST_RATE,
        plan: rackedPlan(CHAIN, LENGTH, TEST_RATE),
        media: [rackedMedia(SAMPLES, TEST_RATE)],
      },
      StandardLayouts.mono,
      REFERENCE_DSP,
      { processing, quality: MAXIMUM_QUALITY.settings, start },
    ),
  );
}

async function readFrom(source: PcmSource, start: number, frames: number): Promise<Float32Array> {
  const block = allocateBlock(source.layout, source.sampleRate, frames);
  await source.read(derivedSampleCount(start), block);
  return block.channels[0] ?? new Float32Array();
}

const RENDER = await (async () => {
  const source = sourceOf(chainProcessing(PROCESSOR_TYPES_BY_KEY), ProcessedStart.Canonical);
  const whole = await readFrom(source, 0, LENGTH);
  source.release();
  return whole;
})();

describe('a chain that runs as it is heard, previewed from part way', () => {
  it('runs its lead-in unheard from the grid point, and gives from there the render’s very bits', async () => {
    const { leadIn, frameGrid } = expectSuccess(
      chainProcessing(PROCESSOR_TYPES_BY_KEY).listening({
        chain: CHAIN,
        input: StandardLayouts.mono,
        sampleRate: TEST_RATE,
        quality: MAXIMUM_QUALITY.settings,
      }),
    ).partWay;
    expect(leadIn).toBeGreaterThan(0);
    for (const from of [17_123, 30_000]) {
      const { processing, starts } = counted();
      const preview = sourceOf(processing, ProcessedStart.Preview);
      const heard = await readFrom(preview, from, 8_000);
      preview.release();
      expect(starts).toEqual([Math.floor((from - leadIn) / frameGrid) * frameGrid]);
      expect(heard, String(from)).toEqual(RENDER.subarray(from, from + 8_000));
    }
  });

  it('starts again at the grid after a seek ahead, rather than running the chain over what it skips', async () => {
    const { processing, starts } = counted();
    const preview = sourceOf(processing, ProcessedStart.Preview);
    await readFrom(preview, 0, 4_096);
    const heard = await readFrom(preview, 40_000, 4_096);
    preview.release();
    expect(starts).toHaveLength(2);
    expect(starts[1]).toBeGreaterThan(4_096);
    expect(heard).toEqual(RENDER.subarray(40_000, 44_096));
  });
});
