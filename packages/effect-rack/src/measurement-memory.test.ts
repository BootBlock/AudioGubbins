/**
 * What a chain's whole passes hold while a render is made (ADR-0061): the
 * preview cache counts it against its bound before a render starts, so a
 * model's output over the whole stream, which a render's samples alone do not
 * show, is what the rack must say.
 */

import { describe, expect, it } from 'vitest';

import {
  MAXIMUM_QUALITY,
  StandardLayouts,
  createDeterministicIdGenerator,
  instantiateProcessor,
  type ChainSlot,
  type ChannelLayout,
  type EffectChain,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import {
  ModelUnavailability,
  PROCESSOR_CATALOGUE,
  modelUnavailable,
  processorTypesWith,
  type ModelServices,
} from '@audiogubbins/processors';
import { TEST_RATE } from '@audiogubbins/processors/testing';

import { chainProcessing } from './chain-run.js';

const ids = createDeterministicIdGenerator(62);

/** Services no model is run through: nothing here runs a chain. */
const NO_MODELS: ModelServices = {
  inference: {
    open: () => {
      throw new Error('No model is run while a chain’s memory is counted.');
    },
  },
  models: {
    available: (pack, version) =>
      Promise.resolve(
        modelUnavailable(ModelUnavailability.RequiredUnavailable, 'No pack is kept here.', {
          pack,
          version,
        }),
      ),
    file: (pack, version) =>
      Promise.resolve(
        modelUnavailable(ModelUnavailability.RequiredUnavailable, 'No pack is kept here.', {
          pack,
          version,
        }),
      ),
  },
};

const PROCESSING = chainProcessing(processorTypesWith(NO_MODELS));

/** A minute at the test rate. */
const FRAMES = 60 * 48_000;

function slotOf(typeKey: string): ChainSlot {
  const descriptor = PROCESSOR_CATALOGUE.get(typeKey);
  if (descriptor === undefined) throw new Error(`The catalogue has ${typeKey}.`);
  return instantiateProcessor(ids.next(), descriptor);
}

function bytesOf(slots: readonly ChainSlot[], input: ChannelLayout = StandardLayouts.mono) {
  const chain: EffectChain = { id: ids.next(), slots };
  return expectSuccess(
    PROCESSING.measurementBytes({
      chain,
      input,
      sampleRate: TEST_RATE,
      quality: MAXIMUM_QUALITY.settings,
      length: FRAMES,
    }),
  );
}

/** A model's output over the stream, held twice while it is made planar. */
const MODEL_OUTPUT = 2 * FRAMES * Float32Array.BYTES_PER_ELEMENT;

describe('what a chain’s whole passes hold over a stream', () => {
  it('counts a model’s output over the whole stream, per channel', () => {
    expect(bytesOf([slotOf('deepfilternet-3')])).toBe(MODEL_OUTPUT);
    expect(bytesOf([slotOf('deepfilternet-3')], StandardLayouts.stereo)).toBe(2 * MODEL_OUTPUT);
  });

  it('adds the passes a chain keeps until its run ends, and counts nothing a pass of numbers holds', () => {
    expect(bytesOf([slotOf('peak-normalisation')])).toBe(0);
    expect(
      bytesOf([slotOf('deepfilternet-3'), slotOf('peak-normalisation'), slotOf('deepfilternet-3')]),
    ).toBe(2 * MODEL_OUTPUT);
  });

  it('counts nothing for a model whose slot is bypassed, which runs no pass', () => {
    expect(bytesOf([{ ...slotOf('deepfilternet-3'), enabled: false }])).toBe(0);
  });
});
