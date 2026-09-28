/**
 * Deterministic synthetic test signals.
 *
 * REQ-REPO-191 asks for synthetic deterministic test signals, mono, stereo and
 * multichannel examples, loopable examples, deliberately damaged samples, and
 * known transient, click and DC-offset signals. It also states the preference
 * plainly: deterministic synthetic signals wherever they adequately test the
 * required behaviour.
 *
 * Every signal here is generated from its parameters, so there is no binary
 * file to license, to store, or to accidentally change. A test that renders one
 * and compares it against a golden result gets the same input on every machine,
 * in every browser, in five years' time.
 *
 * The same requirement makes these fixtures stable once a golden test uses one.
 * Changing a generator below changes what every golden result means, so a
 * change needs a new generator rather than an edit to an existing one.
 */

import {
  ChannelRole,
  type ChannelLayout,
  type SampleCount,
  type SampleRate,
} from '@audiogubbins/domain';

import { fixtureSampleCount, fixtureSampleRate } from './measures.js';

/**
 * A generated signal.
 *
 * Channels are held separately rather than interleaved. Interleaving is a
 * storage decision, and a fixture that made it would force every consumer to
 * undo it (REQ-ARCH-157).
 */
export interface SignalFixture {
  /** A stable name, used in a golden result's filename. */
  readonly name: string;

  readonly sampleRate: SampleRate;
  readonly channelLayout: ChannelLayout;

  /** One array per channel, each of the same length. */
  readonly channels: readonly Float32Array[];

  /** Length in sample frames. */
  readonly length: SampleCount;
}

/** How a signal is generated. */
export interface SignalOptions {
  readonly sampleRate?: number;

  /** Length in sample frames. */
  readonly length?: number;

  /** Peak amplitude, from 0 to 1. */
  readonly amplitude?: number;
}

/** The rate a fixture uses unless it is asked for another. */
export const FIXTURE_SAMPLE_RATE = 48_000;

/** The length a fixture uses unless it is asked for another: one second. */
export const FIXTURE_LENGTH = FIXTURE_SAMPLE_RATE;

/** Brands the numbers a fixture carries, which are validated by construction. */
function fixture(
  name: string,
  channels: readonly Float32Array[],
  sampleRate: number,
  roles: readonly [ChannelRole, ...ChannelRole[]],
): SignalFixture {
  const [first] = channels;
  if (first === undefined) {
    throw new Error(`The fixture "${name}" was built with no channels.`);
  }
  if (channels.some((channel) => channel.length !== first.length)) {
    throw new Error(`The fixture "${name}" has channels of different lengths.`);
  }
  if (channels.length !== roles.length) {
    throw new Error(
      `The fixture "${name}" has ${String(channels.length)} channels for ${String(roles.length)} roles.`,
    );
  }

  return {
    name,
    sampleRate: fixtureSampleRate(sampleRate),
    channelLayout: { roles },
    channels,
    length: fixtureSampleCount(first.length),
  };
}

/** Fills an array from a function of the frame index. */
function generate(length: number, at: (frame: number) => number): Float32Array {
  const samples = new Float32Array(length);
  for (let frame = 0; frame < length; frame += 1) samples[frame] = at(frame);
  return samples;
}

/**
 * A sine wave.
 *
 * The workhorse. Its spectrum is one line, so a filter, a resampler or a gain
 * stage that alters it in any other way has a defect that a complex signal
 * would have hidden.
 */
export function sine(frequency: number, options: SignalOptions = {}): SignalFixture {
  const sampleRate = options.sampleRate ?? FIXTURE_SAMPLE_RATE;
  const length = options.length ?? FIXTURE_LENGTH;
  const amplitude = options.amplitude ?? 0.5;

  return fixture(
    `sine-${String(frequency)}Hz`,
    [
      generate(
        length,
        (frame) => amplitude * Math.sin((2 * Math.PI * frequency * frame) / sampleRate),
      ),
    ],
    sampleRate,
    [ChannelRole.Mono],
  );
}

/**
 * A sine wave whose length is a whole number of cycles.
 *
 * Loopable in the strict sense: the last sample joins the first with no
 * discontinuity, so a loop test can assert that the join produces no click
 * (REQ-REPO-191 asks for loopable examples). The returned length is rounded to
 * the nearest whole cycle and is therefore not exactly the requested one.
 */
export function loopableSine(frequency: number, options: SignalOptions = {}): SignalFixture {
  const sampleRate = options.sampleRate ?? FIXTURE_SAMPLE_RATE;
  const requested = options.length ?? FIXTURE_LENGTH;
  const framesPerCycle = sampleRate / frequency;
  const cycles = Math.max(1, Math.round(requested / framesPerCycle));
  const length = Math.round(cycles * framesPerCycle);

  return {
    ...sine(frequency, { ...options, length }),
    name: `loopable-sine-${String(frequency)}Hz`,
  };
}

