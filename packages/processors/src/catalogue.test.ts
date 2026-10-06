import { describe, expect, it } from 'vitest';

import { ProcessorCategory } from '@audiogubbins/domain';

import {
  MODEL_PROCESSOR_DESCRIPTORS,
  PROCESSOR_CATALOGUE,
  PROCESSOR_TYPES,
  PROCESSOR_TYPES_BY_KEY,
} from './catalogue.js';
import { FakeModels, MemoryModelLibrary } from './testing/model-services.js';
import { deepFilterNet3 } from './ml/deepfilternet/deepfilternet.js';

describe('the processor catalogue', () => {
  it('lists each type key once, so no type hides another in the maps built from it', () => {
    expect(PROCESSOR_TYPES_BY_KEY.size).toBe(PROCESSOR_TYPES.length);
    expect(PROCESSOR_CATALOGUE.size).toBe(
      PROCESSOR_TYPES.length + MODEL_PROCESSOR_DESCRIPTORS.length,
    );
  });

  it('lists types by category in the order the domain lists categories', () => {
    const order: readonly string[] = Object.values(ProcessorCategory);
    for (const descriptors of [
      PROCESSOR_TYPES.map((type) => type.descriptor),
      MODEL_PROCESSOR_DESCRIPTORS,
    ]) {
      const places = descriptors.map((descriptor) => order.indexOf(descriptor.category));
      expect(places).not.toContain(-1);
      expect(places).toEqual([...places].sort((left, right) => left - right));
    }
  });

  it('lists the descriptor a machine-learning type states, the one its threads make it with', () => {
    const made = deepFilterNet3({
      inference: new FakeModels(new Map()),
      models: new MemoryModelLibrary([]),
    });
    expect(PROCESSOR_CATALOGUE.get(made.descriptor.typeKey)).toBe(made.descriptor);
  });
});
