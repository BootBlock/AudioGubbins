/**
 * A chain that holds every shape a chain can take, for the tests that hold a
 * persisted form to give back what it was given (ADR-0060): a slot of each
 * kind, bypassed, soloed and partly wet; a group of each summing law, one with
 * a branch of no slots, which is a dry path; groups nested as deep as the
 * domain lets them; and a processor with state, a resampler's version and a
 * model's identity, besides values of every kind. Every processor of it is one
 * {@link CHAIN_SHAPES_CATALOGUE} has.
 */

import {
  MAXIMUM_GROUP_DEPTH,
  SummingLaw,
  instantiateProcessor,
  type ChainSlot,
  type EffectChain,
  type IdGenerator,
  type ParameterId,
  type ParameterValue,
  type ProcessorCatalogue,
  type ProcessorDescriptor,
  type ProcessorInstance,
} from '@audiogubbins/domain';
import {
  CUTOFF,
  GENTLE,
  TEST_CATALOGUE,
  TEST_FILTER,
  TEST_LIMITER,
} from '@audiogubbins/domain/testing';

/** A filter whose version names a resampler and a model, as an ML processor's does. */
const MODELLED_FILTER: ProcessorDescriptor = {
  ...TEST_FILTER,
  typeKey: 'modelled-low-pass-filter',
  version: {
    implementation: 3,
    parameters: 2,
    resampler: 1,
    model: {
      pack: 'test-pack',
      version: '1.2.0',
      modelHash: 'a'.repeat(64),
      runtimeHash: 'b'.repeat(64),
    },
  },
};

/** The test catalogue, with the type {@link fullySetProcessor} is of. */
export const CHAIN_SHAPES_CATALOGUE: ProcessorCatalogue = new Map([
  ...TEST_CATALOGUE,
  [MODELLED_FILTER.typeKey, MODELLED_FILTER],
]);

/** A processor whose settings hold every member a processor can be saved with. */
export function fullySetProcessor(ids: IdGenerator): ProcessorInstance {
  return {
    ...instantiateProcessor(ids.next<'ProcessorId'>(), MODELLED_FILTER),
    mix: 0.375,
    values: new Map<ParameterId, ParameterValue>([
      [CUTOFF, 2_437.5],
      [GENTLE, true],
    ]),
    state: { kind: 'noise-profile', values: [0.25, -1.5e-7, 1_000] },
  };
}

/** Groups nested `depth` deep, the innermost holding a limiter. */
function nested(ids: IdGenerator, depth: number): ChainSlot {
  if (depth === 0) return instantiateProcessor(ids.next<'ProcessorId'>(), TEST_LIMITER);
  return {
    kind: 'group',
    id: ids.next<'ProcessorGroupId'>(),
    enabled: true,
    soloed: false,
    mix: 1,
    summing: SummingLaw.EqualPower,
    branches: [{ slots: [nested(ids, depth - 1)] }],
  };
}

/** A chain of every shape (see the module comment). */
export function everyChainShape(ids: IdGenerator): EffectChain {
  const limiter = instantiateProcessor(ids.next<'ProcessorId'>(), TEST_LIMITER);
  return {
    id: ids.next<'EffectChainId'>(),
    slots: [
      fullySetProcessor(ids),
      { ...instantiateProcessor(ids.next<'ProcessorId'>(), TEST_FILTER), enabled: false },
      {
        kind: 'group',
        id: ids.next<'ProcessorGroupId'>(),
        enabled: true,
        soloed: true,
        mix: 0.5,
        summing: SummingLaw.Mean,
        branches: [{ slots: [{ ...limiter, soloed: true }] }, { slots: [] }],
      },
      {
        kind: 'group',
        id: ids.next<'ProcessorGroupId'>(),
        enabled: false,
        soloed: false,
        mix: 0,
        summing: SummingLaw.Sum,
        branches: [{ slots: [nested(ids, MAXIMUM_GROUP_DEPTH - 1)] }],
      },
    ],
  };
}
