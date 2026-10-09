/**
 * De-esser: sibilance turned down as it happens, by an envelope of the band
 * it lives in.
 *
 * A band-pass at the detection frequency, of Q √2, an octave between its −3 dB
 * points, picks out each channel's sibilant band. The channels are linked: one
 * envelope follows the loudest channel's band, frame by frame, so every channel
 * is turned down together and the image does not move. The envelope rises with
 * the attack and falls with the release, each a one-pole coefficient
 * `exp(−1/(t·fs))` by the canonical exponential. Where it is over the
 * threshold, the excess is taken off, up to the range: the band brought back to
 * the threshold, never turned down by more than the range.
 *
 * Split-band, the band alone is turned down: the cookbook's band-pass and its
 * notch at the same frequency and Q sum to the input exactly, so the output is
 * `x − (1 − g)·band`, which is the input itself where no reduction is made.
 * Wideband, the whole signal is turned down by `g`.
 */

import {
  DeterminismClass,
  ParameterTaper,
  ProcessorCategory,
  ZERO_SAMPLES,
  succeed,
  unsafeBrandId,
  type ChoiceParameterDescriptor,
  type DomainResult,
  type NumericParameterDescriptor,
  type ProcessorSettings,
} from '@audiogubbins/domain';
import {
  channelAt,
  decibelsToGain,
  exp,
  gainToDecibels,
  portAt,
  unknownParameter,
  type AudioFrameBlock,
  type NodeKernel,
} from '@audiogubbins/audio-engine';

import { processorType, type ProcessorRun } from '../framework/processor-type.js';
import { finiteSample, flushSubnormal } from '../framework/sample-safety.js';
import { BiquadCascade, sectionDecayFrames, silenceFrames } from './biquad.js';
import { BiquadShape, SectionSetting } from './biquad-shape.js';
import { DESIGN_INTERVAL, DesignClock } from './cascade-kernel.js';
import { numberOf } from './parameter-values.js';
import { RampedParameter } from './ramped-parameter.js';

const TYPE = 'de-esser';

/** The detection band's Q: an octave between its −3 dB points. */
const DETECTION_Q = Math.SQRT2;

const SPLIT_BAND = 'split-band';

const frequency: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('a1000000-0051'),
  key: 'frequency',
  label: 'Frequency',
  minimum: 2_000,
  maximum: 12_000,
  defaultValue: 6_000,
  taper: ParameterTaper.Logarithmic,
  unit: 'Hz',
};

const threshold: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('a1000000-0052'),
  key: 'threshold',
  label: 'Threshold',
  minimum: -60,
  maximum: 0,
  defaultValue: -30,
  taper: ParameterTaper.Decibel,
  unit: 'dB',
  step: 0.1,
};

const range: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('a1000000-0053'),
  key: 'range',
  label: 'Range',
  minimum: 0,
  maximum: 24,
  defaultValue: 6,
  taper: ParameterTaper.Decibel,
  unit: 'dB',
  step: 0.1,
};

const attack: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('a1000000-0054'),
  key: 'attack',
  label: 'Attack',
  minimum: 0.1,
  maximum: 20,
  defaultValue: 1,
  taper: ParameterTaper.Logarithmic,
  unit: 'ms',
  step: 0.01,
};

const release: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('a1000000-0055'),
  key: 'release',
  label: 'Release',
  minimum: 5,
  maximum: 500,
  defaultValue: 60,
  taper: ParameterTaper.Logarithmic,
  unit: 'ms',
  step: 1,
};

const mode: ChoiceParameterDescriptor = {
  kind: 'choice',
  id: unsafeBrandId<'ParameterId'>('a1000000-0056'),
  key: 'mode',
  label: 'Mode',
  options: [
    { key: SPLIT_BAND, label: 'Split-band' },
    { key: 'wideband', label: 'Wideband' },
  ],
  defaultKey: SPLIT_BAND,
};

/** Where a kernel keeps each value its last design made. */
const THRESHOLD_DECIBELS = 0;
const THRESHOLD_GAIN = 1;
const RISE = 2;
const FALL = 3;

