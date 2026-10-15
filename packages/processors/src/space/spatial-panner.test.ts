import { describe, expect, it } from 'vitest';

import {
  MAXIMUM_QUALITY,
  StandardLayouts,
  sampleRate,
  type ParameterValue,
} from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { QUANTA, allocatedBy, fingerprint } from '@audiogubbins/audio-engine/testing';
import { noisySine } from '@audiogubbins/test-fixtures';

import { lastAudibleFrame } from '../testing/filter-measures.js';
import {
  TEST_RATE,
  processorKernel,
  processorValues,
  runProcessor,
} from '../testing/processor-run.js';
import { SPATIAL_PANNER } from './spatial-panner.js';

type Values = Readonly<Record<string, ParameterValue>>;

function leadInAt(values: Values): number {
  return SPATIAL_PANNER.descriptor.leadIn({
    values: processorValues(SPATIAL_PANNER, values),
    sampleRate: TEST_RATE,
    quality: MAXIMUM_QUALITY.settings,
  });
}

describe('the spatial panner’s layouts', () => {
  it('makes stereo of a mono or a stereo source', () => {
    const values = processorValues(SPATIAL_PANNER);
    for (const input of [StandardLayouts.mono, StandardLayouts.stereo]) {
      expect(expectSuccess(SPATIAL_PANNER.descriptor.outputLayout(input, values))).toEqual(
        StandardLayouts.stereo,
      );
    }
  });

  it('refuses any other layout rather than downmixing it in silence', () => {
    const values = processorValues(SPATIAL_PANNER);
    for (const input of [StandardLayouts.surround5_1, StandardLayouts.lcr]) {
      expect(expectFailureCode(SPATIAL_PANNER.descriptor.outputLayout(input, values))).toBe(
        'processor.layout-refused',
      );
    }
  });
});

describe('the spatial panner’s channels', () => {
  it('scales each channel of a stereo source by its own side, with no cross-feed', () => {
    const left = Float32Array.from({ length: 2_048 }, (_, frame) => Math.sin(frame / 9) / 2);
    const silent = new Float32Array(2_048);
    const [outLeft, outRight] = runProcessor(
      SPATIAL_PANNER,
      { layout: StandardLayouts.stereo, values: { x: 5, z: -1, 'filter-decibels': 0 } },
      [left, silent],
    );
    expect(outRight?.every((sample) => sample === 0)).toBe(true);
    expect(outLeft?.some((sample) => sample !== 0)).toBe(true);
  });

  it('hears a mono source on both outputs, louder on the side it is on', () => {
    const source = new Float32Array(1_024).fill(0.5);
    const [left, right] = runProcessor(
      SPATIAL_PANNER,
      { layout: StandardLayouts.mono, values: { x: -6, z: -1, 'filter-decibels': 0 } },
      [source],
    );
    expect(left?.[1_000]).toBeGreaterThan(right?.[1_000] ?? Number.POSITIVE_INFINITY);
    expect(right?.[1_000]).toBeGreaterThan(0);
  });
});

describe('the spatial panner as its emitter moves', () => {
  it('moves its gains a frame at a time, never stepping at a design', () => {
    const source = new Float32Array(9_600).fill(0.5);
    const [left] = runProcessor(
      SPATIAL_PANNER,
      { layout: StandardLayouts.mono, values: { x: -20, z: -30, 'filter-decibels': 0 } },
      [source],
      [128],
      { frame: 2_000, name: 'x', value: 20 },
    );
    let steepest = 0;
    for (let frame = 1; frame < 9_600; frame += 1) {
      steepest = Math.max(steepest, Math.abs((left?.[frame] ?? 0) - (left?.[frame - 1] ?? 0)));
    }
    // The left gain's whole swing, about 0.033 of the source here, is
    // spread over the 10 ms ramp, 480 frames: about 7e-5 a frame. A gain held
    // for an interval and then stepped would move about 32 times that at once.
    expect(steepest).toBeLessThan(3e-4);
    expect((left?.[9_000] ?? 0) - (left?.[1_000] ?? 0)).toBeLessThan(-0.02);
  });

  it('refuses a position out of its range, and a parameter it does not have', () => {
    const { kernel } = processorKernel(SPATIAL_PANNER, { layout: StandardLayouts.mono });
    expect(expectFailureCode(kernel.setParameter('x', 2_000_000))).toBe('node.parameter-invalid');
    expect(expectFailureCode(kernel.setParameter('elevation', 0))).toBe('node.parameter-unknown');
    expectSuccess(kernel.setParameter('filter-decibels', -6));
    kernel.release();
  });
});

describe('the spatial panner’s distance filter', () => {
  it('needs no lead-in without a filter', () => {
    expect(leadInAt({ 'filter-decibels': 0 })).toBe(0);
  });

  it('settles within its lead-in from the deepest cut the filter can make', () => {
    const values = {
      x: 900,
      z: -900,
      'unit-size': 0.1,
      'filter-cutoff': 120,
      'filter-decibels': -70,
    };
    const impulse = new Float32Array(200_000);
    impulse[0] = 1;
    const [left] = runProcessor(SPATIAL_PANNER, { layout: StandardLayouts.mono, values }, [
      impulse,
    ]);
    const lead = leadInAt(values);
    expect(lead).toBeGreaterThan(0);
    expect(lastAudibleFrame(left ?? impulse)).toBeLessThanOrEqual(lead);
  });

  it('realises a cutoff above 0.45 of the rate at 0.45 of it', () => {
    const rate = expectSuccess(sampleRate(32_000));
    const source = noisySine(440).channels[0] ?? new Float32Array(0);
    const at = (cutoff: number) =>
      runProcessor(
        SPATIAL_PANNER,
        {
          layout: StandardLayouts.mono,
          sampleRate: rate,
          values: { z: -400, 'unit-size': 1, 'filter-cutoff': cutoff },
        },
        [source],
      ).map((channel) => fingerprint(channel));
    expect(at(20_000)).toEqual(at(14_400));
    expect(at(14_000)).not.toEqual(at(14_400));
  });
});

describe('the spatial panner on the audio thread', () => {
  it('allocates nothing while its emitter moves', () => {
    const frames = 128;
    const { kernel } = processorKernel(SPATIAL_PANNER, { layout: StandardLayouts.mono });
    const source = noisySine(440).channels[0] ?? new Float32Array(0);
    const inputs = [
      {
        layout: StandardLayouts.mono,
        sampleRate: TEST_RATE,
        frames,
        channels: [source.slice(0, frames)],
      },
    ];
    const outputs = [
      {
        layout: StandardLayouts.stereo,
        sampleRate: TEST_RATE,
        frames,
        channels: [new Float32Array(frames), new Float32Array(frames)],
      },
    ];
    let turn = 0;
    const prepare = () => {
      turn += 1;
      kernel.setParameter('x', turn % 2 === 0 ? 20 : -40);
    };
    const quantum = () => {
      kernel.process(inputs, outputs, frames);
    };
    expect(allocatedBy({ prepare, quantum })).toBeLessThan(QUANTA);
  });
});
