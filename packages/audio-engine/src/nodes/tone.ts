/**
 * Tone: a sine on every channel of the node's layout, from the canonical
 * oscillator.
 *
 * The graph's own test signal, and the deterministic source a golden render
 * is made from (REQ-ARCH-081): the oscillator is the canonical DSP's, so the
 * tone is the same bits on the WebAssembly module and the reference path. It
 * is the same on every channel, as `tone-source.ts` makes it, so a channel
 * that is missing or swapped downstream is heard as one that is silent.
 *
 * A frequency must be at most half the rate, which the node's checks cannot
 * know: the graph is checked before it has one. The checks hold it above zero,
 * and the oscillator refuses the rest when the kernel is made at a rate.
 */

import { flatMapResult, succeed, type DomainResult } from '@audiogubbins/domain';
import { NodeRole } from '@audiogubbins/audio-graph';

import type { CanonicalOscillator } from '../dsp/canonical-dsp.js';
import type { AudioFrameBlock } from '../pcm/frame-block.js';
import { BuiltInNodeType } from './built-in-node-type.js';
import { channelAt, portAt } from './kernel-ports.js';
import { unknownParameter } from './node-parameters.js';
import type { NodeImplementation, NodeKernel } from './node-implementation.js';
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
import {
  optionalSetting,
  refuseOtherSettings,
  requiredSetting,
  type SettingRule,
} from './setting-values.js';
import { ZERO_LATENCY } from './zero-latency.js';

const FREQUENCY = 'frequency';
const AMPLITUDE = 'amplitude';

const TAKES: ReadonlySet<string> = new Set([FREQUENCY, AMPLITUDE]);

/** The peak of a tone without an `amplitude` setting: 6 dB below full scale, loud but never clipped. */
const DEFAULT_AMPLITUDE = 0.5;

const POSITIVE_HERTZ: SettingRule<number> = {
  describes: 'a frequency in hertz above zero',
  read: (value) =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined,
};

const PEAK: SettingRule<number> = {
  describes: 'a peak from 0 to 1 of full scale',
  read: (value) => (typeof value === 'number' && value >= 0 && value <= 1 ? value : undefined),
};

interface ToneSettings {
  readonly frequency: number;
  readonly amplitude: number;
}

/** The tone a node makes, or every problem with the node. */
function readTone(shape: NodeShape): NodeReading<ToneSettings> {
  const problems: NodeProblem[] = [];
  refuseOtherSettings(shape, TAKES, problems);
  const output = onlyPort(shape, 'outputs', problems);
  const frequency = requiredSetting(shape, FREQUENCY, POSITIVE_HERTZ, problems);
  const amplitude = optionalSetting(shape, AMPLITUDE, PEAK, problems) ?? DEFAULT_AMPLITUDE;
  return output === undefined || frequency === undefined || problems.length > 0
    ? refused(problems)
    : accepted({ frequency, amplitude });
}

class ToneKernel implements NodeKernel {
  readonly #oscillator: CanonicalOscillator;

  constructor(oscillator: CanonicalOscillator) {
    this.#oscillator = oscillator;
  }

  process(_inputs: readonly AudioFrameBlock[], outputs: readonly AudioFrameBlock[]): void {
    const output = portAt(outputs, 0);
    const first = channelAt(output, 0);
    this.#oscillator.render(first);
    for (let channel = 1; channel < output.channels.length; channel += 1) {
      channelAt(output, channel).set(first);
    }
  }

  setParameter(name: string): DomainResult<void> {
    return unknownParameter(BuiltInNodeType.Tone, name);
  }

  release(): void {
    this.#oscillator.release();
  }
}

/** A sine of the `frequency` and `amplitude` settings on every output channel. */
export const TONE_NODE: NodeImplementation = {
  type: BuiltInNodeType.Tone,
  role: NodeRole.Source,
  check: (node) => problemsOf(readTone(node)),
  latency: () => ZERO_LATENCY,
  createKernel: (step, context) => {
    const shape = plannedShape(step);
    const reading = readTone(shape);
    if (!reading.ok) return kernelRefusal(shape, reading.problems);
    const oscillator = context.dsp.createOscillator({
      frequency: reading.value.frequency,
      sampleRate: context.sampleRate,
      startPhase: 0,
      amplitude: reading.value.amplitude,
    });
    return flatMapResult(oscillator, (made) => succeed(new ToneKernel(made)));
  },
};
