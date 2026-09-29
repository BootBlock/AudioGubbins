/**
 * Meter: the peak and the root mean square of each channel, block by block.
 *
 * An analysis node: it observes a point in the graph and changes nothing
 * (REQ-ARCH-140), reporting to the target the host binds, or doing nothing
 * where none is bound, as when a render has no one watching. It runs on the
 * audio thread, so its reading and the arrays in it are made once and
 * rewritten each block. The sum of squares is accumulated in f64 in frame
 * order and its root taken once (ADR-0032), so a reading is the same number
 * on every machine.
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
import { refuseOtherSettings } from './setting-values.js';
import { ZERO_LATENCY } from './zero-latency.js';

const TAKES: ReadonlySet<string> = new Set();

/** How many channels a meter measures, or every problem with the node. */
function readMeter(shape: NodeShape): NodeReading<number> {
  const problems: NodeProblem[] = [];
  refuseOtherSettings(shape, TAKES, problems);
  const input = onlyPort(shape, 'inputs', problems);
  return input === undefined || problems.length > 0
    ? refused(problems)
    : accepted(channelCount(input.layout));
}

/** The reading a meter rewrites each block: its own to change, the target's to read. */
interface ReusedReading extends MeterReading {
  frames: number;
  readonly peak: number[];
  readonly rms: number[];
}

class MeterKernel implements NodeKernel {
  readonly #target: MeterTarget;
  readonly #reading: ReusedReading;

  constructor(target: MeterTarget, channels: number) {
    this.#target = target;
    this.#reading = {
      frames: 0,
      peak: new Array<number>(channels).fill(0),
      rms: new Array<number>(channels).fill(0),
    };
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

/** The peak and root mean square of each input channel, reported to the target the host binds. */
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
    return succeed(target === undefined ? UNWATCHED : new MeterKernel(target, reading.value));
  },
};
