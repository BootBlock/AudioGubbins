/**
 * MossFormer2 SE 48K's pinned golden render (`testing/ml-goldens.ts`), in
 * Node, over a signal long enough to take the model over the join between
 * its first two segments.
 */

import { describe, expect, it } from 'vitest';

import { goldenRender } from '../../testing/golden-render.js';
import { mlGolden } from '../../testing/ml-goldens.js';
import { scheduledRun } from '../chunk-schedule.js';
import { MOSSFORMER2_SCHEDULE } from './mossformer2-stream.js';

describe('MossFormer2 SE 48K, pinned', { timeout: 300_000 }, () => {
  it('renders the golden output from the pack, on the pinned runtime', async () => {
    const golden = mlGolden('mossformer2-se-48k');
    const [input] = golden.input();
    expect(input?.length).toBeGreaterThan(scheduledRun(MOSSFORMER2_SCHEDULE, 1).kept);
    const { frames, digest, seconds } = await goldenRender(golden);
    expect({ frames, digest }, `rendered in ${seconds.toFixed(1)} s`).toEqual({
      frames: golden.samples,
      digest: golden.sha256,
    });
  });
});