/**
 * Replaces the time in milliseconds at `values[at]` with its one-pole
 * coefficient at `rate`: `exp(−1 / ((ms / 1000) · fs))`. In place, as it is
 * worked out on the audio thread, where a coefficient returned from a call
 * would be boxed.
 */
function envelopeCoefficient(values: Float64Array, at: number, rate: number): void {
  values[at] = exp(-1 / (((values[at] ?? 0) / 1_000) * rate));
}

/**
 * Writes the gain of the threshold in decibels in `designed`. Out of line, so
 * the conversion is not called from the branch a moved threshold takes, which
 * runs too rarely for V8 to inline the call and so boxes its numbers.
 */
function designThreshold(designed: Float64Array): void {
  designed[THRESHOLD_GAIN] = decibelsToGain(designed[THRESHOLD_DECIBELS] ?? 0);
}

class DeEsserKernel implements NodeKernel {
  readonly #rate: number;
  readonly #split: boolean;
  readonly #detector: BiquadCascade;
  readonly #ramps: readonly RampedParameter[];
  readonly #byKey: ReadonlyMap<string, RampedParameter>;
  readonly #frequency: RampedParameter;
  readonly #threshold: RampedParameter;
  readonly #range: RampedParameter;
  readonly #attack: RampedParameter;
  readonly #release: RampedParameter;
  readonly #clock = new DesignClock();
  readonly #channels: number;
  /** Each channel's detection band over one interval in f64, channel by channel. */
  readonly #bands: Float64Array;
  /** The gain of each frame of one interval. */
  readonly #gains = new Float64Array(DESIGN_INTERVAL);
  #envelope = 0;
  /** What was last designed: the threshold in decibels and as a gain, and the coefficients. */
  readonly #designed = new Float64Array(4);

  constructor(run: ProcessorRun) {
    const ramp = (parameter: NumericParameterDescriptor) =>
      new RampedParameter(
        parameter,
        run.parameters.number(parameter.key),
        run.sampleRate,
        run.blockFrames,
      );
    const channels = run.input.roles.length;
    this.#channels = channels;
    this.#rate = run.sampleRate;
    this.#split = run.parameters.choice(mode.key) === SPLIT_BAND;
    this.#detector = new BiquadCascade(channels, 1);
    this.#frequency = ramp(frequency);
    this.#threshold = ramp(threshold);
    this.#range = ramp(range);
    this.#attack = ramp(attack);
    this.#release = ramp(release);
    this.#ramps = [this.#frequency, this.#threshold, this.#range, this.#attack, this.#release];
    this.#byKey = new Map(this.#ramps.map((one) => [one.descriptor.key, one]));
    this.#bands = new Float64Array(channels * DESIGN_INTERVAL);
  }

