/**
 * MossFormer2 SE 48K's pinned golden render (`testing/golden-render.ts`),
 * over four seconds of a voiced signal in noise, which take the model over
 * the join between its first two segments, at three and a half, so the
 * golden holds the join too; each segment costs about four seconds of
 * inference.
 */

import { describe, expect, it } from 'vitest';

import { StandardLayouts } from '@audiogubbins/domain';

import { goldenRender } from '../../testing/golden-render.js';
import { voicedInNoise } from '../../testing/model-signals.js';
import { TEST_RATE } from '../../testing/processor-run.js';
import { scheduledRun } from '../chunk-schedule.js';
import { mossFormer2Se48k } from './mossformer2.js';
import { MOSSFORMER2_SE_48K_MODEL } from './mossformer2-model.js';
import { MOSSFORMER2_SCHEDULE } from './mossformer2-stream.js';

/** The SHA-256 of the golden render's output, its samples' bytes in order. */
const GOLDEN_SHA256 = '1c5ee7d0fdf77bc6430639076ebf42c1ae89289e1f933feab22e45f342db545e';

describe('MossFormer2 SE 48K, pinned', { timeout: 300_000 }, () => {
  it('renders the golden output from the pack, on the pinned runtime', async () => {
    const input = voicedInNoise(4);
    expect(input.length).toBeGreaterThan(scheduledRun(MOSSFORMER2_SCHEDULE, 1).kept);
    const { frames, digest, seconds } = await goldenRender(
      mossFormer2Se48k,
      MOSSFORMER2_SE_48K_MODEL,
      { layout: StandardLayouts.mono, sampleRate: TEST_RATE },
      [input],
    );
    expect({ frames, digest }, `rendered in ${seconds.toFixed(1)} s`).toEqual({
      frames: input.length,
      digest: GOLDEN_SHA256,
    });
  });
});
