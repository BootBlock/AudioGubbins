/**
 * De-click: the short clicks of a scratched record, a bad edit or a digital
 * fault found and replaced by what the music around them predicts, on every
 * channel of any layout, each channel alone.
 *
 * Clicks are found as the analysis contract finds them, by the canonical
 * DSP's click detector (`clicks.rs`): per block, an order-16 linear predictor
 * fitted by Burg's method, and each sample whose residual deviates from the
 * block's median by more than the sensitivity times the median absolute
 * deviation flagged. The detector's events carry that deviation and that
 * median absolute deviation, so it is made at the least sensitivity and each
 * event judged here at the sensitivity of the frame it arrives at: the flags
 * are those of a detector made at that sensitivity, and the sensitivity can
 * move while it plays. `click-kernel.ts` gathers the flags into spans and
 * repairs each by least-squares autoregressive interpolation of order 32 from
 * the context either side (`autoregressive.ts`); `click-geometry.ts` states
 * the latency. The longest click sets the latency, so, like a limiter's
 * look-ahead, it does not move while it plays.
 */

import {
  DeterminismClass,
  ParameterTaper,
  ProcessorCategory,
  derivedSampleCount,
  succeed,
  unsafeBrandId,
  type ChoiceParameterDescriptor,
  type DomainResult,
  type NumericParameterDescriptor,
  type ProcessorSettings,
} from '@audiogubbins/domain';
import { DetectorKind, type NodeKernel } from '@audiogubbins/audio-engine';

import { processorType, type ProcessorRun } from '../framework/processor-type.js';
import { numberOf } from '../filters/parameter-values.js';
import { RampedParameter } from '../filters/ramped-parameter.js';
import { clickGeometry } from './click-geometry.js';
import { ClickKernel } from './click-kernel.js';

const TYPE = 'de-click';

const sensitivity: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('d1000000-0001'),
  key: 'sensitivity',
  label: 'Sensitivity',
  minimum: 3,
  maximum: 30,
  defaultValue: 8,
  taper: ParameterTaper.Logarithmic,
  step: 0.1,
};

const longestClick: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('d1000000-0002'),
  key: 'maximum-length',
  label: 'Maximum click length',
  minimum: 0.1,
  maximum: 2,
  defaultValue: 1,
  taper: ParameterTaper.Logarithmic,
  unit: 'ms',
  step: 0.05,
};

/** Each output's option key. */
const Output = { Repaired: 'repaired', Clicks: 'clicks' } as const;

const output: ChoiceParameterDescriptor = {
  kind: 'choice',
  id: unsafeBrandId<'ParameterId'>('d1000000-0003'),
  key: 'output',
  label: 'Output',
  options: [
    { key: Output.Repaired, label: 'Repaired audio' },
    { key: Output.Clicks, label: 'Removed clicks only' },
  ],
  defaultKey: Output.Repaired,
};

function latencyFrames({ values, sampleRate }: ProcessorSettings): number {
  return clickGeometry(sampleRate, numberOf(values, longestClick)).latency;
}

/**
 * The latency and one detector block: a kernel started part way through a
 * stream frames its blocks from its own first frame, so its first output is
 * judged on a whole block of the music before it.
 */
function leadIn(settings: ProcessorSettings): number {
  const { values, sampleRate } = settings;
  const geometry = clickGeometry(sampleRate, numberOf(values, longestClick));
  return geometry.latency + geometry.block;
}

function kernel(run: ProcessorRun): DomainResult<NodeKernel> {
  const geometry = clickGeometry(run.sampleRate, run.parameters.number(longestClick.key));
  const channels = run.input.roles.length;
  const detector = run.dsp.createDetectorFeatures({
    kind: DetectorKind.Clicks,
    channels,
    sampleRate: run.sampleRate,
    block: geometry.block,
    sensitivity: sensitivity.minimum,
  });
  if (!detector.ok) return detector;
  return succeed(
    new ClickKernel({
      type: TYPE,
      geometry,
      detector: detector.value,
      sensitivity: new RampedParameter(
        sensitivity,
        run.parameters.number(sensitivity.key),
        run.sampleRate,
        run.blockFrames,
      ),
      auditioning: run.parameters.choice(output.key) === Output.Clicks,
      channels,
    }),
  );
}

/** De-click, as a processor of the rack. */
export const DE_CLICK = processorType({
  descriptor: {
    typeKey: TYPE,
    label: 'De-click',
    category: ProcessorCategory.Restoration,
    version: { implementation: 1, parameters: 1 },
    parameters: [sensitivity, longestClick, output],
    qualitySettings: [],
    determinism: DeterminismClass.Canonical,
    wholePass: false,
    realTime: true,
    outputLayout: (input) => succeed(input),
    latency: (settings) => ({ kind: 'known', frames: derivedSampleCount(latencyFrames(settings)) }),
    leadIn,
    // The detector judges blocks counted from the kernel's first frame.
    frameGrid: ({ values, sampleRate }) =>
      clickGeometry(sampleRate, numberOf(values, longestClick)).block,
  },
  kernel,
});
