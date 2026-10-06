/**
 * The kernel of every level processor: every channel scaled by one linear
 * gain, made from the parameters a person may move and, for a normalisation,
 * from what its whole pass measured.
 *
 * The gain is applied by the engine's own gain node (ADR-0060), so a gain in a
 * rack, a normalisation and a level the engine sets elsewhere are one
 * arithmetic: each sample times the gain in f64, stored once as f32. The input
 * is first read into the kernel's own block through `finiteSample`, as every
 * processor reads it. A parameter moved while it plays makes a new gain, which
 * the node ramps to over the engine's ramp, so the move is heard without a
 * click.
 *
 * On the per-sample path no double crosses a call but `finiteSample`'s
 * return, which V8 always inlines; a gain is made only when a parameter
 * moves, never per sample or per block.
 */

import {
  ZERO_SAMPLES,
  succeed,
  validateParameterValue,
  type DomainResult,
  type NumericParameterDescriptor,
} from '@audiogubbins/domain';
import { nodeId } from '@audiogubbins/audio-graph';
import {
  BUILT_IN_NODES,
  BuiltInNodeType,
  allocateBlock,
  parameterValueInvalid,
  unknownParameter,
  type AudioFrameBlock,
  type NodeKernel,
} from '@audiogubbins/audio-engine';

import type { ProcessorRun } from '../framework/processor-type.js';
import { finiteSample } from '../framework/sample-safety.js';

/** The engine gain node's linked factor, its setting and its running parameter alike. */
const GAIN = 'gain';

/**
 * The linear gain for the moving parameters' values, in the order the
 * kernel was given their descriptors. A pure function of them and of what
 * was measured, which it holds.
 */
export type GainLaw = (values: Float64Array) => number;

/** What a level kernel is made of. */
export interface LevelGain {
  /** The processor's label, lower case, for a refusal's sentence. */
  readonly label: string;
  /** The numeric parameters a person may move while it plays. */
  readonly moving: readonly NumericParameterDescriptor[];
  readonly law: GainLaw;
}

/** The engine's gain node, which every level processor applies its gain with. */
function engineGain() {
  const node = BUILT_IN_NODES.get(BuiltInNodeType.Gain);
  if (node === undefined) throw new Error('The engine has a gain node.');
  return node;
}

class LevelKernel implements NodeKernel {
  readonly #gain: NodeKernel;
  readonly #finite: AudioFrameBlock;
  /** The gain node's one input, the finite block, as a list made once. */
  readonly #inputs: readonly AudioFrameBlock[];
  readonly #made: LevelGain;
  readonly #values: Float64Array;

  constructor(
    gainKernel: NodeKernel,
    finite: AudioFrameBlock,
    made: LevelGain,
    values: Float64Array,
  ) {
    this.#gain = gainKernel;
    this.#finite = finite;
    this.#inputs = [finite];
    this.#made = made;
    this.#values = values;
  }

  process(
    inputs: readonly AudioFrameBlock[],
    outputs: readonly AudioFrameBlock[],
    frames: number,
  ): void {
    const input = inputs[0];
    if (input === undefined) throw new Error(`A ${this.#made.label} was given no input.`);
    const finite = this.#finite.channels;
    for (let channel = 0; channel < finite.length; channel += 1) {
      const from = input.channels[channel];
      const into = finite[channel];
      if (from === undefined || into === undefined) continue;
      for (let frame = 0; frame < frames; frame += 1) into[frame] = finiteSample(from[frame] ?? 0);
    }
    // The gain node reads the first `frames` frames of each channel it is
    // given, so the whole block serves without a view made per call.
    this.#gain.process(this.#inputs, outputs, frames);
  }

  setParameter(name: string, value: number): DomainResult<void> {
    const { label, moving, law } = this.#made;
    const index = moving.findIndex((parameter) => parameter.key === name);
    const parameter = moving[index];
    if (parameter === undefined) return unknownParameter(label, name);
    if (!validateParameterValue(parameter, value).ok) {
      const range = `a number from ${String(parameter.minimum)} to ${String(parameter.maximum)}`;
      return parameterValueInvalid(label, name, value, range);
    }
    this.#values[index] = value;
    return this.#gain.setParameter(GAIN, law(this.#values));
  }

  release(): void {
    this.#gain.release();
  }
}

/** The kernel that applies `made`'s gain to `run`'s input, starting at its parameters' values. */
export function levelKernel(run: ProcessorRun, made: LevelGain): DomainResult<NodeKernel> {
  const values = Float64Array.from(made.moving, (parameter) =>
    run.parameters.number(parameter.key),
  );
  const id = nodeId('level-gain');
  if (!id.ok) return id;
  const gain = engineGain().createKernel(
    {
      node: id.value,
      type: BuiltInNodeType.Gain,
      settings: { [GAIN]: made.law(values) },
      inputs: [{ port: 'in', layout: run.input, slot: 0, delay: ZERO_SAMPLES }],
      outputs: [{ port: 'out', layout: run.output, slot: 1 }],
      // The inner node hears the kernel's own input, so nothing comes before it.
      inputArrival: { kind: 'known', frames: ZERO_SAMPLES },
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
  if (!gain.ok) return gain;
  const finite = allocateBlock(run.input, run.sampleRate, run.blockFrames);
  return succeed(new LevelKernel(gain.value, finite, made, values));
}
