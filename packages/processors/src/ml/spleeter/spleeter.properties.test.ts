import { StandardLayouts } from '@audiogubbins/domain';

import { standInModel, standInServices } from '../../testing/model-services.js';
import { processorProperties } from '../../testing/processor-properties.js';
import { spleeterGainGraph } from '../../testing/spleeter-stand-in.js';
import { modelProcessorType } from '../model-processor.js';
import { SPLEETER_2_STEMS, SPLEETER_4_STEMS } from './spleeter.js';
import {
  SPLEETER_2_STEMS_MODEL,
  SPLEETER_4_STEMS_MODEL,
  SPLEETER_GRAPH,
} from './spleeter-model.js';

// Each pass runs around a stand-in graph that gives each stem its own share
// of the mixture, so the properties hold the whole pass, its transforms and
// the playback.
for (const [processor, { stems }] of [
  [SPLEETER_2_STEMS, SPLEETER_2_STEMS_MODEL],
  [SPLEETER_4_STEMS, SPLEETER_4_STEMS_MODEL],
] as const) {
  const model = standInModel(processor.model);
  const graph = spleeterGainGraph(
    stems.map(({ key }) => key),
    (stem) => stem + 1,
  );
  processorProperties(
    modelProcessorType(
      { ...processor, model },
      standInServices(model, new Map([[SPLEETER_GRAPH, graph]])),
    ),
    {
      readsDsp: true,
      layouts: [StandardLayouts.mono, StandardLayouts.stereo],
      bound: 1,
      passThrough: { values: {}, tolerance: 0 },
    },
  );
}
