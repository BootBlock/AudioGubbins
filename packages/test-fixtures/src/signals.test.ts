import { describe, expect, it } from 'vitest';

import { ChannelRole } from '@audiogubbins/domain';

import {
  FIXTURE_LENGTH,
  FIXTURE_SAMPLE_RATE,
  chirp,
  clickInSine,
  directCurrent,
  impulse,
  loopableSine,
  noise,
  noisySine,
  peakOf,
  rmsOf,
  silence,
  sine,
  stereo,
  surround5_1,
  transient,
  type SignalFixture,
} from './signals.js';

/** Every generator, so the shared properties are checked against all of them. */
const EVERY_SIGNAL: readonly SignalFixture[] = [
  sine(440),
  loopableSine(440),
  silence(),
  directCurrent(),
  impulse(),
  clickInSine(),
  transient(),
  noise(),
  noisySine(),
  chirp(),
  stereo(sine(440), sine(554)),
  surround5_1(),
];

/**
 * The first frame at which two channels differ, or -1 where they hold the same
 * samples throughout. Compared bit for bit, so a negative zero is told from a
 * positive one, which a comparison of the numbers would not do.
 */
function firstDifference(first: Float32Array, second: Float32Array): number {
  const firstBits = new Uint32Array(first.buffer, first.byteOffset, first.length);
  const secondBits = new Uint32Array(second.buffer, second.byteOffset, second.length);
  const shorter = Math.min(firstBits.length, secondBits.length);
  for (let frame = 0; frame < shorter; frame += 1) {
    if (firstBits[frame] !== secondBits[frame]) return frame;
  }
  return firstBits.length === secondBits.length ? -1 : shorter;
}

