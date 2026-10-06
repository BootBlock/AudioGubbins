/**
 * Processor types for tests that need a catalogue but not a kernel: their
 * descriptors state what the domain asks of a processor, and nothing runs
 * them. Each has a property one test needs: a filter with parameters, a
 * limiter with a latency that follows its look-ahead, a denoiser that cannot
 * say its latency, and an upmixer that changes the layout.
 */

import { StandardLayouts, layoutsMatch } from '../audio/channel-layout.js';
import { unsafeBrandId, type ParameterId } from '../identity/branded-id.js';
import { ParameterTaper, type ParameterDescriptor } from '../processing/parameter.js';
import type { ProcessorCatalogue } from '../processing/chain-validation.js';
import {
  DeterminismClass,
  ProcessorCategory,
  type ProcessorDescriptor,
} from '../processing/processor-descriptor.js';
import { FailureKind, fail, failure, succeed } from '../result.js';
import { derivedSampleCount } from '../time/sample-time.js';

export const CUTOFF: ParameterId = unsafeBrandId<'ParameterId'>('11111111-c0ff');
export const GENTLE: ParameterId = unsafeBrandId<'ParameterId'>('11111111-9e47');
export const LOOK_AHEAD: ParameterId = unsafeBrandId<'ParameterId'>('11111111-a4ed');

const cutoff: ParameterDescriptor = {
  kind: 'numeric',
  id: CUTOFF,
  key: 'cutoff-frequency',
  label: 'Cutoff frequency',
  minimum: 20,
  maximum: 20_000,
  defaultValue: 1_000,
  taper: ParameterTaper.Logarithmic,
  unit: 'Hz',
};

const gentle: ParameterDescriptor = {
  kind: 'toggle',
  id: GENTLE,
  key: 'gentle-slope',
  label: 'Gentle slope',
  defaultValue: false,
};

const lookAhead: ParameterDescriptor = {
  kind: 'numeric',
  id: LOOK_AHEAD,
  key: 'look-ahead',
  label: 'Look-ahead',
  minimum: 0,
  maximum: 4_800,
  defaultValue: 480,
  taper: ParameterTaper.Linear,
  unit: 'frames',
  step: 1,
};

/** What every test processor shares. */
const COMMON = {
  category: ProcessorCategory.Equalisation,
  version: { implementation: 1, parameters: 1 },
  qualitySettings: [],
  determinism: DeterminismClass.Canonical,
  wholePass: false,
  realTime: true,
  outputLayout: (input: Parameters<ProcessorDescriptor['outputLayout']>[0]) => succeed(input),
  latency: () => ({ kind: 'known', frames: derivedSampleCount(0) }) as const,
  leadIn: () => 0,
  frameGrid: () => 1,
} as const;

export const TEST_FILTER: ProcessorDescriptor = {
  ...COMMON,
  typeKey: 'low-pass-filter',
  label: 'Low-pass filter',
  parameters: [cutoff, gentle],
  leadIn: () => 64,
};

export const TEST_LIMITER: ProcessorDescriptor = {
  ...COMMON,
  typeKey: 'look-ahead-limiter',
  label: 'Look-ahead limiter',
  category: ProcessorCategory.Dynamics,
  parameters: [lookAhead],
  latency: ({ values }) => {
    const frames = values.get(LOOK_AHEAD);
    return { kind: 'known', frames: derivedSampleCount(typeof frames === 'number' ? frames : 0) };
  },
};

export const TEST_DENOISER: ProcessorDescriptor = {
  ...COMMON,
  typeKey: 'adaptive-denoiser',
  label: 'Adaptive denoiser',
  category: ProcessorCategory.Restoration,
  parameters: [],
  latency: () => ({ kind: 'unknown', reason: 'its look-ahead follows the material' }),
};

export const TEST_UPMIXER: ProcessorDescriptor = {
  ...COMMON,
  typeKey: 'mono-to-stereo',
  label: 'Mono to stereo',
  category: ProcessorCategory.Space,
  parameters: [],
  outputLayout: (input) =>
    layoutsMatch(input, StandardLayouts.mono)
      ? succeed(StandardLayouts.stereo)
      : fail(failure('processor.layout-refused', FailureKind.Rejected, 'It takes mono only.')),
};

/** The test processors by type key. */
export const TEST_CATALOGUE: ProcessorCatalogue = new Map(
  [TEST_FILTER, TEST_LIMITER, TEST_DENOISER, TEST_UPMIXER].map((descriptor) => [
    descriptor.typeKey,
    descriptor,
  ]),
);
