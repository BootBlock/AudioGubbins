/**
 * DeepFilterNet 3's pinned golden render (`testing/ml-goldens.ts`), in Node.
 */

import { describe, expect, it } from 'vitest';

import { goldenRender } from '../../testing/golden-render.js';
import { mlGolden } from '../../testing/ml-goldens.js';

describe('DeepFilterNet 3, pinned', { timeout: 120_000 }, () => {
  it('renders the golden output from the pack, on the pinned runtime', async () => {
    const golden = mlGolden('deepfilternet-3');
    const { frames, digest, seconds } = await goldenRender(golden);
    expect({ frames, digest }, `rendered in ${seconds.toFixed(1)} s`).toEqual({
      frames: golden.samples,
      digest: golden.sha256,
    });
  });
});
