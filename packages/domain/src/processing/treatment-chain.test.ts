import { describe, expect, it } from 'vitest';

import { createDeterministicIdGenerator } from '../identity/id-generator.js';
import { succeed } from '../result.js';
import { derivedSampleCount } from '../time/sample-time.js';
import {
  CUTOFF,
  GENTLE,
  TEST_CATALOGUE,
  TEST_DENOISER,
  TEST_FILTER,
} from '../testing/test-processors.js';
import { expectFailureCode, expectSuccess } from '../testing/unwrap.js';
import type { TreatmentStep } from './audio-detection.js';
import type { ProcessorCatalogue } from './chain-validation.js';
import type { ProcessorDescriptor } from './processor-descriptor.js';
import type { ProcessorState } from './processor-version.js';
import { treatmentChain, treatmentValues } from './treatment-chain.js';

/** A processor that cannot run without a learned profile. */
const PROFILED: ProcessorDescriptor = {
  ...TEST_DENOISER,
  typeKey: 'profiled-denoiser',
  label: 'Profiled denoiser',
  state: {
    kind: 'profile',
    missing: 'This denoiser has no profile: learn one first.',
    check: () => succeed(undefined),
  },
};

const CATALOGUE: ProcessorCatalogue = new Map([...TEST_CATALOGUE, [PROFILED.typeKey, PROFILED]]);

const PROFILE: ProcessorState = { kind: 'profile', values: [1, 2, 3] };

const FILTER_STEP: TreatmentStep = {
  typeKey: TEST_FILTER.typeKey,
  values: { 'cutoff-frequency': 250 },
};

const PROFILED_STEP: TreatmentStep = {
  typeKey: PROFILED.typeKey,
  values: {},
  learnFrom: { start: derivedSampleCount(10), end: derivedSampleCount(20) },
};

describe('treatmentValues', () => {
  it('sets each value by its key over the defaults of the rest', () => {
    const values = expectSuccess(treatmentValues(TEST_FILTER, FILTER_STEP));
    expect(values).toEqual(
      new Map<string, number | boolean>([
        [CUTOFF, 250],
        [GENTLE, false],
      ]),
    );
  });

  it('refuses a key the processor does not have, and a value out of its range', () => {
    expect(
      expectFailureCode(
        treatmentValues(TEST_FILTER, { typeKey: TEST_FILTER.typeKey, values: { resonance: 2 } }),
      ),
    ).toBe('treatment.parameter-unknown');
    const outOfRange = treatmentValues(TEST_FILTER, {
      typeKey: TEST_FILTER.typeKey,
      values: { 'cutoff-frequency': 5 },
    });
    expect(outOfRange.ok).toBe(false);
  });
});

describe('treatmentChain', () => {
  it('makes the steps in their order under new identifiers, each with its state', () => {
    const ids = createDeterministicIdGenerator(9);
    const chain = expectSuccess(
      treatmentChain([FILTER_STEP, PROFILED_STEP], [undefined, PROFILE], CATALOGUE, ids),
    );
    expect(chain.slots.map((slot) => slot.kind === 'processor' && slot.typeKey)).toEqual([
      TEST_FILTER.typeKey,
      PROFILED.typeKey,
    ]);
    const [filter, profiled] = chain.slots;
    expect(filter).toMatchObject({ enabled: true, soloed: false, mix: 1 });
    expect(filter?.kind === 'processor' ? filter.values.get(CUTOFF) : undefined).toBe(250);
    expect(profiled?.kind === 'processor' ? profiled.state : undefined).toEqual(PROFILE);
    const identities = [chain.id, filter?.id, profiled?.id];
    expect(new Set(identities).size).toBe(3);
  });

  it('refuses a step whose processor needs state it was not given, saying what to do', () => {
    const refused = treatmentChain(
      [PROFILED_STEP],
      [undefined],
      CATALOGUE,
      createDeterministicIdGenerator(9),
    );
    expect(expectFailureCode(refused)).toBe('treatment.state-missing');
    expect(refused.ok ? '' : refused.failures[0].summary).toBe(PROFILED.state?.missing);
  });

  it('refuses state for a processor that learns none, and a type the catalogue lacks', () => {
    const ids = createDeterministicIdGenerator(9);
    expect(expectFailureCode(treatmentChain([FILTER_STEP], [PROFILE], CATALOGUE, ids))).toBe(
      'treatment.state-unexpected',
    );
    expect(
      expectFailureCode(
        treatmentChain([{ typeKey: 'declipper', values: {} }], [undefined], CATALOGUE, ids),
      ),
    ).toBe('treatment.processor-unknown');
  });

  it('reports every step that cannot be made, not the first alone', () => {
    const refused = treatmentChain(
      [
        { typeKey: 'look-ahead-limiter', values: { 'look-ahead': -1 } },
        { typeKey: 'declipper', values: {} },
      ],
      [],
      CATALOGUE,
      createDeterministicIdGenerator(9),
    );
    expect(refused.ok ? 0 : refused.failures.length).toBe(2);
  });
});
