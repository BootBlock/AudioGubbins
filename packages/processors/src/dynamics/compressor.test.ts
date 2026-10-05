import { describe, expect, it } from 'vitest';

import {
  AmbisonicNormalisation,
  AmbisonicOrdering,
  StandardLayouts,
  ambisonicLayout,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import { processorProperties } from '../testing/processor-properties.js';
import {
  TEST_BLOCK_FRAMES,
  TEST_RATE,
  processorKernel,
  processorValues,
} from '../testing/processor-run.js';
import { COMPRESSOR } from './compressor.js';
import { rmsGainDecibels, runKeyed, sideChainNode, tone } from '../testing/dynamics-runs.js';

const FIRST_ORDER = expectSuccess(
  ambisonicLayout({
    order: 1,
    ordering: AmbisonicOrdering.Acn,
    normalisation: AmbisonicNormalisation.Sn3d,
  }),
);

const HARD = { threshold: -40, ratio: 20, knee: 0, attack: 0.1, release: 5, 'make-up': 12 };

processorProperties(COMPRESSOR, {
  layouts: [StandardLayouts.mono, StandardLayouts.stereo, StandardLayouts.surround5_1],
  settings: [HARD, { detector: 'rms', link: false, threshold: -30, attack: 200, release: 2_000 }],
  passThrough: { values: { ratio: 1 }, tolerance: 0 },
});

processorProperties(COMPRESSOR, {
  layouts: [FIRST_ORDER],
  settings: [HARD, { detector: 'rms', threshold: -30 }],
  passThrough: { values: { ratio: 1 }, tolerance: 0 },
});

const SECOND = 48_000;

describe('the compressor', () => {
  it('lowers both channels of a linked pair by the louder one, and only the louder unlinked', () => {
    const loud = tone(1_000, 0.5, SECOND);
    const quiet = tone(700, 0.01, SECOND);
    const run = (link: boolean) =>
      runKeyed(
        COMPRESSOR,
        { layout: StandardLayouts.stereo, values: { threshold: -30, ratio: 10, link } },
        [loud, quiet],
        { layout: StandardLayouts.stereo, channels: [loud, quiet] },
      );
    const [, linkedQuiet] = run(true);
    const [, unlinkedQuiet] = run(false);
    const tail = [SECOND / 2, SECOND] as const;
    expect(rmsGainDecibels(quiet, linkedQuiet ?? quiet, ...tail)).toBeLessThan(-10);
    expect(rmsGainDecibels(quiet, unlinkedQuiet ?? quiet, ...tail)).toBeCloseTo(0, 6);
  });

  it('is keyed by its side-chain, not its input, when it has one', () => {
    const input = tone(1_000, 0.5, SECOND);
    const run = (key: Float32Array) =>
      runKeyed(
        COMPRESSOR,
        { layout: StandardLayouts.mono, values: { threshold: -30, ratio: 10 } },
        [input],
        { layout: StandardLayouts.mono, channels: [key] },
      )[0] ?? input;
    const tail = [SECOND / 2, SECOND] as const;
    expect(rmsGainDecibels(input, run(new Float32Array(SECOND)), ...tail)).toBeCloseTo(0, 6);
    expect(rmsGainDecibels(input, run(tone(200, 0.5, SECOND)), ...tail)).toBeLessThan(-15);
  });

  it('keys every channel from a one-channel side-chain, and refuses one of another width', () => {
    const surround = StandardLayouts.surround5_1;
    expect(COMPRESSOR.check(sideChainNode(COMPRESSOR, surround, StandardLayouts.mono))).toEqual([]);
    expect(COMPRESSOR.check(sideChainNode(COMPRESSOR, surround, surround))).toEqual([]);
    const refused = COMPRESSOR.check(sideChainNode(COMPRESSOR, surround, StandardLayouts.stereo));
    expect(refused.map((problem) => problem.code)).toEqual(['layout-unsupported']);
  });

  it('refuses a node that lists its side-chain before its input, which it would key on', () => {
    const node = sideChainNode(COMPRESSOR, StandardLayouts.mono, StandardLayouts.mono);
    const swapped = { ...node, inputs: [...node.inputs].reverse() };
    expect(COMPRESSOR.check(swapped).map((problem) => problem.code)).toEqual([
      'role-ports-invalid',
    ]);
  });

  it('refuses an ambisonic sound field unlinked, and takes it linked', () => {
    const unlinked = COMPRESSOR.descriptor.outputLayout(
      FIRST_ORDER,
      processorValues(COMPRESSOR, { link: false }),
    );
    expect(unlinked.ok ? undefined : unlinked.failures[0].code).toBe('processor.layout-refused');
    expect(
      COMPRESSOR.descriptor.outputLayout(FIRST_ORDER, processorValues(COMPRESSOR, {})).ok,
    ).toBe(true);
  });

  it('ramps a threshold moved while it plays, and refuses what cannot move', () => {
    const { kernel } = processorKernel(COMPRESSOR, {
      layout: StandardLayouts.mono,
      values: { threshold: 0, knee: 0, attack: 0.1 },
    });
    const frames = TEST_BLOCK_FRAMES;
    const level = new Float32Array(frames).fill(0.5);
    const out = new Float32Array(frames);
    const block = (channels: Float32Array[]) => ({
      layout: StandardLayouts.mono,
      sampleRate: TEST_RATE,
      frames,
      channels,
    });
    kernel.process([block([level])], [block([out])], frames);
    expect(out[frames - 1]).toBe(0.5);
    expect(kernel.setParameter('threshold', -24).ok).toBe(true);
    kernel.process([block([level])], [block([out])], frames);
    // The ramp lasts 480 frames: 300 frames in, the threshold is part of the
    // way down, so the level is over it and reduced, but by less than later.
    expect(out[300]).toBeLessThan(0.5);
    expect(out[300]).toBeGreaterThan(out[2_000] ?? 0);
    expect(kernel.setParameter('threshold', -61).ok).toBe(false);
    expect(kernel.setParameter('detector', 1).ok).toBe(false);
    expect(kernel.setParameter('link', 0).ok).toBe(false);
  });
});
