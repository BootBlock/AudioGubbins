import { describe, expect, it } from 'vitest';

import {
  MAXIMUM_QUALITY,
  StandardLayouts,
  createDeterministicIdGenerator,
  instantiateProcessor,
  type ChainSlot,
  type EffectChain,
} from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { REFERENCE_DSP, decibelsToGain } from '@audiogubbins/audio-engine';
import { PROCESSOR_TYPES_BY_KEY } from '@audiogubbins/processors';
import { TEST_RATE, processorValues } from '@audiogubbins/processors/testing';
import { noise } from '@audiogubbins/test-fixtures';

import { chainProcessing } from './chain-run.js';

const ids = createDeterministicIdGenerator(81);
const TYPES = PROCESSOR_TYPES_BY_KEY;
const GAIN = TYPES.get('gain');
if (GAIN === undefined) throw new Error('The catalogue has a gain processor.');
const GAIN_TYPE = GAIN;

/** A gain processor at `decibels`, mixed `mix` with its input. */
function gain(decibels: number, mix = 1): ChainSlot {
  const made = instantiateProcessor(ids.next(), GAIN_TYPE.descriptor);
  return { ...made, mix, values: processorValues(GAIN_TYPE, { gain: decibels }) };
}

const LENGTH = 9_001;
const input = [noise(1).channels[0]?.slice(0, LENGTH) ?? new Float32Array(LENGTH)];

/** The chain run over `input` from its first frame, whole. */
async function runChain(slots: readonly ChainSlot[]): Promise<Float32Array[]> {
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
      },
      async (start, frames, into) => {
        into[0]?.set(input[0]?.subarray(start, start + frames) ?? []);
        await Promise.resolve();
      },
    ),
  );
  const out = [new Float32Array(LENGTH)];
  run.process(input, out, LENGTH);
  run.release();
  return out;
}

/** Each sample as `scale` of the input's, in f64, stored once as f32, as the gain node does. */
function scaled(scale: number): Float32Array {
  return Float32Array.from(input[0] ?? [], (sample) => sample * scale);
}

describe('a chain run over a stream (ADR-0060)', () => {
  it('runs the slots in series, each at its own level', async () => {
    const [out] = await runChain([gain(6), gain(-12)]);
    const expected = Float32Array.from(
      scaled(decibelsToGain(6)),
      (sample) => sample * decibelsToGain(-12),
    );
    expect(out).toEqual(expected);
  });

  it('passes a bypassed slot by and hears only the soloed one', async () => {
    const bypassed = { ...gain(-40), enabled: false };
    expect((await runChain([bypassed]))[0]).toEqual(input[0]);
    const soloed = { ...gain(6), soloed: true };
    expect((await runChain([gain(-40), soloed]))[0]).toEqual(scaled(decibelsToGain(6)));
  });

  it('mixes a slot with its input by its mix, the dry input and the wet output each scaled and summed', async () => {
    const [out] = await runChain([gain(6, 0.25)]);
    const wet = decibelsToGain(6);
    for (const [frame, sample] of (input[0] ?? []).entries()) {
      // Each path is a gain node's f32 result; the mix node sums them in f64.
      const dry = Math.fround(sample * 0.75);
      const processed = Math.fround(Math.fround(sample * wet) * 0.25);
      expect(out?.[frame]).toBe(Math.fround(dry + processed));
    }
  });

  it('adds a group’s branches by its law, an empty branch being the input itself', async () => {
    const group: ChainSlot = {
      kind: 'group',
      id: ids.next(),
      enabled: true,
      soloed: false,
      mix: 1,
      summing: 'mean',
      branches: [{ slots: [gain(6)] }, { slots: [] }],
    };
    const [out] = await runChain([group]);
    const loud = scaled(decibelsToGain(6));
    for (const [frame, sample] of (input[0] ?? []).entries()) {
      // The mix node adds each input times its gain in f64, in port order.
      expect(out?.[frame]).toBe(Math.fround((loud[frame] ?? 0) * 0.5 + sample * 0.5));
    }
  });

  it('refuses a processor type this build does not have, with the reason', async () => {
    const stranger = { ...gain(0), typeKey: 'from-a-later-build' };
    const chain: EffectChain = { id: ids.next(), slots: [stranger] };
    const prepared = await chainProcessing(TYPES).prepare(
      {
        chain,
        input: StandardLayouts.mono,
        sampleRate: TEST_RATE,
        length: LENGTH,
        quality: MAXIMUM_QUALITY.settings,
        blockFrames: 512,
        dsp: REFERENCE_DSP,
      },
      () => Promise.resolve(),
    );
    expect(expectFailureCode(prepared)).toBe('effect-rack.processor-unknown');
  });
});
