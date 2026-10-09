import { StandardLayouts } from '@audiogubbins/domain';

import { deepFilterNetGraphs } from '../../testing/deepfilternet-stand-in.js';
import { standInModel, standInServices } from '../../testing/model-services.js';
import { processorProperties } from '../../testing/processor-properties.js';
import { modelProcessorType } from '../model-processor.js';
import { DEEPFILTERNET_3 } from './deepfilternet.js';

// Its pass runs around stand-in graphs that halve every band and every bin,
// so the properties hold the whole pass, its transforms and the playback.
const model = standInModel(DEEPFILTERNET_3.model);

processorProperties(
  modelProcessorType(
    { ...DEEPFILTERNET_3, model },
    standInServices(model, deepFilterNetGraphs(0.5, 0.5)),
  ),
  {
    readsDsp: true,
    layouts: [StandardLayouts.mono, StandardLayouts.stereo, StandardLayouts.surround5_1],
    bound: 1,
    passThrough: { values: {}, tolerance: 0 },
  },
);
