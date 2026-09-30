/**
 * The signal source: a recipe's frames made anywhere, the same bits however
 * they are reached, on both DSP paths, and the recipe held to its bounds when
 * it is read.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import {
  StandardLayouts,
  mapResult,
  sampleCount,
  sampleRate,
  type ChannelLayout,
  type SampleCount,
} from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';

import type { CanonicalDsp } from '../dsp/canonical-dsp.js';
import { REFERENCE_DSP } from '../dsp/reference/reference-dsp.js';
import { wasmDsp } from '../dsp/wasm/wasm-dsp.js';
import { countingDsp } from '../testing/counting-dsp.js';
import { dspModuleExports } from '../testing/dsp-module.js';
import { allocateBlock } from './frame-block.js';
import type { PcmSource } from './pcm-source.js';
import { signalRecipe, type SignalRecipe } from './signal-recipe.js';
import { signalSource } from './signal-source.js';

const RATE = expectSuccess(sampleRate(48_000));

function frames(value: number): SampleCount {
  return expectSuccess(sampleCount(value));
}

function recipe(value: unknown): SignalRecipe {
  return expectSuccess(signalRecipe(value));
}

/** Left: a burst of 440 Hz, a gap, an impulse, repeating. Right: 660 Hz once, then silence. */
const BURSTS = recipe({
  length: 10_000_000_000,
  channels: [
    {
      repeats: true,
      segments: [
        { kind: 'tone', length: 4_800, frequency: 440, amplitude: 0.5 },
        { kind: 'silence', length: 2_400 },
        { kind: 'impulse', length: 2_400, amplitude: -0.75 },
      ],
    },
    {
      repeats: false,
      segments: [{ kind: 'tone', length: 3_000, frequency: 660, amplitude: 0.25 }],
    },
  ],
});

function source(
  dsp: CanonicalDsp,
  made = BURSTS,
  layout: ChannelLayout = StandardLayouts.stereo,
): PcmSource {
  return expectSuccess(signalSource(dsp, { layout, sampleRate: RATE, recipe: made }));
}

async function readRange(
  from: PcmSource,
  start: number,
  count: number,
  chunk: number,
): Promise<Float32Array[]> {
  const out = from.layout.roles.map(() => new Float32Array(count));
  const block = allocateBlock(from.layout, from.sampleRate, chunk);
  for (let offset = 0; offset < count; offset += chunk) {
    const read = await from.read(frames(start + offset), block);
    block.channels.forEach((channel, index) =>
      out[index]?.set(channel.subarray(0, Math.min(read, count - offset)), offset),
    );
  }
  return out;
}

/** `dsp`, counting every frame its oscillators render. */
function countingRenders(dsp: CanonicalDsp): { dsp: CanonicalDsp; rendered: () => number } {
  let rendered = 0;
  return {
    dsp: {
      ...dsp,
      createOscillator: (settings) =>
        mapResult(dsp.createOscillator(settings), (oscillator) => ({
          render: (into: Float32Array) => {
            rendered += into.length;
            oscillator.render(into);
          },
          seek: (frame: number) => {
            oscillator.seek(frame);
          },
          release: () => {
            oscillator.release();
          },
        })),
    },
    rendered: () => rendered,
  };
}

let wasm: CanonicalDsp;

beforeAll(async () => {
  wasm = expectSuccess(wasmDsp(await dspModuleExports()));
});

describe.each([
  ['the WebAssembly module', () => wasm],
  ['the reference path', () => REFERENCE_DSP],
])('a signal source on %s', (_path, dspOf) => {
  it('writes each segment: the tone, the silence, the impulse, and silence after a programme ends', async () => {
    const [left, right] = await readRange(source(dspOf()), 0, 9_600, 1_000);
    expect(left?.slice(4_800, 7_200).every((sample) => sample === 0)).toBe(true);
    expect(left?.[7_200]).toBe(-0.75);
    expect(left?.slice(7_201).every((sample) => sample === 0)).toBe(true);
    expect(Math.max(...(left?.slice(0, 4_800) ?? []))).toBeCloseTo(0.5, 3);
    expect(right?.slice(3_000).every((sample) => sample === 0)).toBe(true);
  });

  it('writes a repeat the bits of the first pass, hours in', async () => {
    const period = 9_600;
    const late = 1_000_000 * period;
    const first = await readRange(source(dspOf()), 0, period, 777);
    const again = await readRange(source(dspOf()), late, period, 1_000);
    expect(again[0]).toEqual(first[0]);
  });

  it('writes from the middle the bits a read from the start writes', async () => {
    const whole = await readRange(source(dspOf()), 0, 20_000, 1_000);
    const middle = await readRange(source(dspOf()), 5_000, 15_000, 333);
    expect(middle).toEqual(whole.map((channel) => channel.subarray(5_000)));
  });

  it('renders only the tone frames it is asked for, however far in they start', async () => {
    const endless = recipe({
      length: 2 ** 53 - 1,
      channels: [0, 1].map(() => ({
        repeats: false,
        segments: [{ kind: 'tone', length: 2 ** 53 - 1, frequency: 997, amplitude: 0.5 }],
      })),
    });
    for (const start of [10, 5_000_000_000]) {
      const { dsp, rendered } = countingRenders(dspOf());
      const made = source(dsp, endless);
      await readRange(made, start, 2_000, 500);
      made.release();
      // Two channels of one tone, and nothing rendered to reach the start.
      expect(rendered()).toBe(4_000);
    }
  });
});

