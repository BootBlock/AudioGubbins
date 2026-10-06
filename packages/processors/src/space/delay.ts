/**
 * Delay: echoes of the input, each the last one fed back through a gentle
 * low-pass, on every channel of any layout.
 *
 * Each channel has a ring of the longest time at the rate. The echo is the ring
 * read `D = time · rate / 1000` frames back, between the two frames either side
 * of it by linear interpolation, so a time moved while it plays glides as a
 * tape does rather than jumping; a whole number of frames reads one frame
 * exactly. What is written to the ring is the input plus the echo, passed
 * through the damping's one-pole low-pass `s ← s + a·(echo − s)`,
 * `a = 1 − e^(−2π·cutoff/rate)`, times the feedback. The low-pass has a gain of
 * one at DC, so the n-th echo carries `feedback^(n−1)` of the input's DC
 * however it is damped, and the first is the input itself.
 *
 * With cross-feed on, each channel's feedback is written to the next channel
 * in layout order and the last channel's to the first: on two channels a
 * ping-pong, on more a circle round the layout, every channel in it, and on
 * one channel no change. An ambisonic set is refused with it on, since
 * feeding one component into another moves its sources.
 *
 * The slot's wet and dry mix makes the effect, so the kernel gives the
 * echoes alone and adds no latency: the dry part of the mix is the input.
 * Each frame is worked out in turn, every channel read before any is
 * written, from ramps and a ring position held by the kernel, so the output
 * is the same however the stream is cut.
 */

import {
  DeterminismClass,
  FailureKind,
  ParameterTaper,
  ProcessorCategory,
  ZERO_SAMPLES,
  fail,
  failure,
  succeed,
  unsafeBrandId,
  type ChannelLayout,
  type DomainResult,
  type NumericParameterDescriptor,
  type ParameterValues,
  type ProcessorSettings,
  type ToggleParameterDescriptor,
} from '@audiogubbins/domain';
import {
  channelAt,
  exp,
  log10,
  portAt,
  unknownParameter,
  type AudioFrameBlock,
  type NodeKernel,
} from '@audiogubbins/audio-engine';

import { processorType, type ProcessorRun } from '../framework/processor-type.js';
import { finiteSample, flushSubnormal } from '../framework/sample-safety.js';
import { numberOf, toggleOf } from '../filters/parameter-values.js';
import { RampedParameter } from '../filters/ramped-parameter.js';

const TYPE = 'delay';

const time: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('c1000000-0001'),
  key: 'time',
  label: 'Time',
  minimum: 1,
  maximum: 4_000,
  defaultValue: 375,
  taper: ParameterTaper.Logarithmic,
  unit: 'ms',
  step: 0.1,
};

const feedback: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('c1000000-0002'),
  key: 'feedback',
  label: 'Feedback',
  minimum: 0,
  maximum: 95,
  defaultValue: 35,
  taper: ParameterTaper.Linear,
  unit: '%',
  step: 1,
};

const damping: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('c1000000-0003'),
  key: 'damping',
  label: 'Damping',
  minimum: 200,
  maximum: 20_000,
  defaultValue: 8_000,
  taper: ParameterTaper.Logarithmic,
  unit: 'Hz',
};

const crossFeed: ToggleParameterDescriptor = {
  kind: 'toggle',
  id: unsafeBrandId<'ParameterId'>('c1000000-0004'),
  key: 'cross-feed',
  label: 'Cross-feed',
  defaultValue: false,
};

/** The longest time, in milliseconds, which the ring is sized for. */
const LONGEST_TIME = time.maximum;

/**
 * Replaces the cutoff in hertz at `values[at]` with the damping low-pass's
 * coefficient `a` at `rate`. In place, as it is worked out again as the
 * damping moves, on the audio thread, where a coefficient returned from a
 * call would be boxed.
 */
function dampingCoefficient(values: Float64Array, at: number, rate: number): void {
  values[at] = 1 - exp(-(2 * Math.PI * (values[at] ?? 0)) / rate);
}

function outputLayout(input: ChannelLayout, values: ParameterValues): DomainResult<ChannelLayout> {
  if (input.ambisonic !== undefined && toggleOf(values, crossFeed)) {
    return fail(
      failure(
        'processor.layout-refused',
        FailureKind.Rejected,
        'A delay with cross-feed feeds each channel into the next, which would move the sources of an ambisonic sound field; turn cross-feed off to delay one.',
      ),
    );
  }
  return succeed(input);
}

/**
 * Frames for the feedback to fall 120 dB: `(K + 1) · (⌈D⌉ + F)`, where the
 * `K = ⌈−6 / log₁₀ feedback⌉` round trips after the first echo bring
 * `feedback^K` under 10⁻⁶ (none without feedback), each round trip is the
 * delay `D` and the low-pass's own fall of 120 dB, `F = ⌈−6 / log₁₀(1 − a)⌉`
 * frames, and the one more round trip is the first echo's.
 */
function leadIn({ values, sampleRate }: ProcessorSettings): number {
  const delay = Math.ceil((numberOf(values, time) * sampleRate) / 1_000);
  const gain = numberOf(values, feedback) / 100;
  const coefficient = Float64Array.of(numberOf(values, damping));
  dampingCoefficient(coefficient, 0, sampleRate);
  const pole = 1 - (coefficient[0] ?? 0);
  const trips = gain > 0 ? Math.ceil(-6 / log10(gain)) : 0;
  const fall = pole > 0 ? Math.ceil(-6 / log10(pole)) : 0;
  return (trips + 1) * (delay + fall);
}

