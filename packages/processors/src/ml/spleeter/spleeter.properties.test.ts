import { StandardLayouts } from '@audiogubbins/domain';

import { processorProperties } from '../../testing/processor-properties.js';
import { FakeModels, MemoryModelLibrary } from '../../testing/model-services.js';
import { spleeter2Stems, spleeter4Stems } from './spleeter.js';

// Unmeasured, the kernel passes its input on, which is all a kernel does
// beside playing back, and the playback is the framework's.
for (const make of [spleeter2Stems, spleeter4Stems]) {
  processorProperties(
    make({ inference: new FakeModels(new Map()), models: new MemoryModelLibrary([]) }),
    {
      layouts: [StandardLayouts.mono, StandardLayouts.stereo],
      bound: 1,
      passThrough: { values: {}, tolerance: 0 },
    },
  );
}
