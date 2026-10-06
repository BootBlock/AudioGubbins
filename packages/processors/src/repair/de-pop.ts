/**
 * De-pop: the low thumps of a record's bad scratch, a bumped microphone or a
 * plosive, 5 to 50 ms long, turned down to the level around them on every
 * channel of any layout, each channel alone.
 *
 * The signal is split at the pop frequency by a linear-phase low-pass, four
 * moving averages in cascade, the rest being the signal, delayed to match, less
 * its low band; only the low band is touched. A thump lives below the
 * frequency, the music above it is passed as it is, and where nothing is found
 * the output is the input. A pop is found where the low band's power rises more
 * than the sensitivity above its local floor for no longer than the longest
 * pop, and its low band is attenuated to the level beside it under a crossfade.
 * Godsill and Rayner ("Digital Audio Restoration", 1998, chapter 7) remove such
 * low-frequency noise pulses by subtracting a template or by separating a model
 * of the pulse; this needs neither a template nor a model, at the cost of
 * turning down whatever music lies below the frequency for the pop's few
 * milliseconds, as a band-split attenuator does. `pop-kernel.ts` states the
 * rule, and `pop-geometry.ts` the latency. The frequency and the longest pop
 * set the split and the detector's windows, and so the latency, which the graph
 * aligns every other path to, so they do not move while it plays; the
 * sensitivity does.
 */

import {
  DeterminismClass,
  ParameterTaper,
  ProcessorCategory,
  derivedSampleCount,
  succeed,
  unsafeBrandId,
  type DomainResult,
  type NumericParameterDescriptor,
  type ProcessorSettings,
} from '@audiogubbins/domain';
import type { NodeKernel } from '@audiogubbins/audio-engine';

import { processorType, type ProcessorRun } from '../framework/processor-type.js';
import { numberOf } from '../filters/parameter-values.js';
import { RampedParameter } from '../filters/ramped-parameter.js';
import { MovingAverageLowPass } from './moving-average.js';
import { popGeometry, type PopGeometry } from './pop-geometry.js';
import { PopKernel } from './pop-kernel.js';

const TYPE = 'de-pop';

const sensitivity: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('d1000000-0011'),
  key: 'sensitivity',
  label: 'Sensitivity',
  minimum: 6,
  maximum: 40,
  defaultValue: 15,
  taper: ParameterTaper.Linear,
  unit: 'dB',
  step: 0.5,
};

const frequency: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('d1000000-0012'),
  key: 'frequency',
  label: 'Frequency',
  minimum: 20,
  maximum: 300,
  defaultValue: 120,
  taper: ParameterTaper.Logarithmic,
  unit: 'Hz',
  step: 1,
};

const longestPop: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('d1000000-0013'),
  key: 'maximum-length',
  label: 'Maximum pop length',
  minimum: 5,
  maximum: 50,
  defaultValue: 30,
  taper: ParameterTaper.Logarithmic,
  unit: 'ms',
  step: 1,
};

function geometryOf({ values, sampleRate }: ProcessorSettings): PopGeometry {
  return popGeometry(sampleRate, numberOf(values, frequency), numberOf(values, longestPop));
}

/**
 * Twice the latency: no decision reads a frame more than the latency before
 * the frame it repairs, so a kernel started that far before a stream's
 * frame has seen everything the frame's repair is made from.
 */
function leadIn(settings: ProcessorSettings): number {
  return 2 * geometryOf(settings).latency;
}

function kernel(run: ProcessorRun): DomainResult<NodeKernel> {
  const channels = run.input.roles.length;
  const geometry = popGeometry(
    run.sampleRate,
    run.parameters.number(frequency.key),
    run.parameters.number(longestPop.key),
  );
  return succeed(
    new PopKernel({
      type: TYPE,
      geometry,
      split: new MovingAverageLowPass(channels, geometry.split),
      sensitivity: new RampedParameter(
        sensitivity,
        run.parameters.number(sensitivity.key),
        run.sampleRate,
        run.blockFrames,
      ),
      channels,
    }),
  );
}

/** De-pop, as a processor of the rack. */
export const DE_POP = processorType({
  descriptor: {
    typeKey: TYPE,
    label: 'De-pop',
    category: ProcessorCategory.Restoration,
    version: { implementation: 1, parameters: 1 },
    parameters: [sensitivity, frequency, longestPop],
    qualitySettings: [],
    determinism: DeterminismClass.Canonical,
    wholePass: false,
    realTime: true,
    outputLayout: (input) => succeed(input),
    latency: (settings) => ({
      kind: 'known',
      frames: derivedSampleCount(geometryOf(settings).latency),
    }),
    leadIn,
    frameGrid: () => 1,
  },
  kernel,
});
