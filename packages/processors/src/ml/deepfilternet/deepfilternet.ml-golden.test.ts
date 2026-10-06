/**
 * DeepFilterNet 3's pinned golden render (`testing/golden-render.ts`), over
 * twelve seconds of a voiced signal in noise, which take the model over two
 * runs, so the golden holds the join between them too.
 */

import { describe, expect, it } from 'vitest';

import { StandardLayouts } from '@audiogubbins/domain';

import { goldenRender } from '../../testing/golden-render.js';
import { voicedInNoise } from '../../testing/model-signals.js';
import { TEST_RATE } from '../../testing/processor-run.js';
import { deepFilterNet3 } from './deepfilternet.js';
import { DEEPFILTERNET_3_MODEL } from './deepfilternet-model.js';

/** The SHA-256 of the golden render's output, its samples' bytes in order. */
const GOLDEN_SHA256 = '81fdbd5f5d45026944f1a3205377029c0a151962b883f06e91eadad5cdcb6a7d';

describe('DeepFilterNet 3, pinned', { timeout: 120_000 }, () => {
  it('renders the golden output from the pack, on the pinned runtime', async () => {
    const { frames, digest, seconds } = await goldenRender(
      deepFilterNet3,
      DEEPFILTERNET_3_MODEL,
      { layout: StandardLayouts.mono, sampleRate: TEST_RATE },
      [voicedInNoise(12)],
    );
    expect({ frames, digest }, `rendered in ${seconds.toFixed(1)} s`).toEqual({
      frames: 12 * 48_000,
      digest: GOLDEN_SHA256,
    });
  });
});
