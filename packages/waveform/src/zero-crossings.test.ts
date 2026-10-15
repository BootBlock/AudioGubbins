import { describe, expect, it } from 'vitest';

import { allocateBlock, memorySource, type PcmSource } from '@audiogubbins/audio-engine';
import { StandardLayouts, createCancellationSource, sampleRate } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import { nearestZeroCrossing } from './zero-crossings.js';

const RATE = expectSuccess(sampleRate(48_000));

/** A mono source of `frames` frames, positive but for the negative frames `[from, to)`. */
function positiveExcept(frames: number, from: number, to: number): PcmSource {
  const block = allocateBlock(StandardLayouts.mono, RATE, frames);
  const [channel] = block.channels;
  for (let frame = 0; frame < frames; frame += 1) {
    channel?.set([frame >= from && frame < to ? -0.25 : 0.25], frame);
  }
  return expectSuccess(memorySource(block));
}

describe('the zero-crossing search over a long source', () => {
  // Crossings at 12,000 and 12,010 only, beyond the search's first reach and
  // nearer than either end of the source.
  const source = positiveExcept(20_000, 12_000, 12_010);

  it('widens its reach until it finds a crossing in a window that starts inside the source', async () => {
    expect(await nearestZeroCrossing(source, 9_000, 8_000, [0])).toBe(12_000);
    expect(await nearestZeroCrossing(source, 15_000, 8_000, [0])).toBe(12_010);
  });

  it("finds none beyond the reach it was given, and counts the source's end as a crossing", async () => {
    expect(await nearestZeroCrossing(source, 9_000, 2_999, [0])).toBeUndefined();
    expect(await nearestZeroCrossing(source, 19_500, 900, [0])).toBe(20_000);
  });

  it('stops when cancelled', async () => {
    const cancellation = createCancellationSource();
    cancellation.cancel();
    await expect(
      nearestZeroCrossing(source, 9_000, 8_000, [0], cancellation.signal),
    ).rejects.toThrow();
  });
});
