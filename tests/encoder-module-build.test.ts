import { describe, expect, it } from 'vitest';

import { buildEncoders } from '../tools/build-wasm.mjs';

/**
 * The encoder modules' build asked for twice at once, as Vite asks for it when
 * it loads the MP3 and the Vorbis module side by side. Two runs would download
 * the compiler into one cache and build into one working folder together, and
 * the second failed a fresh checkout's first build.
 */
describe('the encoder modules’ build', () => {
  it('is joined, not started again, by a caller that asks while it runs', async () => {
    const first = buildEncoders();
    const second = buildEncoders();

    expect(second).toBe(first);
    expect(await second).toEqual(await first);
  });

  it('runs again once the build asked for has settled', async () => {
    const first = buildEncoders();
    await first;

    const again = buildEncoders();

    expect(again).not.toBe(first);
    await again;
  });
});
