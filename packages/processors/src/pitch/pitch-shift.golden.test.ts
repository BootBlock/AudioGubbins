import { describe, expect, it } from 'vitest';

import { StandardLayouts } from '@audiogubbins/domain';
import { fingerprint } from '@audiogubbins/audio-engine/testing';
import { noisySine } from '@audiogubbins/test-fixtures';

import { runProcessor } from '../testing/processor-run.js';
import { loudestFrequency, tones } from '../testing/pitch-measures.js';
import { PITCH_SHIFT } from './pitch-shift.js';

/** A fifth and a quarter of a semitone up, at the maximum quality's overlap of eight. */
const GOLDEN = { semitones: 7, cents: 25 } as const;
const LATENCY = 4_095;
const LENGTH = 96_000;

function shifted(input: Float32Array, values: Readonly<Record<string, number>>): Float32Array {
  const [output] = runProcessor(PITCH_SHIFT, { layout: StandardLayouts.mono, values }, [input]);
  return output ?? new Float32Array(0);
}

describe('the pitch shift, held to a recorded render', () => {
  it('renders a noisy sine to the recorded bits, its tone where the shift puts it', () => {
    const input = noisySine(440).channels[0] ?? new Float32Array(0);
    const output = shifted(input, GOLDEN);
    expect(fingerprint(output)).toBe(5302199371765897n);
    const target = 440 * 2 ** ((GOLDEN.semitones + GOLDEN.cents / 100) / 12);
    expect(Math.abs(loudestFrequency(output, 12_000, 32_768) - target)).toBeLessThan(0.5);
  });

  it('moves 440 Hz an octave up to 880 Hz and an octave down to 220 Hz, within 1 Hz', () => {
    const input = tones([{ frequency: 440, amplitude: 0.5 }], LENGTH);
    const up = shifted(input, { semitones: 12 });
    const down = shifted(input, { semitones: -12 });
    expect(up.length).toBe(LENGTH);
    expect(down.length).toBe(LENGTH);
    expect(Math.abs(loudestFrequency(up, 20_000, 65_536) - 880)).toBeLessThan(1);
    expect(Math.abs(loudestFrequency(down, 20_000, 65_536) - 220)).toBeLessThan(1);
  });

  it('gives its input at no shift, later by the latency, to the rounding of the transforms', () => {
    // Not the same bits: each frame is transformed and transformed back, and
    // the windows' copies summed, in doubles, so a sample comes back within a
    // few units of a double's last place before it is rounded to a float.
    const input = noisySine(440).channels[0] ?? new Float32Array(0);
    const output = shifted(input, { semitones: 0, cents: 0 });
    let worst = 0;
    for (const [frame, sample] of output.entries()) {
      const expected = frame < LATENCY ? 0 : (input[frame - LATENCY] ?? 0);
      worst = Math.max(worst, Math.abs(sample - expected));
    }
    expect(worst).toBeLessThanOrEqual(2 ** -24);
  });
});