describe('every signal fixture', () => {
  it.each(EVERY_SIGNAL.map((signal) => [signal.name, signal] as const))(
    '%s has channels of equal length matching its reported length',
    (_name, signal) => {
      for (const channel of signal.channels) {
        expect(channel.length).toBe(signal.length);
      }
    },
  );

  it.each(EVERY_SIGNAL.map((signal) => [signal.name, signal] as const))(
    '%s has one role per channel',
    (_name, signal) => {
      expect(signal.channelLayout.roles).toHaveLength(signal.channels.length);
    },
  );

  it.each(EVERY_SIGNAL.map((signal) => [signal.name, signal] as const))(
    '%s stays inside full scale',
    (_name, signal) => {
      // A fixture that clipped would make every test using it measure the
      // clipping rather than the behaviour under test.
      expect(peakOf(signal)).toBeLessThanOrEqual(1);
    },
  );

  it.each(EVERY_SIGNAL.map((signal) => [signal.name, signal] as const))(
    '%s holds only finite samples',
    (_name, signal) => {
      // The first sample that is not finite in each channel, as a channel and a
      // frame, so a failure says where the first one is.
      const notFinite = signal.channels.flatMap((channel, index) => {
        const frame = channel.findIndex((sample) => !Number.isFinite(sample));
        return frame === -1 ? [] : [[index, frame]];
      });
      expect(notFinite).toEqual([]);
    },
  );

  it('gives every fixture a distinct name, so golden results cannot collide', () => {
    const names = EVERY_SIGNAL.map((signal) => signal.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('determinism', () => {
  it.each([
    ['sine', () => sine(440)],
    ['noise', () => noise(7)],
    ['noisy sine', () => noisySine()],
    ['chirp', () => chirp()],
    ['surround', () => surround5_1()],
  ])('generates %s identically every time', (_name, build) => {
    // The whole point of a synthetic fixture. A test that fails on one machine
    // and passes on another is worth nothing.
    const first = build().channels;
    const second = build().channels;
    expect(second).toHaveLength(first.length);
    expect(
      first.map((channel, index) => firstDifference(channel, second[index] ?? new Float32Array())),
    ).toEqual(first.map(() => -1));
  });

  it('gives different noise for different seeds', () => {
    const [one] = noise(1).channels;
    const [two] = noise(2).channels;
    if (one === undefined || two === undefined) throw new Error('no channel');
    expect(firstDifference(one, two)).not.toBe(-1);
  });
});

describe('sine', () => {
  it('has the requested peak amplitude', () => {
    expect(peakOf(sine(1_000, { amplitude: 0.5 }))).toBeCloseTo(0.5, 2);
  });

  it('has the root-mean-square level a sine should have', () => {
    // A sine's RMS is its peak divided by the square root of two. A generator
    // that produced a square or a triangle would pass a peak check and fail
    // here.
    expect(rmsOf(sine(1_000, { amplitude: 0.8 }))).toBeCloseTo(0.8 / Math.SQRT2, 2);
  });

  it('starts at zero, so a fade or a splice at the start has nothing to remove', () => {
    expect(sine(440).channels[0]?.[0]).toBeCloseTo(0, 10);
  });

  it('completes the expected number of cycles in one second', () => {
    // Count the upward zero crossings. A 100 Hz tone starting at zero has its
    // hundredth crossing one sample past the end of a one-second signal, and
    // the crossing at frame zero has no predecessor to cross from, so
    // ninety-nine is the right answer for a half-open signal.
    const [channel] = sine(100).channels;
    let crossings = 0;
    for (let frame = 1; frame < (channel?.length ?? 0); frame += 1) {
      if ((channel?.[frame - 1] ?? 0) < 0 && (channel?.[frame] ?? 0) >= 0) crossings += 1;
    }
    expect(crossings).toBe(99);
  });

  it('takes a sample rate and a length', () => {
    const custom = sine(440, { sampleRate: 44_100, length: 1_000 });
    expect(custom.sampleRate).toBe(44_100);
    expect(custom.length).toBe(1_000);
  });

  it('defaults to one second at the fixture rate', () => {
    expect(sine(440).length).toBe(FIXTURE_LENGTH);
    expect(sine(440).sampleRate).toBe(FIXTURE_SAMPLE_RATE);
  });
});

describe('loopableSine', () => {
  it('joins its end to its start without a discontinuity', () => {
    // What "loopable" has to mean: the step across the join is no larger than
    // the step between any two neighbouring samples inside the signal. A
    // thousand frames is not a whole number of cycles of 440 Hz at the fixture
    // rate, nor is one cycle a whole number of frames, so the join holds only
    // because the length was rounded: the thousand frames asked for would step
    // across the join more than fourteen times as far as any step inside it.
    const [channel] = loopableSine(440, { length: 1_000 }).channels;
    if (channel === undefined) throw new Error('no channel');

    const last = channel[channel.length - 1] ?? 0;
    const first = channel[0] ?? 0;
    const joinStep = Math.abs(first - last);

    let largestInternalStep = 0;
    for (let frame = 1; frame < channel.length; frame += 1) {
      largestInternalStep = Math.max(
        largestInternalStep,
        Math.abs((channel[frame] ?? 0) - (channel[frame - 1] ?? 0)),
      );
    }

    expect(joinStep).toBeLessThanOrEqual(largestInternalStep * 1.01);
  });

  it('rounds its length to a whole number of cycles', () => {
    // A cycle of 480 Hz is a hundred frames at the fixture rate. The second
    // length is nearer the whole cycle above it than the one below.
    expect(loopableSine(480, { length: 1_030 }).length).toBe(1_000);
    expect(loopableSine(480, { length: 1_070 }).length).toBe(1_100);
  });

  it('never produces an empty signal, however short the request', () => {
    // One whole cycle of 20 Hz at the fixture rate.
    expect(loopableSine(20, { length: 1 }).length).toBe(2_400);
  });
});

describe('silence', () => {
  it('is exactly zero everywhere', () => {
    expect(peakOf(silence())).toBe(0);
    expect(rmsOf(silence())).toBe(0);
  });
});

describe('directCurrent', () => {
  it('holds a constant offset', () => {
    const [channel] = directCurrent(0.25).channels;
    expect(new Set(Array.from(channel ?? [])).size).toBe(1);
    expect(channel?.[0]).toBeCloseTo(0.25, 6);
  });

  it('has an RMS equal to its offset, which a sine never does', () => {
    expect(rmsOf(directCurrent(0.3))).toBeCloseTo(0.3, 5);
  });
});

describe('impulse', () => {
  it('is one full-scale sample in silence', () => {
    const [channel] = impulse(100).channels;
    expect(channel?.[100]).toBe(1);
    expect(channel?.[99]).toBe(0);
    expect(channel?.[101]).toBe(0);
  });

  it('produces silence when placed outside the signal', () => {
    expect(peakOf(impulse(-1))).toBe(0);
    expect(peakOf(impulse(FIXTURE_LENGTH + 1))).toBe(0);
  });
});

describe('clickInSine', () => {
  it('differs from the clean sine at exactly one sample', () => {
    const clean = sine(440).channels[0];
    const damaged = clickInSine(440, 1_000).channels[0];
    if (clean === undefined || damaged === undefined) throw new Error('no channel');

    let differences = 0;
    for (let frame = 0; frame < clean.length; frame += 1) {
      if (clean[frame] !== damaged[frame]) differences += 1;
    }

    expect(differences).toBe(1);
  });

  it('makes the click a genuine discontinuity', () => {
    const [channel] = clickInSine(440, 1_000).channels;
    if (channel === undefined) throw new Error('no channel');

    const stepAtClick = Math.abs((channel[1_000] ?? 0) - (channel[999] ?? 0));
    const stepElsewhere = Math.abs((channel[500] ?? 0) - (channel[499] ?? 0));

    expect(stepAtClick).toBeGreaterThan(stepElsewhere * 10);
  });
});

describe('transient', () => {
  it('is silent before the step and steady after it', () => {
    const [channel] = transient(1_000, { amplitude: 0.9 }).channels;
    expect(channel?.[999]).toBe(0);
    expect(channel?.[1_000]).toBeCloseTo(0.9, 6);
    expect(channel?.[2_000]).toBeCloseTo(0.9, 6);
  });
});

describe('noise', () => {
  it('fills the range rather than clustering', () => {
    const [channel] = noise(1, { amplitude: 1 }).channels;
    if (channel === undefined) throw new Error('no channel');

    // Every tenth of the range holds roughly a tenth of the samples. Counting
    // only the samples below zero would pass a generator that clustered near
    // zero on both sides, or at the two extremes.
    const bands = 10;
    const counts = new Array<number>(bands).fill(0);
    for (const sample of channel) {
      const band = Math.min(bands - 1, Math.floor(((sample + 1) / 2) * bands));
      counts[band] = (counts[band] ?? 0) + 1;
    }

    for (const count of counts) {
      expect(count / channel.length).toBeGreaterThan(0.08);
      expect(count / channel.length).toBeLessThan(0.12);
    }
  });

  it('honours its amplitude', () => {
    // Reaches it as well as stays inside it: a silent generator stays inside
    // any amplitude, and would pass were only the ceiling asserted.
    const peak = peakOf(noise(1, { amplitude: 0.1 }));
    expect(peak).toBeLessThanOrEqual(0.1);
    expect(peak).toBeGreaterThan(0.099);
  });
});

describe('noisySine', () => {
  it('is louder than the clean sine, because the noise adds to it', () => {
    // Strictly louder. A comparison that allowed a tenth less than the clean
    // sine would pass a noisy sine quieter than the sine, against its name.
    expect(rmsOf(noisySine(440, 4))).toBeGreaterThan(rmsOf(sine(440)));
  });

  it('gets noisier as the ratio falls', () => {
    const clean = rmsOf(sine(440));
    const barelyNoisy = Math.abs(rmsOf(noisySine(440, 20)) - clean);
    const veryNoisy = Math.abs(rmsOf(noisySine(440, 2)) - clean);

    expect(veryNoisy).toBeGreaterThan(barelyNoisy);
  });
});

describe('chirp', () => {
  it('sweeps upwards, so the second half crosses zero more often than the first', () => {
    const [channel] = chirp(20, 20_000).channels;
    if (channel === undefined) throw new Error('no channel');

    const crossingsIn = (from: number, to: number): number => {
      let count = 0;
      for (let frame = from + 1; frame < to; frame += 1) {
        if ((channel[frame - 1] ?? 0) < 0 && (channel[frame] ?? 0) >= 0) count += 1;
      }
      return count;
    };

    const half = Math.floor(channel.length / 2);
    expect(crossingsIn(half, channel.length)).toBeGreaterThan(crossingsIn(0, half) * 5);
  });
});

describe('stereo', () => {
  it('carries a different signal in each channel', () => {
    const pair = stereo(sine(440), sine(554));

    expect(pair.channels).toHaveLength(2);
    expect(pair.channelLayout.roles).toEqual([ChannelRole.Left, ChannelRole.Right]);
    const [left, right] = pair.channels;
    if (left === undefined || right === undefined) throw new Error('no channel');
    expect(firstDifference(left, right)).not.toBe(-1);
  });

  it('trims to the shorter of the two channels', () => {
    const pair = stereo(sine(440, { length: 1_000 }), sine(554, { length: 500 }));
    expect(pair.length).toBe(500);
  });

  it('refuses to build from channels at different rates', () => {
    expect(() => stereo(sine(440), sine(440, { sampleRate: 44_100 }))).toThrow(/sample rates/);
  });
});

describe('surround5_1', () => {
  it('has six channels in the conventional order', () => {
    const signal = surround5_1();

    expect(signal.channels).toHaveLength(6);
    expect(signal.channelLayout.roles).toEqual([
      ChannelRole.Left,
      ChannelRole.Right,
      ChannelRole.Centre,
      ChannelRole.LowFrequency,
      ChannelRole.SurroundLeft,
      ChannelRole.SurroundRight,
    ]);
  });

  it('gives every channel a distinct signal, so a reorder is detectable', () => {
    const { channels } = surround5_1();
    const identicalPairs = channels.flatMap((channel, index) =>
      channels
        .slice(index + 1)
        .flatMap((other, offset) =>
          firstDifference(channel, other) === -1 ? [[index, index + 1 + offset]] : [],
        ),
    );
    expect(channels).toHaveLength(6);
    expect(identicalPairs).toEqual([]);
  });
});