/** What a delay's kernel is made of. */
interface DelayParts {
  readonly channels: number;
  readonly rate: number;
  /** Each ring's frames: the longest delay, and the two frames it is read between. */
  readonly ringFrames: number;
  readonly crossFeed: boolean;
  readonly time: RampedParameter;
  readonly feedback: RampedParameter;
  readonly damping: RampedParameter;
}

class DelayKernel implements NodeKernel {
  readonly #parts: DelayParts;
  readonly #rings: readonly Float64Array[];
  /** Each channel's damping low-pass state. */
  readonly #smoothed: Float64Array;
  readonly #byKey: ReadonlyMap<string, RampedParameter>;
  /** Where every ring is written next, counted from the kernel's first frame. */
  #position = 0;
  /** The damping low-pass's coefficient. */
  readonly #coefficient = new Float64Array(1);

  constructor(parts: DelayParts) {
    this.#parts = parts;
    this.#rings = Array.from({ length: parts.channels }, () => new Float64Array(parts.ringFrames));
    this.#smoothed = new Float64Array(parts.channels);
    const ramps = [parts.time, parts.feedback, parts.damping];
    this.#byKey = new Map(ramps.map((ramp) => [ramp.descriptor.key, ramp]));
  }

  process(
    inputs: readonly AudioFrameBlock[],
    outputs: readonly AudioFrameBlock[],
    frames: number,
  ): void {
    const input = portAt(inputs, 0);
    const output = portAt(outputs, 0);
    this.#parts.time.fill(frames);
    this.#parts.feedback.fill(frames);
    this.#parts.damping.fill(frames);
    for (let frame = 0; frame < frames; frame += 1) this.#frame(input, output, frame);
  }

  setParameter(name: string, value: number): DomainResult<void> {
    const ramp = this.#byKey.get(name);
    return ramp === undefined ? unknownParameter(TYPE, name) : ramp.set(TYPE, value);
  }

  release(): void {
    // Holds only its own rings, which are collected with it.
  }

  /** Frame `frame` of the block: every channel's echo read, then every ring written. */
  #frame(input: AudioFrameBlock, output: AudioFrameBlock, frame: number): void {
    const { rate, ringFrames, crossFeed: crossing, time: delay, feedback: gain } = this.#parts;
    if (this.#parts.damping.moved(frame)) {
      this.#coefficient[0] = this.#parts.damping.values[frame] ?? 0;
      dampingCoefficient(this.#coefficient, 0, rate);
    }
    const frames = ((delay.values[frame] ?? 0) * rate) / 1_000;
    const whole = Math.floor(frames);
    const fraction = frames - whole;
    const position = this.#position;
    const newer = position >= whole ? position - whole : position - whole + ringFrames;
    const older = newer === 0 ? ringFrames - 1 : newer - 1;
    const coefficient = this.#coefficient[0] ?? 0;
    const smoothed = this.#smoothed;
    const rings = this.#rings;
    for (let channel = 0; channel < rings.length; channel += 1) {
      const ring = rings[channel];
      if (ring === undefined) continue;
      const echo = (ring[newer] ?? 0) * (1 - fraction) + (ring[older] ?? 0) * fraction;
      const state = smoothed[channel] ?? 0;
      smoothed[channel] = flushSubnormal(state + coefficient * (echo - state));
      channelAt(output, channel)[frame] = echo;
    }
    const share = (gain.values[frame] ?? 0) / 100;
    for (let channel = 0; channel < rings.length; channel += 1) {
      const from = crossing ? (channel === 0 ? rings.length : channel) - 1 : channel;
      const sample = finiteSample(channelAt(input, channel)[frame] ?? 0);
      const ring = rings[channel];
      if (ring !== undefined)
        ring[position] = flushSubnormal(sample + share * (smoothed[from] ?? 0));
    }
    this.#position = position + 1 === ringFrames ? 0 : position + 1;
  }
}

function kernel(run: ProcessorRun): DomainResult<NodeKernel> {
  const ramp = (parameter: NumericParameterDescriptor) =>
    new RampedParameter(
      parameter,
      run.parameters.number(parameter.key),
      run.sampleRate,
      run.blockFrames,
    );
  return succeed(
    new DelayKernel({
      channels: run.input.roles.length,
      rate: run.sampleRate,
      ringFrames: Math.ceil((LONGEST_TIME * run.sampleRate) / 1_000) + 2,
      crossFeed: run.parameters.toggle(crossFeed.key),
      time: ramp(time),
      feedback: ramp(feedback),
      damping: ramp(damping),
    }),
  );
}

/** Delay, as a processor of the rack. */
export const DELAY = processorType({
  descriptor: {
    typeKey: TYPE,
    label: 'Delay',
    category: ProcessorCategory.Time,
    version: { implementation: 1, parameters: 1 },
    parameters: [time, feedback, damping, crossFeed],
    qualitySettings: [],
    determinism: DeterminismClass.Canonical,
    wholePass: false,
    realTime: true,
    outputLayout,
    // The echoes are a copy beside the dry signal, not the signal delayed.
    latency: () => ({ kind: 'known', frames: ZERO_SAMPLES }),
    leadIn,
    frameGrid: () => 1,
  },
  kernel,
});