/** Digital silence. Every sample is exactly zero. */
export function silence(options: SignalOptions = {}): SignalFixture {
  const length = options.length ?? FIXTURE_LENGTH;
  return fixture('silence', [new Float32Array(length)], options.sampleRate ?? FIXTURE_SAMPLE_RATE, [
    ChannelRole.Mono,
  ]);
}

/**
 * A constant offset with no alternating content.
 *
 * REQ-REPO-191 asks for a known DC-offset signal. A high-pass or a DC-removal
 * stage should reduce this to silence; anything that leaves it alone will also
 * leave the offset in a user's recording, where it costs headroom and makes
 * every edit click.
 */
export function directCurrent(offset = 0.25, options: SignalOptions = {}): SignalFixture {
  const length = options.length ?? FIXTURE_LENGTH;
  return fixture(
    `dc-${offset.toFixed(2)}`,
    [generate(length, () => offset)],
    options.sampleRate ?? FIXTURE_SAMPLE_RATE,
    [ChannelRole.Mono],
  );
}

/**
 * A single full-scale sample in otherwise silent audio.
 *
 * The impulse response of anything it is passed through, which is the most
 * direct way to see what a filter actually does.
 */
export function impulse(atFrame = 0, options: SignalOptions = {}): SignalFixture {
  const length = options.length ?? FIXTURE_LENGTH;
  const samples = new Float32Array(length);
  if (atFrame >= 0 && atFrame < length) samples[atFrame] = 1;

  return fixture(
    `impulse-at-${String(atFrame)}`,
    [samples],
    options.sampleRate ?? FIXTURE_SAMPLE_RATE,
    [ChannelRole.Mono],
  );
}

/**
 * A sine wave interrupted by a one-sample discontinuity.
 *
 * REQ-REPO-191 asks for a known click signal. This is what a click actually is:
 * a sample that does not follow from its neighbours. Click detection that finds
 * it, and repair that removes it without disturbing the sine around it, are
 * both checkable against the same fixture.
 */
export function clickInSine(
  frequency = 440,
  atFrame = 1_000,
  options: SignalOptions = {},
): SignalFixture {
  const base = sine(frequency, options);
  const [channel] = base.channels;
  if (channel === undefined) throw new Error('The sine fixture produced no channel.');

  const damaged = Float32Array.from(channel);
  if (atFrame >= 0 && atFrame < damaged.length) {
    // Full scale with the opposite sign to the sample it replaces, so the
    // discontinuity is unmistakable wherever in the cycle it lands.
    damaged[atFrame] = (channel[atFrame] ?? 0) >= 0 ? -1 : 1;
  }

  return fixture(
    `click-in-sine-${String(frequency)}Hz-at-${String(atFrame)}`,
    [damaged],
    base.sampleRate,
    [ChannelRole.Mono],
  );
}

/**
 * A step from silence to full scale.
 *
 * REQ-REPO-191 asks for a known transient. A compressor's attack, a limiter's
 * overshoot and a fade's shape are all visible in what happens around the step.
 */
export function transient(atFrame = 1_000, options: SignalOptions = {}): SignalFixture {
  const length = options.length ?? FIXTURE_LENGTH;
  const amplitude = options.amplitude ?? 0.9;

  return fixture(
    `transient-at-${String(atFrame)}`,
    [generate(length, (frame) => (frame < atFrame ? 0 : amplitude))],
    options.sampleRate ?? FIXTURE_SAMPLE_RATE,
    [ChannelRole.Mono],
  );
}

/**
 * Deterministic pseudo-random noise.
 *
 * Seeded, so it is the same noise every run. Real randomness in a fixture makes
 * a failing test unreproducible, which is the one thing a fixture exists to
 * prevent. The generator is a counter-based mix, not a cryptographic one, and
 * its output must never be used for anything but test material.
 */
export function noise(seed = 1, options: SignalOptions = {}): SignalFixture {
  const length = options.length ?? FIXTURE_LENGTH;
  const amplitude = options.amplitude ?? 0.25;

  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x9e37_79b9) >>> 0;
    let mixed = state;
    mixed ^= mixed >>> 16;
    mixed = Math.imul(mixed, 0x21f0_aaad) >>> 0;
    mixed ^= mixed >>> 15;
    mixed = Math.imul(mixed, 0x735a_2d97) >>> 0;
    mixed ^= mixed >>> 15;

    // The XOR above is a signed 32-bit operation, so its result can be
    // negative. Without the shift back to unsigned, the division below would
    // produce values in -2 to -1: every sample negative, and every sample
    // outside full scale. The distribution and amplitude tests guard it.
    return (mixed >>> 0) / 0x8000_0000 - 1;
  };

  return fixture(
    `noise-seed-${String(seed)}`,
    [generate(length, () => amplitude * next())],
    options.sampleRate ?? FIXTURE_SAMPLE_RATE,
    [ChannelRole.Mono],
  );
}

