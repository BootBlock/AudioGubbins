/**
 * Gain: every channel raised or lowered by one level, in decibels.
 *
 * A rack's gain is the engine's own gain node (ADR-0060), so a level change
 * in a rack and one the engine makes elsewhere are one arithmetic: this type
 * converts the person's decibels to the linear factor that node takes, by the
 * canonical conversion, and runs the node's kernel over its input, read as
 * every processor reads it (`finiteSample`). A level moved while it plays
 * ramps in the node, so it is heard without a click.
 */

import {
  DeterminismClass,
  ParameterTaper,
  ProcessorCategory,
  ZERO_SAMPLES,
  succeed,
  unsafeBrandId,
  type DomainResult,
  type ParameterDescriptor,
} from '@audiogubbins/domain';
import { nodeId } from '@audiogubbins/audio-graph';
import {
  BUILT_IN_NODES,
  BuiltInNodeType,
  allocateBlock,
  blockView,
  decibelsToGain,
  unknownParameter,
  type AudioFrameBlock,
  type NodeKernel,
} from '@audiogubbins/audio-engine';

import { processorType, type ProcessorRun } from '../framework/processor-type.js';
import { finiteSample } from '../framework/sample-safety.js';

const GAIN = 'gain';

const gain: ParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('9a1e0001-0001'),
  key: GAIN,
  label: 'Gain',
  minimum: -96,
  maximum: 48,
  defaultValue: 0,
  taper: ParameterTaper.Decibel,
  unit: 'dB',
  step: 0.1,
};

/** The engine's gain node, which this type runs. */
function engineGain() {
  const node = BUILT_IN_NODES.get(BuiltInNodeType.Gain);
  if (node === undefined) throw new Error('The engine has a gain node.');
  return node;
}

/** The gain kernel over a copy of its input in which every sample is finite. */
class GainProcessorKernel implements NodeKernel {
  readonly #gain: NodeKernel;
  readonly #finite: AudioFrameBlock;

  constructor(gainKernel: NodeKernel, finite: AudioFrameBlock) {
    this.#gain = gainKernel;
    this.#finite = finite;
  }

  process(
    inputs: readonly AudioFrameBlock[],
    outputs: readonly AudioFrameBlock[],
    frames: number,
  ): void {
    const input = inputs[0];
    if (input === undefined) throw new Error('A gain processor was given no input.');
    for (const [index, channel] of input.channels.entries()) {
      const into = this.#finite.channels[index];
      if (into === undefined) continue;
      for (let frame = 0; frame < frames; frame += 1)
        into[frame] = finiteSample(channel[frame] ?? 0);
    }
    this.#gain.process([blockView(this.#finite, 0, frames)], outputs, frames);
  }

  setParameter(name: string, value: number): DomainResult<void> {
    if (name !== GAIN) return unknownParameter('gain processor', name);
    return this.#gain.setParameter(GAIN, decibelsToGain(value));
  }

  release(): void {
    this.#gain.release();
  }
}

function kernel(run: ProcessorRun): DomainResult<NodeKernel> {
  const id = nodeId('gain');
  if (!id.ok) return id;
  const made = engineGain().createKernel(
    {
      node: id.value,
      type: BuiltInNodeType.Gain,
      settings: { [GAIN]: decibelsToGain(run.parameters.number(GAIN)) },
      inputs: [{ port: 'in', layout: run.input, slot: 0, delay: ZERO_SAMPLES }],
      outputs: [{ port: 'out', layout: run.output, slot: 1 }],
    },
    {
      sampleRate: run.sampleRate,
      blockFrames: run.blockFrames,
      dsp: run.dsp,
      feedFor: () => undefined,
      sinkFor: () => undefined,
      meterFor: () => undefined,
    },
  );
  if (!made.ok) return made;
  return succeed(
    new GainProcessorKernel(made.value, allocateBlock(run.input, run.sampleRate, run.blockFrames)),
  );
}

/** Gain, as a processor of the rack. */
export const GAIN_PROCESSOR = processorType({
  descriptor: {
    typeKey: 'gain',
    label: 'Gain',
    category: ProcessorCategory.Level,
    version: { implementation: 1, parameters: 1 },
    parameters: [gain],
    qualitySettings: [],
    determinism: DeterminismClass.Canonical,
    wholePass: false,
    realTime: true,
    outputLayout: (input) => succeed(input),
    latency: () => ({ kind: 'known', frames: ZERO_SAMPLES }),
    leadIn: () => 0,
  },
  kernel,
});
