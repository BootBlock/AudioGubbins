/**
 * Meter: the peak and the root mean square of each channel, and the phase
 * correlation of the pairs of channels it is asked for, block by block.
 *
 * An analysis node: it observes a point in the graph and changes nothing
 * (REQ-ARCH-140), reporting to the target the host binds, or doing nothing
 * where none is bound, as when a render has no one watching. It runs on the
 * audio thread, so its reading and the arrays in it are made once and
 * rewritten each block. The sum of squares is accumulated in f64 in frame
 * order and its root taken once (ADR-0032), so a reading is the same number
 * on every machine. Correlation is measured only for the pairs the
 * `correlate` setting names, because its cost grows with the pairs and a
 * surround or ambisonic layout has many that nobody reads
 * (`correlation.ts`).
 */

import { channelCount, succeed, type DomainResult } from '@audiogubbins/domain';
import { NodeRole } from '@audiogubbins/audio-graph';

import type { AudioFrameBlock } from '../pcm/frame-block.js';
import { BuiltInNodeType } from './built-in-node-type.js';
import { channelAt, portAt } from './kernel-ports.js';
import { unknownParameter } from './node-parameters.js';
import type {
  MeterReading,
  MeterTarget,
  NodeImplementation,
  NodeKernel,
} from './node-implementation.js';
import {
  accepted,
  kernelRefusal,
  onlyPort,
  plannedShape,
  problemsOf,
  refused,
  type NodeProblem,
  type NodeReading,
  type NodeShape,
} from './node-shape.js';
import { PairCorrelation } from './correlation.js';
import {
  isNumberList,
  optionalSetting,
  refuseOtherSettings,
  type SettingRule,
} from './setting-values.js';
import { ZERO_LATENCY } from './zero-latency.js';

/** The setting that names the pairs of channels to correlate. */
const CORRELATE = 'correlate';

const TAKES: ReadonlySet<string> = new Set([CORRELATE]);

/** Pairs of different channels of a layout of `channels`, written flat. */
function channelPairs(channels: number): SettingRule<readonly number[]> {
  return {
    describes: `a list of pairs of different channel indices, written one after the other, each a whole number from 0 to ${String(channels - 1)}`,
    read: (value) => {
      if (!isNumberList(value) || value.length % 2 !== 0) return undefined;
      const inRange = value.every(
        (index) => Number.isInteger(index) && index >= 0 && index < channels,
      );
      const distinct = value.every((index, at) => at % 2 === 0 || index !== value[at - 1]);
      return inRange && distinct ? value : undefined;
    },
  };
}

interface MeterSettings {
  readonly channels: number;

  /** The pairs to correlate, flat. */
  readonly pairs: readonly number[];
}

/** What a meter measures, or every problem with the node. */
function readMeter(shape: NodeShape): NodeReading<MeterSettings> {
  const problems: NodeProblem[] = [];
  refuseOtherSettings(shape, TAKES, problems);
  const input = onlyPort(shape, 'inputs', problems);
  if (input === undefined) return refused(problems);
  const channels = channelCount(input.layout);
  const pairs = optionalSetting(shape, CORRELATE, channelPairs(channels), problems) ?? [];
  return problems.length > 0 ? refused(problems) : accepted({ channels, pairs });
}

/** The reading a meter rewrites each block: its own to change, the target's to read. */
interface ReusedReading extends MeterReading {
  frames: number;
  readonly peak: number[];
  readonly rms: number[];
  readonly correlation: number[];
}

class MeterKernel implements NodeKernel {
  readonly #target: MeterTarget;
  readonly #reading: ReusedReading;
  readonly #correlation: PairCorrelation;

  constructor(target: MeterTarget, { channels, pairs }: MeterSettings, blockFrames: number) {
    this.#target = target;
    this.#reading = {
      frames: 0,
      peak: new Array<number>(channels).fill(0),
      rms: new Array<number>(channels).fill(0),
      correlation: new Array<number>(pairs.length / 2).fill(0),
    };
    this.#correlation = new PairCorrelation(pairs, channels, blockFrames);
  }

  process(
    inputs: readonly AudioFrameBlock[],
    _outputs: readonly AudioFrameBlock[],
    frames: number,
  ): void {
    const input = portAt(inputs, 0);
    const reading = this.#reading;
    reading.frames = frames;
    for (let channel = 0; channel < reading.peak.length; channel += 1) {
      const samples = channelAt(input, channel);
      let peak = 0;
      let squares = 0;
      for (let frame = 0; frame < frames; frame += 1) {
        const sample = samples[frame] ?? 0;
        const magnitude = Math.abs(sample);
        if (magnitude > peak) peak = magnitude;
        squares += sample * sample;
      }
      reading.peak[channel] = peak;
      // An empty block has no mean; its level is silence rather than NaN.
      reading.rms[channel] = frames === 0 ? 0 : Math.sqrt(squares / frames);
    }
    this.#correlation.measure(input, frames, reading.correlation);
    this.#target.receive(reading);
  }

  setParameter(name: string): DomainResult<void> {
    return unknownParameter(BuiltInNodeType.Meter, name);
  }

  release(): void {
    // The target is the host's, and outlives the kernel it was bound to.
  }
}

/** A meter with no target bound: nobody is watching, so it measures nothing. */
const UNWATCHED: NodeKernel = {
  process: () => undefined,
  setParameter: (name) => unknownParameter(BuiltInNodeType.Meter, name),
  release: () => undefined,
};

/**
 * The peak and root mean square of each input channel, and the correlation of
 * each pair in `correlate`, reported to the target the host binds.
 */
export const METER_NODE: NodeImplementation = {
  type: BuiltInNodeType.Meter,
  role: NodeRole.Analysis,
  check: (node) => problemsOf(readMeter(node)),
  latency: () => ZERO_LATENCY,
  createKernel: (step, context) => {
    const shape = plannedShape(step);
    const reading = readMeter(shape);
    if (!reading.ok) return kernelRefusal(shape, reading.problems);
    const target = context.meterFor(step.node);
    return succeed(
      target === undefined
        ? UNWATCHED
        : new MeterKernel(target, reading.value, context.blockFrames),
    );
  },
};