/**
 * A sine wave buried in noise.
 *
 * REQ-REPO-191 asks for deliberately damaged and noisy reference samples.
 * Restoration that recovers the sine, and noise reduction that does not also
 * remove it, are both measurable against a fixture whose clean version is one
 * call away.
 */
export function noisySine(
  frequency = 440,
  signalToNoise = 4,
  options: SignalOptions = {},
): SignalFixture {
  const clean = sine(frequency, options);
  const dirt = noise(7, { ...options, amplitude: (options.amplitude ?? 0.5) / signalToNoise });

  const [signal] = clean.channels;
  const [interference] = dirt.channels;
  if (signal === undefined || interference === undefined) {
    throw new Error('A component fixture produced no channel.');
  }

  return fixture(
    `noisy-sine-${String(frequency)}Hz-snr-${String(signalToNoise)}`,
    [generate(signal.length, (frame) => (signal[frame] ?? 0) + (interference[frame] ?? 0))],
    clean.sampleRate,
    [ChannelRole.Mono],
  );
}

/**
 * A sweep from one frequency to another.
 *
 * Logarithmic, so equal time covers equal ratios. That is what makes a single
 * sweep a fair test of a filter across the whole band rather than one weighted
 * towards the top octave where most of a linear sweep's time is spent.
 */
export function chirp(fromHz = 20, toHz = 20_000, options: SignalOptions = {}): SignalFixture {
  const sampleRate = options.sampleRate ?? FIXTURE_SAMPLE_RATE;
  const length = options.length ?? FIXTURE_LENGTH;
  const amplitude = options.amplitude ?? 0.5;

  const seconds = length / sampleRate;
  const ratio = toHz / fromHz;

  return fixture(
    `chirp-${String(fromHz)}-${String(toHz)}Hz`,
    [
      generate(length, (frame) => {
        const time = frame / sampleRate;
        // The phase of an exponential sweep, integrated so the instantaneous
        // frequency moves from `fromHz` to `toHz` over the whole length.
        const phase =
          ((2 * Math.PI * fromHz * seconds) / Math.log(ratio)) *
          (Math.pow(ratio, time / seconds) - 1);
        return amplitude * Math.sin(phase);
      }),
    ],
    sampleRate,
    [ChannelRole.Mono],
  );
}

/**
 * Two channels carrying different signals.
 *
 * REQ-REPO-191 asks for stereo examples. The channels differ so that a
 * processor which silently mixes them, swaps them or applies one channel's
 * result to both is caught rather than passing because both channels happened
 * to be identical.
 */
export function stereo(left: SignalFixture, right: SignalFixture, name = 'stereo'): SignalFixture {
  const [leftChannel] = left.channels;
  const [rightChannel] = right.channels;
  if (leftChannel === undefined || rightChannel === undefined) {
    throw new Error('A component fixture produced no channel.');
  }
  if (left.sampleRate !== right.sampleRate) {
    throw new Error('A stereo fixture cannot be built from channels at different sample rates.');
  }

  const length = Math.min(leftChannel.length, rightChannel.length);

  return fixture(
    name,
    [leftChannel.slice(0, length), rightChannel.slice(0, length)],
    left.sampleRate,
    [ChannelRole.Left, ChannelRole.Right],
  );
}

/**
 * Six channels in the 5.1 order, each carrying a distinct tone.
 *
 * REQ-REPO-191 asks for representative multichannel examples, and REQ-ARCH-157
 * requires the channel model to be layout-aware rather than stereo with extras.
 * Giving each channel its own frequency means a test can say which channel
 * ended up where, so a processor that reorders or drops one is caught.
 */
export function surround5_1(options: SignalOptions = {}): SignalFixture {
  const frequencies = [220, 330, 440, 55, 660, 880];
  const roles = [
    ChannelRole.Left,
    ChannelRole.Right,
    ChannelRole.Centre,
    ChannelRole.LowFrequency,
    ChannelRole.SurroundLeft,
    ChannelRole.SurroundRight,
  ] as const;

  const channels = frequencies.map((frequency) => {
    const [channel] = sine(frequency, options).channels;
    if (channel === undefined) throw new Error('A component fixture produced no channel.');
    return channel;
  });

  return fixture('surround-5-1', channels, options.sampleRate ?? FIXTURE_SAMPLE_RATE, [...roles]);
}

/**
 * The largest absolute sample in a fixture.
 *
 * The one measurement nearly every audio assertion needs, so it lives with the
 * fixtures rather than being written out in each test.
 */
export function peakOf(signal: SignalFixture): number {
  let peak = 0;
  for (const channel of signal.channels) {
    for (const sample of channel) peak = Math.max(peak, Math.abs(sample));
  }
  return peak;
}

/** The root-mean-square level of a fixture, across every channel. */
export function rmsOf(signal: SignalFixture): number {
  let total = 0;
  let count = 0;
  for (const channel of signal.channels) {
    for (const sample of channel) {
      total += sample * sample;
      count += 1;
    }
  }
  return count === 0 ? 0 : Math.sqrt(total / count);
}
