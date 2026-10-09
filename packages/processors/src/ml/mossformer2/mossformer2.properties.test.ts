import { StandardLayouts } from '@audiogubbins/domain';

import { standInModel, standInServices } from '../../testing/model-services.js';
import { mossFormer2Graph } from '../../testing/mossformer2-stand-in.js';
import { processorProperties } from '../../testing/processor-properties.js';
import { modelProcessorType } from '../model-processor.js';
import { MOSSFORMER2_SE_48K } from './mossformer2.js';
import { MOSSFORMER2_GRAPH } from './mossformer2-model.js';

// Its pass runs around a stand-in graph whose mask halves every bin, so the
// properties hold the whole pass, its transforms and the playback.
const model = standInModel(MOSSFORMER2_SE_48K.model);

processorProperties(
  modelProcessorType(
    { ...MOSSFORMER2_SE_48K, model },
    standInServices(model, new Map([[MOSSFORMER2_GRAPH, mossFormer2Graph(() => 0.5)]])),
  ),
  {
    readsDsp: true,
    layouts: [StandardLayouts.mono, StandardLayouts.stereo, StandardLayouts.surround5_1],
    bound: 1,
    passThrough: { values: {}, tolerance: 0 },
  },
);
