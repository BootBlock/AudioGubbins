/**
 * One authority for how a chain is heard (ADR-0061): the page says, from the
 * catalogue's descriptors, what the threads that play a chain do, for every
 * type the catalogue lists, the machine-learning ones among them.
 */

import { describe, expect, it } from 'vitest';

import {
  AmbisonicNormalisation,
  AmbisonicOrdering,
  MAXIMUM_QUALITY,
  StandardLayouts,
  ambisonicLayout,
  chainListening,
  createDeterministicIdGenerator,
  instantiateProcessor,
  namedQualityMode,
  QualityLevel,
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

const ids = createDeterministicIdGenerator(61);

/** The layouts a type is tried on, in turn, until one is a layout it takes. */
const LAYOUTS: readonly ChannelLayout[] = [
  StandardLayouts.mono,
  StandardLayouts.stereo,
  expectSuccess(
    ambisonicLayout({
      order: 1,
      ordering: AmbisonicOrdering.Acn,
      normalisation: AmbisonicNormalisation.Sn3d,
    }),
  ),
];

/**
 * Services no model is run through: how a chain is heard is read from the
 * types' descriptors, and nothing here plays a chain.
 */
const NO_MODELS: ModelServices = {
  inference: {
    open: () => {
      throw new Error('No model is run while how a chain is heard is read.');
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

/** What the threads run chains with: every type, those that run a model among them. */
const PROCESSING = chainProcessing(processorTypesWith(NO_MODELS));

describe('how a chain is heard, as the page says and as the threads play it', () => {
  it('agrees for every type of the catalogue, alone and after a type heard from a render', () => {
    const normalisation = PROCESSOR_CATALOGUE.get('peak-normalisation');
    if (normalisation === undefined) throw new Error('The catalogue has a peak normalisation.');
    let compared = 0;
    for (const descriptor of PROCESSOR_CATALOGUE.values()) {
      const input = LAYOUTS.find((layout) => descriptor.outputLayout(layout, new Map()).ok);
      if (input === undefined) throw new Error(`No layout is taken by ${descriptor.typeKey}.`);
      const alone: EffectChain = {
        id: ids.next(),
        slots: [instantiateProcessor(ids.next(), descriptor)],
      };
      const after: EffectChain = {
        id: ids.next(),
        slots: [instantiateProcessor(ids.next(), normalisation), ...alone.slots],
      };
      for (const chain of [alone, after]) {
        for (const quality of [MAXIMUM_QUALITY, namedQualityMode(QualityLevel.Draft)]) {
          const settings = { sampleRate: TEST_RATE, quality: quality.settings };
          const played = PROCESSING.listening({ chain, input, ...settings });
          expect(expectSuccess(played), descriptor.typeKey).toEqual(
            chainListening(chain, PROCESSOR_CATALOGUE, settings),
          );
          compared += 1;
        }
      }
    }
    expect(compared).toBe(PROCESSOR_CATALOGUE.size * 4);
  });

  it('says a chain the threads hear from a render is heard from one, for its reason', () => {
    const model = PROCESSOR_CATALOGUE.get('deepfilternet-3');
    if (model === undefined) throw new Error('The catalogue has DeepFilterNet 3.');
    const chain: EffectChain = { id: ids.next(), slots: [instantiateProcessor(ids.next(), model)] };
    const settings = { sampleRate: TEST_RATE, quality: MAXIMUM_QUALITY.settings };

    expect(chainListening(chain, PROCESSOR_CATALOGUE, settings)).toMatchObject({
      kind: 'rendered',
      reason: expect.stringContaining('DeepFilterNet 3'),
    });
  });
});
