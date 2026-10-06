/**
 * Running one processor type's kernel over audio, for its tests: a node made
 * from its descriptor by the rack's own encoding (`processor-node.ts`), state
 * and all, a kernel made by the type, and the audio given to it in blocks of
 * any sizes, with a parameter changed at a frame where a test asks.
 */

import {
  MAXIMUM_QUALITY,
  ZERO_SAMPLES,
  instantiateProcessor,
  sampleRate,
  unsafeBrandId,
  type ChannelLayout,
  type DomainResult,
  type ParameterValue,
  type ParameterValues,
  type ProcessorState,
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
import type { Measurement } from '../framework/whole-pass.js';

/** The rate a processor's tests run at unless they say otherwise. */
export const TEST_RATE: SampleRate = expectSuccess(sampleRate(48_000));

/** How one run is made. */
export interface RunSettings {
  /** Parameter values by key; any not given keeps its default. */
  readonly values?: Readonly<Record<string, ParameterValue>>;
  readonly layout: ChannelLayout;
  readonly sampleRate?: SampleRate;
  readonly quality?: QualitySettings;
  readonly measured?: Measurement;
  /** The instance's non-parameter state, such as a learned noise profile. */
  readonly state?: ProcessorState;
  readonly dsp?: CanonicalDsp;
}

/** A parameter change made at a frame of the stream. */
export interface Change {
  readonly frame: number;
  readonly name: string;
  readonly value: number;
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
  const { state } = settings;
  return {
    node: expectSuccess(nodeId('processor-under-test')),
    type: type.type,
    settings: processorNodeSettings(
      { ...made, values, ...(state === undefined ? {} : { state }) },
      descriptor,
      settings.quality ?? MAXIMUM_QUALITY.settings,
      settings.measured,
    ),
    inputs: [{ port: ProcessorPort.Input, layout: settings.layout, slot: 0, delay: ZERO_SAMPLES }],
    outputs: [{ port: ProcessorPort.Output, layout: output, slot: 1 }],
  };
}

/** The kernel of a processor for `settings`, or why the type refused to make it. */
export function processorKernelOf(
  type: ProcessorType,
  settings: RunSettings,
): DomainResult<NodeKernel> {
  return type.createKernel(processorStep(type, settings), {
    sampleRate: settings.sampleRate ?? TEST_RATE,
    blockFrames: TEST_BLOCK_FRAMES,
    dsp: settings.dsp ?? REFERENCE_DSP,
    feedFor: () => undefined,
    sinkFor: () => undefined,
    meterFor: () => undefined,
  });
}

/** The kernel of a processor for `settings`, and the layout it writes. */
export function processorKernel(
  type: ProcessorType,
  settings: RunSettings,
): { readonly kernel: NodeKernel; readonly output: ChannelLayout } {
  const output = expectSuccess(
    type.descriptor.outputLayout(settings.layout, processorValues(type, settings.values)),
  );
  return { kernel: expectSuccess(processorKernelOf(type, settings)), output };
}

/**
 * The output of a kernel of `type` for `input`, given in blocks whose sizes
 * cycle through `blocks`, as many frames as the input, cut where `change`, if
 * any, falls so it is made at its frame.
 */
export function runProcessor(
  type: ProcessorType,
  settings: RunSettings,
  input: readonly Float32Array[],
  blocks: readonly number[] = [128],
  change?: Change,
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
  const at = change?.frame ?? length;
  let position = 0;
  for (let turn = 0; position < length; turn += 1) {
    if (change !== undefined && position === at) {
      expectSuccess(kernel.setParameter(change.name, change.value));
    }
    const frames = Math.min(
      blocks[turn % blocks.length] ?? 128,
      (position < at ? at : length) - position,
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
