/**
 * One run of MossFormer2 SE 48K's graph over a segment's features.
 *
 * The graph, as its file declares it (opset 17, exported by the pack build's
 * `mossformer2_se_48k.py`): `fbanks` [1×T×180], each frame's filter bank and
 * its deltas, to `mask` [1×T×961], each frame's gain for every bin of the
 * segment's spectrum, which is 0 or more and may pass 1. The time axis is
 * dynamic, and nothing is carried from one run to the next.
 */

import { succeed, type CancellationSignal, type DomainResult } from '@audiogubbins/domain';
import { tensor } from '@audiogubbins/ml-runtime';

import type { ModelSessions } from '../model-sessions.js';
import { BINS, FEATURES, MOSSFORMER2_GRAPH } from './mossformer2-model.js';

/**
 * The graph's mask for a segment of `frames` frames whose features are
 * `features`, [frames, 180], as [frames, 961], or why the runtime gave none.
 */
export async function runGraph(
  sessions: ModelSessions,
  features: Float32Array<ArrayBuffer>,
  frames: number,
  signal: CancellationSignal | undefined,
): Promise<DomainResult<Float32Array>> {
  const input = tensor(features, [1, frames, FEATURES]);
  if (!input.ok) return input;
  const outputs = await sessions
    .of(MOSSFORMER2_GRAPH)
    .run(new Map([['fbanks', input.value]]), signal);
  if (!outputs.ok) return outputs;
  const mask = sessions.output(outputs.value, MOSSFORMER2_GRAPH, 'mask', frames * BINS);
  return mask.ok ? succeed(mask.value.data) : mask;
}
