/**
 * Gain: every channel scaled by a linear factor, and each by its own gain and
 * polarity, smoothed as they change.
 *
 * REQ-ARCH-157 asks for linked and unlinked per-channel gain and polarity. The
 * `gain` setting is the linked factor, applied to every channel alike; each
 * channel also has its own gain, from `channel-gains`, and its own polarity,
 * from `polarity`, 1 as recorded or -1 inverted, which together are that
 * channel's factor. The factors are linear, not in decibels, because a
 * conversion from decibels needs a power, which ADR-0032 keeps out of the
 * canonical path; the person's decibels are converted where they are edited.
 *
 * A change while running ramps over {@link rampFrames} frames, so it is not
 * heard as a click: a flip of polarity passes through silence rather than
 * jumping to the opposite sign. Each sample is the sample times the linked
 * factor, then times its channel's factor, in f64, stored once as f32, so a
 * gain gives the same bits however the stream is cut into blocks, and a
 * channel at unity is exactly the linked gain alone.
 */

import { channelCount, succeed, type DomainResult } from '@audiogubbins/domain';
import { NodeRole } from '@audiogubbins/audio-graph';

import { ParameterRamp, rampFrames } from '../execution/parameter-ramp.js';
import type { AudioFrameBlock } from '../pcm/frame-block.js';
import { BuiltInNodeType } from './built-in-node-type.js';
import { channelAt, portAt } from './kernel-ports.js';
import { parameterValueInvalid, unknownParameter } from './node-parameters.js';
import type { NodeImplementation, NodeKernel } from './node-implementation.js';
import {
  accepted,
  kernelRefusal,
  onlyPort,
  plannedShape,
  problemsOf,
  refused,
  requireSameLayout,
  type NodeProblem,
  type NodeReading,
  type NodeShape,
} from './node-shape.js';
import {
  FINITE_NUMBER,
  finiteNumbers,
  optionalSetting,
  refuseOtherSettings,
  type SettingRule,
} from './setting-values.js';
import { ZERO_LATENCY } from './zero-latency.js';

/** The setting, and the parameter, that holds the linked factor. */
const GAIN = 'gain';

/** The setting that holds each channel's own gain, and the prefix of the parameter that changes one. */
const CHANNEL_GAINS = 'channel-gains';
const CHANNEL_GAIN_PARAMETER = 'channel-gain';

/** The setting that holds each channel's polarity, and the prefix of the parameter that changes one. */
const POLARITY = 'polarity';

const TAKES: ReadonlySet<string> = new Set([GAIN, CHANNEL_GAINS, POLARITY]);

/** The factor of a node without a `gain` setting, and of a channel without its own: unity. */
const UNITY = 1;

/** A channel's polarity: as recorded, or inverted. */
const AS_RECORDED = 1;
const INVERTED = -1;

const POLARITY_DESCRIBES = '1, as recorded, or -1, inverted';

function isPolarity(value: number): boolean {
  return value === AS_RECORDED || value === INVERTED;
}

/** A list of `length` polarities, one for each channel. */
function polarities(length: number): SettingRule<readonly number[]> {
  return {
    describes: `a list of ${String(length)} polarities, each ${POLARITY_DESCRIBES}, one for each channel in layout order`,
    read: (value) =>
      typeof value === 'object' && value.length === length && value.every(isPolarity)
        ? value
        : undefined,
  };
}

interface GainSettings {
  readonly gain: number;
  readonly channelGains: readonly number[];
  readonly polarities: readonly number[];
}

/** The factors a gain node starts at, or every problem with the node. */
function readGain(shape: NodeShape): NodeReading<GainSettings> {
  const problems: NodeProblem[] = [];
  refuseOtherSettings(shape, TAKES, problems);
  const input = onlyPort(shape, 'inputs', problems);
  const output = onlyPort(shape, 'outputs', problems);
  if (input === undefined || output === undefined) return refused(problems);
  requireSameLayout(shape, input, output, problems);
  const channels = channelCount(output.layout);
  const unity = new Array<number>(channels).fill(UNITY);
  const gain = optionalSetting(shape, GAIN, FINITE_NUMBER, problems) ?? UNITY;
  const channelGains =
    optionalSetting(
      shape,
      CHANNEL_GAINS,
      finiteNumbers(channels, 'channel, in layout order'),
      problems,
    ) ?? unity;
  const signs = optionalSetting(shape, POLARITY, polarities(channels), problems) ?? unity;
  return problems.length > 0
    ? refused(problems)
    : accepted({ gain, channelGains, polarities: signs });
}

