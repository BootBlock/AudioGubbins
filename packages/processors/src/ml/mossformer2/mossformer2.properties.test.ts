import { StandardLayouts } from '@audiogubbins/domain';

import { processorProperties } from '../../testing/processor-properties.js';
import { FakeModels, MemoryModelLibrary } from '../../testing/model-services.js';
import { mossFormer2Se48k } from './mossformer2.js';

// Unmeasured, the kernel passes its input on, which is all a kernel does
// beside playing back, and the playback is the framework's
// (`model-playback.test.ts`).
processorProperties(
  mossFormer2Se48k({
    inference: new FakeModels(new Map()),
    models: new MemoryModelLibrary([]),
  }),
  {
    layouts: [StandardLayouts.mono, StandardLayouts.stereo, StandardLayouts.surround5_1],
    bound: 1,
    passThrough: { values: {}, tolerance: 0 },
  },
);