  process(
    inputs: readonly AudioFrameBlock[],
    outputs: readonly AudioFrameBlock[],
    frames: number,
  ): void {
    const input = portAt(inputs, 0);
    const output = portAt(outputs, 0);
    for (const ramp of this.#ramps) ramp.fill(frames);
    for (let frame = 0; frame < frames;) {
      if (this.#clock.due) this.#redesign(frame);
      const count = this.#clock.span(frames - frame);
      for (let channel = 0; channel < this.#channels; channel += 1) {
        const at = channel * DESIGN_INTERVAL;
        this.#detector.run(channel, channelAt(input, channel), frame, count, this.#bands, at);
      }
      this.#follow(frame, count);
      for (let channel = 0; channel < this.#channels; channel += 1) {
        this.#write(channelAt(input, channel), channelAt(output, channel), channel, frame, count);
      }
      this.#clock.advance(count);
      frame += count;
    }
  }

  setParameter(name: string, value: number): DomainResult<void> {
    const ramp = this.#byKey.get(name);
    if (ramp === undefined) return unknownParameter(TYPE, name);
    return ramp.set(TYPE, value);
  }

  release(): void {
    // Holds only its own arrays, which are collected with it.
  }

  /** Designs again what moved, from the parameters' values at `frame` of the block. */
  #redesign(frame: number): void {
    if (this.#frequency.moved(frame)) {
      const settings = this.#detector.settings;
      settings[SectionSetting.Frequency] = this.#frequency.values[frame] ?? 0;
      settings[SectionSetting.Gain] = 0;
      settings[SectionSetting.Q] = DETECTION_Q;
      this.#detector.designSection(0, BiquadShape.BandPass, this.#rate);
    }
    const designed = this.#designed;
    if (this.#threshold.moved(frame)) {
      designed[THRESHOLD_DECIBELS] = this.#threshold.values[frame] ?? 0;
      designThreshold(designed);
    }
    if (this.#attack.moved(frame)) {
      designed[RISE] = this.#attack.values[frame] ?? 0;
      envelopeCoefficient(designed, RISE, this.#rate);
    }
    if (this.#release.moved(frame)) {
      designed[FALL] = this.#release.values[frame] ?? 0;
      envelopeCoefficient(designed, FALL, this.#rate);
    }
  }

  /**
   * Follows the loudest channel's band through `count` frames from `frame`,
   * and writes each frame's gain: the envelope moves toward the level by its
   * coefficient, `level + a·(envelope − level)`, rising by the attack's and
   * falling by the release's.
   */
  #follow(frame: number, count: number): void {
    const bands = this.#bands;
    const designed = this.#designed;
    const thresholdDecibels = designed[THRESHOLD_DECIBELS] ?? 0;
    const thresholdGain = designed[THRESHOLD_GAIN] ?? 0;
    const rise = designed[RISE] ?? 0;
    const fall = designed[FALL] ?? 0;
    let envelope = this.#envelope;
    for (let index = 0; index < count; index += 1) {
      let level = 0;
      for (let at = index; at < bands.length; at += DESIGN_INTERVAL) {
        level = Math.max(level, Math.abs(bands[at] ?? 0));
      }
      const coefficient = level > envelope ? rise : fall;
      envelope = flushSubnormal(level + coefficient * (envelope - level));
      // Worked out on every frame and then chosen, never in a branch: V8
      // inlines no call that runs rarely, and a number crossing a call it has
      // not inlined is boxed.
      const over = gainToDecibels(envelope) - thresholdDecibels;
      const range = this.#range.values[frame + index] ?? 0;
      const reduced = decibelsToGain(-Math.min(range, Math.max(0, over)));
      this.#gains[index] = envelope > thresholdGain ? reduced : 1;
    }
    this.#envelope = envelope;
  }

  /** Writes `count` frames of `channel` from `frame`, turned down by each frame's gain. */
  #write(
    from: Float32Array,
    to: Float32Array,
    channel: number,
    frame: number,
    count: number,
  ): void {
    const at = channel * DESIGN_INTERVAL;
    for (let index = 0; index < count; index += 1) {
      const x = finiteSample(from[frame + index] ?? 0);
      const gain = this.#gains[index] ?? 1;
      to[frame + index] = this.#split ? x - (1 - gain) * (this.#bands[at + index] ?? 0) : gain * x;
    }
  }
}

/**
 * Frames for the detection band's response, and then the envelope, falling
 * from full scale by its release, to decay by 120 dB.
 */
function leadIn({ values, sampleRate }: ProcessorSettings): number {
  const band = numberOf(values, frequency);
  const detection = sectionDecayFrames(BiquadShape.BandPass, band, sampleRate, 0, DETECTION_Q);
  return detection + silenceFrames(numberOf(values, release) / 1_000, sampleRate);
}

/** De-esser, as a processor of the rack. */
export const DE_ESSER = processorType({
  descriptor: {
    typeKey: TYPE,
    label: 'De-esser',
    category: ProcessorCategory.Dynamics,
    version: { implementation: 1, parameters: 1 },
    parameters: [frequency, threshold, range, attack, release, mode],
    qualitySettings: [],
    determinism: DeterminismClass.Canonical,
    wholePass: false,
    realTime: true,
    // One envelope turns every channel down alike, so any layout is kept as it is.
    outputLayout: (input) => succeed(input),
    latency: () => ({ kind: 'known', frames: ZERO_SAMPLES }),
    leadIn,
    frameGrid: () => 1,
  },
  kernel: (run) => succeed(new DeEsserKernel(run)),
});
