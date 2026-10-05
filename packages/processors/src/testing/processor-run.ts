/**
 * Running one processor type's kernel over audio, for its tests: a node made
 * from its descriptor by the rack's own encoding (`processor-node.ts`), a
 * kernel made by the type, and the audio given to it in blocks of any sizes.
 */

import {
  MAXIMUM_QUALITY,
  ZERO_SAMPLES,
  instantiateProcessor,
  sampleRate,
  unsafeBrandId,
  type ChannelLayout,
  type ParameterValue,
  type ParameterValues,
  type QualitySettings,
  type SampleRate,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { nodeId, type PlanStep } from '@audiogubbins/audio-graph';
import {
  REFERENCE_DSP,
  blockView,
  type AudioFrameBlock,
  type CanonicalDsp,
  type NodeKernel,
} from '@audiogubbins/audio-engine';

import { processorNodeSettings } from '../framework/processor-node.js';
import { ProcessorPort, type ProcessorType } from '../framework/processor-type.js';

/** The rate a processor's tests run at unless they say otherwise. */
export const TEST_RATE: SampleRate = expectSuccess(sampleRate(48_000));

/** How one run is made. */
export interface RunSettings {
  /** Parameter values by key; any not given keeps its default. */
  readonly values?: Readonly<Record<string, ParameterValue>>;
  readonly layout: ChannelLayout;
  readonly sampleRate?: SampleRate;
  readonly quality?: QualitySettings;
  readonly measured?: readonly number[];
  readonly dsp?: CanonicalDsp;
}

/** The most frames a kernel made here is given at once. */
export const TEST_BLOCK_FRAMES = 4_096;

const TEST_PROCESSOR = unsafeBrandId<'ProcessorId'>('0000feed-0000');

/** The type's parameter values with those `byKey` gives in place of the defaults. */
export function processorValues(
  type: ProcessorType,
  byKey: Readonly<Record<string, ParameterValue>> = {},
): ParameterValues {
  const values = new Map(instantiateProcessor(TEST_PROCESSOR, type.descriptor).values);
  for (const parameter of type.descriptor.parameters) {
    const given = byKey[parameter.key];
    if (given !== undefined) values.set(parameter.id, given);
  }
  return values;
}

/** The step a processor's node runs as, with its settings encoded as the rack encodes them. */
export function processorStep(type: ProcessorType, settings: RunSettings): PlanStep {
  const { descriptor } = type;
  const made = instantiateProcessor(TEST_PROCESSOR, descriptor);
  const values = processorValues(type, settings.values);
  const output = expectSuccess(descriptor.outputLayout(settings.layout, values));
  return {
    node: expectSuccess(nodeId('processor-under-test')),
    type: type.type,
    settings: processorNodeSettings(
      { ...made, values },
      descriptor,
      settings.quality ?? MAXIMUM_QUALITY.settings,
      settings.measured,
    ),
    inputs: [{ port: ProcessorPort.Input, layout: settings.layout, slot: 0, delay: ZERO_SAMPLES }],
    outputs: [{ port: ProcessorPort.Output, layout: output, slot: 1 }],
  };
}

/** The kernel of a processor for `settings`, and the layout it writes. */
export function processorKernel(
  type: ProcessorType,
  settings: RunSettings,
): { readonly kernel: NodeKernel; readonly output: ChannelLayout } {
  const step = processorStep(type, settings);
  const output = step.outputs[0]?.layout ?? settings.layout;
  const kernel = expectSuccess(
    type.createKernel(step, {
      sampleRate: settings.sampleRate ?? TEST_RATE,
      blockFrames: TEST_BLOCK_FRAMES,
      dsp: settings.dsp ?? REFERENCE_DSP,
      feedFor: () => undefined,
      sinkFor: () => undefined,
      meterFor: () => undefined,
    }),
  );
  return { kernel, output };
}

/**
 * The output of a kernel of `type` for `input`, given in blocks whose sizes
 * cycle through `blocks`, as many frames as the input.
 */
export function runProcessor(
  type: ProcessorType,
  settings: RunSettings,
  input: readonly Float32Array[],
  blocks: readonly number[] = [128],
): Float32Array[] {
  const { kernel, output: layout } = processorKernel(type, settings);
  const rate = settings.sampleRate ?? TEST_RATE;
  const length = input[0]?.length ?? 0;
  const whole = (channels: readonly Float32Array[], of: ChannelLayout): AudioFrameBlock => ({
    layout: of,
    sampleRate: rate,
    frames: length,
    channels,
  });
  const source = whole(input, settings.layout);
  const sink = whole(
    layout.roles.map(() => new Float32Array(length)),
    layout,
  );
  let position = 0;
  for (let turn = 0; position < length; turn += 1) {
    const frames = Math.min(
      blocks[turn % blocks.length] ?? 128,
      length - position,
      TEST_BLOCK_FRAMES,
    );
    kernel.process(
      [blockView(source, position, frames)],
      [blockView(sink, position, frames)],
      frames,
    );
    position += frames;
  }
  kernel.release();
  return [...sink.channels];
}