/** A running parameter of one channel, found by the name a host changes it by. */
interface ChannelParameter {
  readonly kind: typeof CHANNEL_GAIN_PARAMETER | typeof POLARITY;
  readonly channel: number;
}

class GainKernel implements NodeKernel {
  readonly #linked: ParameterRamp;

  /** Each channel's factor, its gain times its polarity, ramping as either changes. */
  readonly #channels: readonly ParameterRamp[];
  readonly #channelGains: Float64Array;
  readonly #polarities: Float64Array;

  /** Each channel's parameters by name, made once so a change parses nothing. */
  readonly #parameters: ReadonlyMap<string, ChannelParameter>;

  /** The linked factor of each frame of a block, so its ramp advances once per frame, not per channel. */
  readonly #linkedFactors: Float64Array;

  /** The factor of each frame of the channel being written. */
  readonly #channelFactors: Float64Array;

  constructor(settings: GainSettings, rampLength: number, blockFrames: number) {
    this.#linked = new ParameterRamp(settings.gain, rampLength);
    this.#channelGains = Float64Array.from(settings.channelGains);
    this.#polarities = Float64Array.from(settings.polarities);
    this.#channels = settings.channelGains.map(
      (gain, channel) => new ParameterRamp(gain * (settings.polarities[channel] ?? 0), rampLength),
    );
    this.#parameters = new Map(
      settings.channelGains.flatMap((_, channel): [string, ChannelParameter][] => [
        [`${CHANNEL_GAIN_PARAMETER}.${String(channel)}`, { kind: CHANNEL_GAIN_PARAMETER, channel }],
        [`${POLARITY}.${String(channel)}`, { kind: POLARITY, channel }],
      ]),
    );
    this.#linkedFactors = new Float64Array(blockFrames);
    this.#channelFactors = new Float64Array(blockFrames);
  }

  process(
    inputs: readonly AudioFrameBlock[],
    outputs: readonly AudioFrameBlock[],
    frames: number,
  ): void {
    const input = portAt(inputs, 0);
    const output = portAt(outputs, 0);
    const linked = this.#linkedFactors;
    const own = this.#channelFactors;
    this.#linked.fill(linked, frames);
    for (let channel = 0; channel < this.#channels.length; channel += 1) {
      this.#rampOf(channel).fill(own, frames);
      const from = channelAt(input, channel);
      const to = channelAt(output, channel);
      for (let frame = 0; frame < frames; frame += 1) {
        to[frame] = (from[frame] ?? 0) * (linked[frame] ?? 0) * (own[frame] ?? 0);
      }
    }
  }

  setParameter(name: string, value: number): DomainResult<void> {
    if (name === GAIN) {
      if (!Number.isFinite(value)) {
        return parameterValueInvalid(BuiltInNodeType.Gain, name, value, FINITE_NUMBER.describes);
      }
      this.#linked.set(value);
      return succeed(undefined);
    }
    const parameter = this.#parameters.get(name);
    if (parameter === undefined) return unknownParameter(BuiltInNodeType.Gain, name);
    const { kind, channel } = parameter;
    if (kind === POLARITY) {
      if (!isPolarity(value)) {
        return parameterValueInvalid(BuiltInNodeType.Gain, name, value, POLARITY_DESCRIBES);
      }
      this.#polarities[channel] = value;
    } else {
      if (!Number.isFinite(value)) {
        return parameterValueInvalid(BuiltInNodeType.Gain, name, value, FINITE_NUMBER.describes);
      }
      this.#channelGains[channel] = value;
    }
    this.#rampOf(channel).set(
      (this.#channelGains[channel] ?? 0) * (this.#polarities[channel] ?? 0),
    );
    return succeed(undefined);
  }

  release(): void {
    // Holds only its own arrays, which are collected with it.
  }

  /** The ramp of a channel the node's layout has, which the constructor made one for. */
  #rampOf(channel: number): ParameterRamp {
    const ramp = this.#channels[channel];
    if (ramp === undefined)
      throw new Error('A gain kernel has no ramp for a channel of its layout.');
    return ramp;
  }
}

/**
 * Every channel scaled by the `gain` setting, and each by its own entry in
 * `channel-gains` and `polarity`; each may change while running.
 */
export const GAIN_NODE: NodeImplementation = {
  type: BuiltInNodeType.Gain,
  role: NodeRole.Processor,
  check: (node) => problemsOf(readGain(node)),
  latency: () => ZERO_LATENCY,
  createKernel: (step, context) => {
    const shape = plannedShape(step);
    const reading = readGain(shape);
    if (!reading.ok) return kernelRefusal(shape, reading.problems);
    return succeed(
      new GainKernel(reading.value, rampFrames(context.sampleRate), context.blockFrames),
    );
  },
};
