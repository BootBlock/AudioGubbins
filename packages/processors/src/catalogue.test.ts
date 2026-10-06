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
import { mossFormer2Se48k } from './ml/mossformer2/mossformer2.js';
import { spleeter2Stems, spleeter4Stems } from './ml/spleeter/spleeter.js';

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

  it.each([
    { name: 'DeepFilterNet 3', make: deepFilterNet3 },
    { name: 'MossFormer2 SE 48K', make: mossFormer2Se48k },
    { name: 'Spleeter, two stems', make: spleeter2Stems },
    { name: 'Spleeter, four stems', make: spleeter4Stems },
  ])('lists the descriptor $name states, the one its threads make it with', ({ make }) => {
    const made = make({
      inference: new FakeModels(new Map()),
      models: new MemoryModelLibrary([]),
    });
    expect(PROCESSOR_CATALOGUE.get(made.descriptor.typeKey)).toBe(made.descriptor);
  });

  it('gives each parameter of every type its own identifier, no two types sharing one', () => {
    const owners = new Map<string, string[]>();
    for (const descriptor of PROCESSOR_CATALOGUE.values()) {
      for (const { id } of descriptor.parameters) {
        owners.set(id, [...(owners.get(id) ?? []), descriptor.typeKey]);
      }
    }
    expect([...owners].filter(([, types]) => types.length > 1)).toEqual([]);
  });
});
