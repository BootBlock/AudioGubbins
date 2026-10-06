import { describe, expect, it } from 'vitest';

import { StandardLayouts } from '@audiogubbins/domain';
import { fingerprint } from '@audiogubbins/audio-engine/testing';

import { TEST_RATE, runProcessor } from '../testing/processor-run.js';
import { advanced, bursts, inRoom, lateEnergyRatio } from '../testing/spectral-measures.js';
import { DEREVERBERATION } from './dereverb.js';

const LENGTH = 6 * TEST_RATE;
const LATENCY = 2_047;

/** Measured from two seconds in, once the filter has learned the room. */
const SETTLED = 2 * TEST_RATE;

/**
 * Noise bursts heard by two microphones in one room whose impulse responses,
 * a direct sound and a velvet-noise tail of RT60 0.6 s, differ by their taps.
 */
const DRY = bursts(LENGTH);
const ROOM = [11, 12].map((seed) => inRoom(DRY, seed, 0.6));

const GOLDEN = { order: 10 } as const;

describe('dereverberation, held to a recorded render', () => {
  // Rendered once, outside any test's time limit: six seconds of a filter of
  // twenty frames a bin.
  const dried = runProcessor(
    DEREVERBERATION,
    { layout: StandardLayouts.stereo, values: GOLDEN },
    ROOM,
    [4_096],
  );

  it('renders a stereo room to the recorded bits', () => {
    expect(dried.map((channel) => fingerprint(channel))).toEqual([
      1932608622674486688n,
      18225542965956838741n,
    ]);
  });

  it('lowers the late reverberation of a room of RT60 0.6 s by at least 6 dB on every channel', () => {
    for (const [channel, wet] of ROOM.entries()) {
      const before = lateEnergyRatio(wet, SETTLED);
      const after = lateEnergyRatio(
        advanced(dried[channel] ?? new Float32Array(0), LATENCY),
        SETTLED,
      );
      expect(before - after).toBeGreaterThanOrEqual(6);
    }
  });

  it('changes a stereo sound with no room by less than −30 dB', () => {
    // Bursts over a floor 40 dB down, the second channel the first a little
    // later, so the channels are alike as two microphones' are.
    const near = bursts(LENGTH, 0.005);
    const far = near.map((_, frame) => near[(frame + 999) % LENGTH] ?? 0);
    const out = runProcessor(
      DEREVERBERATION,
      { layout: StandardLayouts.stereo },
      [near, far],
      [4_096],
    );
    for (const [channel, dry] of [near, far].entries()) {
      const heard = advanced(out[channel] ?? new Float32Array(0), LATENCY);
      let [difference, energy] = [0, 0];
      for (let frame: number = TEST_RATE; frame < LENGTH - LATENCY; frame += 1) {
        difference += ((heard[frame] ?? 0) - (dry[frame] ?? 0)) ** 2;
        energy += (dry[frame] ?? 0) ** 2;
      }
      expect(10 * Math.log10(difference / energy)).toBeLessThan(-30);
    }
  });
});
