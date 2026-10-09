import { describe, expect, it } from 'vitest';

import {
  SummingLaw,
  createDeterministicIdGenerator,
  instantiateProcessor,
  type ProcessorInstance,
} from '@audiogubbins/domain';
import { PROCESSOR_CATALOGUE } from '@audiogubbins/processors';

import { processorWords, slotsWords } from './library-words.js';

const ids = createDeterministicIdGenerator(29);

function processor(typeKey: string): ProcessorInstance {
  const descriptor = PROCESSOR_CATALOGUE.get(typeKey);
  if (descriptor === undefined) throw new Error(`The build has no ${typeKey}.`);
  return instantiateProcessor(ids.next(), descriptor);
}

describe('what the Library panel says a saved chain holds', () => {
  it('says each processor’s bypass, solo and mix, and each group’s, with how it adds its branches', () => {
    expect(processorWords({ ...processor('gain'), soloed: true, mix: 0.5 })).toBe(
      'Gain (soloed, mixed at 50%)',
    );
    expect(
      slotsWords([
        { ...processor('compressor'), enabled: false },
        {
          kind: 'group',
          id: ids.next(),
          enabled: true,
          soloed: true,
          mix: 0.25,
          summing: SummingLaw.EqualPower,
          branches: [{ slots: [processor('reverb')] }, { slots: [] }],
        },
      ]),
    ).toBe(
      'Compressor (bypassed), then 2 parallel branches added by equal power (Reverb; the input as it is) (soloed, mixed at 25%)',
    );
  });
});
