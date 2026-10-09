/**
 * One run of a Spleeter graph over one segment.
 *
 * The graph, as `tools/model-packs/export/spleeter.py` exports it (opset 17):
 * it takes `x` [2×S×512×1024], the magnitudes of bins 0 to 1023 of both
 * channels' spectra over S segments of 512 frames, channel first, and gives,
 * for each stem in the order of the pack's stems and named by it, the stem's
 * estimated magnitude of the same shape: its U-Net's sigmoid mask times `x`.
 * Each segment is heard alone, its convolutions padded with zeros at its edges,
 * and no state passes between segments, so a run of one segment is the run of
 * that segment in any batch. This processor runs one at a time.
 */

import { succeed, type CancellationSignal, type DomainResult } from '@audiogubbins/domain';
import { tensor } from '@audiogubbins/ml-runtime';

import type { ModelSessions } from '../model-sessions.js';
import {
  MODEL_BINS,
  MODEL_CHANNELS,
  SEGMENT_FRAMES,
  SPLEETER_GRAPH,
  type SpleeterModel,
} from './spleeter-model.js';

/** The values of one segment's input, and of each stem's estimate: [2, 1, 512, 1024]. */
export const SEGMENT_VALUES = MODEL_CHANNELS * SEGMENT_FRAMES * MODEL_BINS;

/**
 * Each stem's estimated magnitudes for one segment, in the order of
 * `model.stems`, or why the runtime gave none. The port takes `magnitudes`'
 * buffer, so the caller gives a new array for each run.
 */
export async function estimateStems(
  sessions: ModelSessions,
  model: SpleeterModel,
  magnitudes: Float32Array<ArrayBuffer>,
  signal: CancellationSignal | undefined,
): Promise<DomainResult<readonly Float32Array[]>> {
  const x = tensor(magnitudes, [MODEL_CHANNELS, 1, SEGMENT_FRAMES, MODEL_BINS]);
  if (!x.ok) return x;
  const ran = await sessions.of(SPLEETER_GRAPH).run(new Map([['x', x.value]]), signal);
  if (!ran.ok) return ran;
  const estimates: Float32Array[] = [];
  for (const { key } of model.stems) {
    const found = sessions.output(ran.value, SPLEETER_GRAPH, key, SEGMENT_VALUES);
    if (!found.ok) return found;
    estimates.push(found.value.data);
  }
  return succeed(estimates);
}
