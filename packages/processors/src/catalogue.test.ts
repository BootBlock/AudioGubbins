import { describe, expect, it } from 'vitest';

import { ProcessorCategory } from '@audiogubbins/domain';

import { PROCESSOR_CATALOGUE, PROCESSOR_TYPES, PROCESSOR_TYPES_BY_KEY } from './catalogue.js';

describe('the processor catalogue', () => {
  it('lists each type key once, so no type hides another in the maps built from it', () => {
    expect(PROCESSOR_TYPES_BY_KEY.size).toBe(PROCESSOR_TYPES.length);
    expect(PROCESSOR_CATALOGUE.size).toBe(PROCESSOR_TYPES.length);
  });

  it('lists types by category in the order the domain lists categories', () => {
    const order: readonly string[] = Object.values(ProcessorCategory);
    const places = PROCESSOR_TYPES.map((type) => order.indexOf(type.descriptor.category));
    expect(places).not.toContain(-1);
    expect(places).toEqual([...places].sort((left, right) => left - right));
  });
});
