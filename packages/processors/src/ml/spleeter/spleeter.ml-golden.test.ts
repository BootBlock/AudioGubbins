/**
 * Spleeter's pinned golden renders (`testing/ml-goldens.ts`), two stems and
 * four, in Node.
 */

import { describe, expect, it } from 'vitest';

import { goldenRender } from '../../testing/golden-render.js';
import { mlGolden } from '../../testing/ml-goldens.js';

describe('Spleeter, pinned', { timeout: 300_000 }, () => {
  it.each(['spleeter-2-stems vocals', 'spleeter-4-stems drums'])(
    'renders the golden %s from the pack, on the pinned runtime',
    async (name) => {
      const golden = mlGolden(name);
      const { frames, digest, seconds } = await goldenRender(golden);
      expect({ frames, digest }, `rendered in ${seconds.toFixed(1)} s`).toEqual({
        frames: golden.samples,
        digest: golden.sha256,
      });
    },
  );
});
