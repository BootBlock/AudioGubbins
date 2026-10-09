/**
 * Delay compensation in the rack around a slot with latency (ADR-0060,
 * ADR-0061): its dry part where it is mixed under one, branches of a group of
 * unequal latency, and a latent slot bypassed. Each run's output, its stated
 * latency cut, must be the input processed as though nothing were late.
 */

import { describe, expect, it } from 'vitest';

import {
  MAXIMUM_QUALITY,
  StandardLayouts,
  SummingLaw,
  createDeterministicIdGenerator,
  instantiateProcessor,
  type ChainSlot,
  type EffectChain,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { REFERENCE_DSP, decibelsToGain } from '@audiogubbins/audio-engine';
import { PROCESSOR_TYPES_BY_KEY, type ProcessorType } from '@audiogubbins/processors';
import { TEST_RATE, delayingProcessor, processorValues } from '@audiogubbins/processors/testing';
import { noise } from '@audiogubbins/test-fixtures';

import { chainProcessing } from './chain-run.js';

const ids = createDeterministicIdGenerator(131);

const LONG = delayingProcessor(37);
const SHORT = delayingProcessor(11);
const TYPES: ReadonlyMap<string, ProcessorType> = new Map([
  ...PROCESSOR_TYPES_BY_KEY,
  ...[LONG, SHORT].map((type) => [type.descriptor.typeKey, type] as const),
]);

function typeOf(key: string): ProcessorType {
  const type = TYPES.get(key);
  if (type === undefined) throw new Error(`The catalogue has a ${key} processor.`);
  return type;
}

/** A slot of `type` at `values`, mixed `mix` with its input. */
function slot(
  type: ProcessorType,
  values: Readonly<Record<string, number>> = {},
  mix = 1,
): ChainSlot {
  const made = instantiateProcessor(ids.next(), type.descriptor);
  return { ...made, mix, values: processorValues(type, values) };
}

const LENGTH = 6_007;
/** Noise at a tenth of full scale, under any ceiling a limiter here is given. */
const INPUT = Float32Array.from(
  noise(7).channels[0]?.slice(0, LENGTH) ?? new Float32Array(LENGTH),
  (sample) => sample / 10,
);

/** The run of `slots` over the input, its whole output with its stated latency cut, and that latency. */
async function heard(
  slots: readonly ChainSlot[],
): Promise<{ readonly out: Float32Array; readonly latency: number }> {
  const chain: EffectChain = { id: ids.next(), slots };
  const run = expectSuccess(
    await chainProcessing(TYPES).prepare(
      {
        chain,
        input: StandardLayouts.mono,
        sampleRate: TEST_RATE,
        length: LENGTH,
        quality: MAXIMUM_QUALITY.settings,
        blockFrames: 512,
        dsp: REFERENCE_DSP,
        start: 0,
      },
      async (from, frames, into) => {
        into[0]?.set(INPUT.subarray(from, from + frames));
        await Promise.resolve();
      },
    ),
  );
  const total = LENGTH + run.latency;
  const out = new Float32Array(total);
  for (let done = 0; done < total; done += 512) {
    const frames = Math.min(512, total - done);
    const block = new Float32Array(frames);
    block.set(INPUT.subarray(done, Math.min(LENGTH, done + frames)));
    run.process([block], [out.subarray(done, done + frames)], frames);
  }
  const { latency } = run;
  run.release();
  return { out: out.subarray(latency), latency };
}

/** The largest difference between `out` and `expected` of each input sample. */
function worst(out: Float32Array, expected: (sample: number) => number): number {
  let largest = 0;
  for (const [frame, sample] of INPUT.entries()) {
    largest = Math.max(largest, Math.abs((out[frame] ?? 0) - expected(sample)));
  }
  return largest;
}

describe('the rack’s delay compensation around a slot with latency', () => {
  it('puts the dry part of a latent slot mixed under one back in time with its wet part', async () => {
    const { out, latency } = await heard([slot(LONG, {}, 0.25)]);
    expect(latency).toBe(37);
    // Each path is a gain node's f32 result, which the mix node adds in f64.
    expect(worst(out, (x) => Math.fround(Math.fround(x * 0.75) + Math.fround(x * 0.25)))).toBe(0);
  });

  it('puts a catalogue processor’s dry part back in time too, mixed at a half', async () => {
    // Under its ceiling the limiter gives its input back exactly, its latency late.
    const { out, latency } = await heard([slot(typeOf('limiter'), { ceiling: 0 }, 0.5)]);
    expect(latency).toBeGreaterThan(0);
    expect(worst(out, (x) => Math.fround(Math.fround(x * 0.5) + Math.fround(x * 0.5)))).toBe(0);
  });

  it('aligns a group’s branches of unequal latency, an empty one among them', async () => {
    const boost = decibelsToGain(6);
    const group: ChainSlot = {
      kind: 'group',
      id: ids.next(),
      enabled: true,
      soloed: false,
      mix: 1,
      summing: SummingLaw.Sum,
      branches: [
        { slots: [slot(LONG)] },
        { slots: [slot(SHORT), slot(typeOf('gain'), { gain: 6 })] },
        { slots: [] },
      ],
    };
    const { out, latency } = await heard([group]);
    expect(latency).toBe(37);
    expect(worst(out, (x) => x + Math.fround(x * boost) + x)).toBeLessThan(1e-7);
  });

  it('keeps every other slot in time with a latent slot bypassed', async () => {
    const up = decibelsToGain(20);
    const down = decibelsToGain(-6);
    // Raised 20 dB, the input is far over the bypassed limiter's ceiling,
    // which would be heard if it ran.
    const { out } = await heard([
      slot(typeOf('gain'), { gain: 20 }),
      { ...slot(LONG), enabled: false },
      { ...slot(typeOf('limiter'), { ceiling: -12 }), enabled: false },
      slot(typeOf('gain'), { gain: -6 }),
    ]);
    expect(worst(out, (x) => Math.fround(Math.fround(x * up) * down))).toBe(0);
  });
});
