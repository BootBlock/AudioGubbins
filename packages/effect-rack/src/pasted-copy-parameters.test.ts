/**
 * A numeric parameter changed while a sound plays that holds a paste of its
 * own racked audio (REQ-AUDIO-019, ADR-0053): the paste's chain keeps the
 * identifiers of the rack it was copied from, so the change reaches the one
 * stream it names, and the pasted copy plays the value it was pasted with.
 */

import { describe, expect, it } from 'vitest';

import {
  MAXIMUM_QUALITY,
  StandardLayouts,
  createDeterministicIdGenerator,
  derivedSampleCount,
  instantiateProcessor,
  type EditPlan,
  type EffectChain,
  type ProcessorId,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import {
  PcmDescriptionKind,
  ProcessedStart,
  REFERENCE_DSP,
  RunningParameters,
  allocateBlock,
  describedSource,
} from '@audiogubbins/audio-engine';
import { RACKED_ASSET, rackedMedia } from '@audiogubbins/audio-engine/testing';
import { PROCESSOR_TYPES_BY_KEY } from '@audiogubbins/processors';
import { TEST_RATE, processorValues } from '@audiogubbins/processors/testing';

import { chainProcessing } from './chain-run.js';

const ids = createDeterministicIdGenerator(83);
const HALF = 12_000;
const GAIN_TYPE = PROCESSOR_TYPES_BY_KEY.get('gain');
const LEVEL_PARAMETER = GAIN_TYPE?.descriptor.parameters[0];
if (GAIN_TYPE === undefined || LEVEL_PARAMETER === undefined) {
  throw new Error('The catalogue has a gain.');
}
const GAIN = GAIN_TYPE;
const LEVEL = LEVEL_PARAMETER;

const SAMPLES = [
  Float32Array.from({ length: HALF }, (_, frame) => Math.fround(Math.sin(frame / 7) * 0.5)),
];

function gainChain(processor: ProcessorId, decibels: number): EffectChain {
  return {
    id: ids.next(),
    slots: [
      {
        ...instantiateProcessor(processor, GAIN.descriptor),
        values: processorValues(GAIN, { gain: decibels }),
      },
    ],
  };
}

/**
 * The asset racked with `live` at place 1, and its paste at place 2 with
 * `pasted`, the two heard one after the other.
 */
function withPaste(live: EffectChain, pasted: EffectChain): EditPlan {
  const whole = {
    start: derivedSampleCount(0),
    length: derivedSampleCount(HALF),
    reversed: false,
    stages: [],
  };
  const layout = StandardLayouts.mono;
  const racked = (chain: EffectChain) => ({
    sampleRate: TEST_RATE,
    layout,
    segments: [{ ...whole, source: { kind: 'media', asset: RACKED_ASSET } as const }],
    processing: { kind: 'chain', chain, input: layout } as const,
  });
  return {
    streams: [
      {
        sampleRate: TEST_RATE,
        layout,
        segments: [
          { ...whole, source: { kind: 'stream', stream: 1 } },
          { ...whole, source: { kind: 'stream', stream: 2 } },
        ],
      },
      racked(live),
      racked(pasted),
    ],
  };
}

/** The whole of `plan` as a preview plays it, `change` given before it is read. */
async function heard(plan: EditPlan, change?: (parameters: RunningParameters) => void) {
  const parameters = new RunningParameters();
  const source = expectSuccess(
    describedSource(
      {
        kind: PcmDescriptionKind.Edited,
        sampleRate: TEST_RATE,
        plan,
        media: [rackedMedia(SAMPLES, TEST_RATE)],
      },
      StandardLayouts.mono,
      REFERENCE_DSP,
      {
        processing: chainProcessing(PROCESSOR_TYPES_BY_KEY),
        quality: MAXIMUM_QUALITY.settings,
        start: ProcessedStart.Preview,
        parameters,
      },
    ),
  );
  change?.(parameters);
  const block = allocateBlock(source.layout, source.sampleRate, HALF * 2);
  await source.read(derivedSampleCount(0), block);
  source.release();
  return block.channels[0] ?? new Float32Array();
}

describe('a parameter changed while a paste of its racked audio plays beside it', () => {
  it('changes the stream it names, the pasted copy playing the value it was pasted with', async () => {
    const processor: ProcessorId = ids.next();
    const plan = withPaste(gainChain(processor, -6), gainChain(processor, -6));
    const changed = await heard(plan, (parameters) => {
      expectSuccess(parameters.apply({ stream: 1, processor, parameter: LEVEL.id, value: 0 }));
    });

    const expected = await heard(withPaste(gainChain(processor, 0), gainChain(processor, -6)));
    expect(changed).toEqual(expected);
    expect(changed.subarray(0, HALF)).not.toEqual(changed.subarray(HALF));
  });
});
