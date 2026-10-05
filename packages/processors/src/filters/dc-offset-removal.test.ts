import { describe, expect, it } from 'vitest';

import { MAXIMUM_QUALITY, StandardLayouts } from '@audiogubbins/domain';
import { expectFailureCode } from '@audiogubbins/domain/testing';
import { fingerprint } from '@audiogubbins/audio-engine/testing';
import { noise, sine } from '@audiogubbins/test-fixtures';

import { processorProperties } from '../testing/processor-properties.js';
import {
  TEST_RATE,
  processorKernel,
  processorValues,
  runProcessor,
} from '../testing/processor-run.js';
import { DC_OFFSET_REMOVAL } from './dc-offset-removal.js';
import {
  EVERY_LAYOUT,
  lastAudibleFrame,
  runWithChange,
  sineGain,
} from '../testing/filter-measures.js';

processorProperties(DC_OFFSET_REMOVAL, {
  layouts: EVERY_LAYOUT,
  settings: [{ cutoff: 2 }, { cutoff: 40 }],
  bound: 4,
});

describe('DC offset removal', () => {
  it('takes a constant offset out and leaves the programme as it was', () => {
    const second: number = TEST_RATE;
    const length = second * 2;
    const tone = sine(1_000, { amplitude: 0.25, length }).channels[0] ?? new Float32Array(0);
    const offset = tone.map((sample) => sample + 0.25);
    const [output = new Float32Array(0)] = runProcessor(
      DC_OFFSET_REMOVAL,
      { layout: StandardLayouts.mono },
      [offset],
    );
    // Over the second second, a whole number of the tone's cycles: its mean
    // is the offset that is left, and the rest the tone, at its level within
    // 0.001 dB; only its phase moves, by about `fc/f` radians.
    let mean = 0;
    let power = 0;
    let tonePower = 0;
    for (let frame = second; frame < length; frame += 1) {
      mean += (output[frame] ?? 0) / second;
      tonePower += (tone[frame] ?? 0) ** 2;
    }
    for (let frame = second; frame < length; frame += 1) {
      power += ((output[frame] ?? 0) - mean) ** 2;
    }
    expect(Math.abs(mean)).toBeLessThan(1e-5);
    expect(Math.abs(10 * Math.log10(power / tonePower))).toBeLessThan(0.001);
  });

  it('is 3 dB down at its cutoff and flat above it', () => {
    expect(sineGain(DC_OFFSET_REMOVAL, { cutoff: 20 }, 20)).toBeCloseTo(-3.0103, 1);
    expect(Math.abs(sineGain(DC_OFFSET_REMOVAL, { cutoff: 20 }, 1_000))).toBeLessThan(0.01);
  });

  it('moves its cutoff while it plays to the same bits however the stream is cut', () => {
    const input = [noise(6, { length: 12_000 }).channels[0] ?? new Float32Array(0)];
    const settings = { layout: StandardLayouts.mono, values: { cutoff: 2 } };
    const change = { frame: 2_999, name: 'cutoff', value: 40 };
    const [steady] = runWithChange(DC_OFFSET_REMOVAL, settings, input, [4_096], change);
    const [cut] = runWithChange(DC_OFFSET_REMOVAL, settings, input, [1, 7, 128, 333, 31], change);
    expect(fingerprint(cut ?? new Float32Array(0))).toBe(
      fingerprint(steady ?? new Float32Array(1)),
    );
    const { kernel } = processorKernel(DC_OFFSET_REMOVAL, { layout: StandardLayouts.mono });
    expect(expectFailureCode(kernel.setParameter('cutoff', 1))).toBe('node.parameter-invalid');
    expect(expectFailureCode(kernel.setParameter('gain', 1))).toBe('node.parameter-unknown');
  });

  it('settles within the lead-in it declares', () => {
    const values = { cutoff: 2 };
    const settings = {
      values: processorValues(DC_OFFSET_REMOVAL, values),
      sampleRate: TEST_RATE,
      quality: MAXIMUM_QUALITY.settings,
    };
    const impulse = new Float32Array(TEST_RATE * 4);
    impulse[0] = 1;
    const [response = new Float32Array(0)] = runProcessor(
      DC_OFFSET_REMOVAL,
      { layout: StandardLayouts.mono, values },
      [impulse],
    );
    // Less the impulse itself, which passes; what follows is the pole's decay.
    response[0] = (response[0] ?? 0) - 1;
    const leadIn = DC_OFFSET_REMOVAL.descriptor.leadIn(settings);
    expect(leadIn).toBeGreaterThanOrEqual(lastAudibleFrame(response));
    expect(leadIn).toBeLessThan(2 * lastAudibleFrame(response));
  });
});
