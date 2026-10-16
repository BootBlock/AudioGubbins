import {
  createDeterministicIdGenerator,
  treatmentChain,
  type ProcessorInstance,
  type TreatmentStep,
} from '@audiogubbins/domain';
import { PROCESSOR_CATALOGUE } from '@audiogubbins/processors';
import { describe, expect, it } from 'vitest';

import { chainEnding } from './chain-ending.js';

const ids = createDeterministicIdGenerator(12);

function processor(step: TreatmentStep): ProcessorInstance {
  const chain = treatmentChain([step], [undefined], PROCESSOR_CATALOGUE, ids);
  const [made] = chain.ok ? chain.value.slots : [];
  if (made?.kind !== 'processor') throw new Error('The processor is made.');
  return made;
}

const dc = (): ProcessorInstance => processor({ typeKey: 'dc-offset-removal', values: {} });
const level = (target: number): ProcessorInstance =>
  processor({ typeKey: 'loudness-normalisation', values: { target } });

describe('chainEnding', () => {
  it('adds treatments before the level and the level last', () => {
    const filter = processor({ typeKey: 'filter', values: {} });
    const ending = chainEnding([filter], { treatments: [dc()], level: level(-16) });
    expect(ending.changes.map((change) => [change.kind, change.index])).toEqual([
      ['add', 1],
      ['add', 2],
    ]);
    expect(ending.slots.map((slot) => (slot.kind === 'processor' ? slot.typeKey : ''))).toEqual([
      'filter',
      'dc-offset-removal',
      'loudness-normalisation',
    ]);
  });

  it('sets a level of its kind ending the chain anew, putting treatments before it', () => {
    const existing = level(-20);
    const ending = chainEnding([existing], { treatments: [dc()], level: level(-16) });
    expect(ending.changes.map((change) => [change.kind, change.index])).toEqual([
      ['retune', 0],
      ['add', 0],
    ]);
    const last = ending.slots.at(-1);
    expect(last?.kind === 'processor' && last.id).toBe(existing.id);
  });

  it('adds nothing the chain already ends with or holds', () => {
    const ending = chainEnding([dc(), level(-16)], { treatments: [dc()], level: level(-16) });
    expect(ending.changes).toEqual([]);
  });
});