describe('making a signal source', () => {
  it('makes one oscillator for each distinct tone, and releases them all', async () => {
    const counting = countingDsp();
    const made = source(counting.dsp);
    await readRange(made, 0, 1_000, 500);
    expect(counting.made()).toBe(2);
    made.release();
    expect(counting.held()).toBe(0);
  });

  it('refuses a recipe of another channel count than the layout, or a tone above half the rate', () => {
    expect(
      expectFailureCode(
        signalSource(REFERENCE_DSP, {
          layout: StandardLayouts.mono,
          sampleRate: RATE,
          recipe: BURSTS,
        }),
      ),
    ).toBe('pcm.signal-channels-mismatched');
    const shrill = recipe({
      length: 10,
      channels: [
        {
          repeats: false,
          segments: [{ kind: 'tone', length: 10, frequency: 30_000, amplitude: 1 }],
        },
      ],
    });
    const counting = countingDsp();
    expect(
      expectFailureCode(
        signalSource(counting.dsp, {
          layout: StandardLayouts.mono,
          sampleRate: RATE,
          recipe: shrill,
        }),
      ),
    ).toBe('dsp.oscillator-frequency-out-of-range');
    expect(counting.held()).toBe(0);
  });
});

describe('reading a signal recipe', () => {
  const refusedAt = (value: unknown): string | undefined => {
    const read = signalRecipe(value);
    return read.ok ? undefined : String(read.failures[0].details?.['part']);
  };

  it('names the part that is wrong', () => {
    expect(refusedAt(null)).toBe('recipe');
    expect(refusedAt({ length: 1, channels: [] })).toBe('channels');
    expect(refusedAt({ length: -1, channels: [{ repeats: false, segments: [] }] })).toBe('length');
    expect(
      refusedAt({
        length: 1,
        channels: [{ repeats: false, segments: [{ kind: 'noise', length: 1 }] }],
      }),
    ).toBe('channels[0].segments[0].kind');
    expect(
      refusedAt({
        length: 1,
        channels: [{ repeats: false, segments: [{ kind: 'silence', length: 0 }] }],
      }),
    ).toBe('channels[0].segments[0].length');
    expect(
      refusedAt({
        length: 1,
        channels: [{ repeats: false, segments: [{ kind: 'impulse', length: 1, amplitude: 2 }] }],
      }),
    ).toBe('channels[0].segments[0].amplitude');
    expect(refusedAt({ length: 1, channels: [{ repeats: true, segments: [] }] })).toBe(
      'channels[0].segments',
    );
    expect(refusedAt({ length: 1, channels: [{ repeats: 'yes', segments: [] }] })).toBe(
      'channels[0].repeats',
    );
  });

  it('refuses more segments or channels than it bounds, so a message cannot ask for unbounded work', () => {
    // One more than the 4096 segments a channel may have.
    const many = Array.from({ length: 4_097 }, () => ({
      kind: 'silence',
      length: 1,
    }));
    expect(refusedAt({ length: 1, channels: [{ repeats: false, segments: many }] })).toBe(
      'channels[0].segments',
    );
    const wide = Array.from({ length: 257 }, () => ({ repeats: false, segments: [] }));
    expect(refusedAt({ length: 1, channels: wide })).toBe('channels');
    const long = [
      { kind: 'silence', length: 2 ** 52 },
      { kind: 'silence', length: 2 ** 52 },
    ];
    expect(refusedAt({ length: 1, channels: [{ repeats: false, segments: long }] })).toBe(
      'channels[0].segments',
    );
  });
});
