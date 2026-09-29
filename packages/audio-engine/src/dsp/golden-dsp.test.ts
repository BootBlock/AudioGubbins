/**
 * The canonical DSP, held to the golden values the Rust crates are held to.
 *
 * Every value here is also asserted by `cargo test` in `crates/dsp-core` and
 * `crates/resampling`, so the Rust module, the TypeScript reference path and
 * the crates' own tests are one rule written three times, and a change to any
 * of them fails at least one (ADR-0032). The tolerance is zero.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { sampleRate, type SampleRate } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import { dspModuleExports } from '../testing/dsp-module.js';
import { fingerprint } from '../testing/pcm-fingerprint.js';
import { DspImplementation, ResamplingQuality, type CanonicalDsp } from './canonical-dsp.js';
import { REFERENCE_DSP } from './reference/reference-dsp.js';
import { wasmDsp } from './wasm/wasm-dsp.js';

function rate(value: number): SampleRate {
  return expectSuccess(sampleRate(value));
}

/** The bits of an f64, as the crates print them. */
function bitsOf(value: number): bigint {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  return view.getBigUint64(0);
}

/** The ramp both languages' tests convert: `((i % 97) − 48) / 64`. */
function ramp(frames: number): Float32Array {
  return Float32Array.from({ length: frames }, (_, index) => ((index % 97) - 48) / 64);
}

/** Converts `input` in pushes of `pushed` frames, pulling in `pulled`. */
function convert(
  dsp: CanonicalDsp,
  input: Float32Array,
  from: number,
  to: number,
  pushed: number,
  pulled: number,
): Float32Array {
  const resampler = expectSuccess(
    dsp.createResampler({
      from: rate(from),
      to: rate(to),
      channels: 1,
      quality: ResamplingQuality.Maximum,
    }),
  );
  const output: number[] = [];
  const buffer = new Float32Array(pulled);
  const drain = (): void => {
    for (;;) {
      const written = resampler.pull([buffer]);
      output.push(...buffer.subarray(0, written));
      if (written < pulled) return;
    }
  };
  for (let start = 0; start < input.length; start += pushed) {
    resampler.push([input.subarray(start, start + pushed)]);
    drain();
  }
  resampler.finish();
  drain();
  expect(resampler.drained).toBe(true);
  resampler.release();
  return Float32Array.from(output);
}

let wasm: CanonicalDsp;

beforeAll(async () => {
  wasm = expectSuccess(wasmDsp(await dspModuleExports()));
});

describe.each([
  ['the WebAssembly module', () => wasm],
  ['the reference path', () => REFERENCE_DSP],
])('the canonical DSP in %s', (_name, dspOf) => {
  it('gives the golden sine bits', () => {
    const turns = [0.1, 0.3, 0.6, 0.9, -0.2, 12.345];
    expect(turns.map((value) => bitsOf(dspOf().sineOfTurns(value)))).toEqual([
      0x3fe2cf2304755a5en,
      0x3fee6f0e134454ffn,
      0xbfe2cf2304755a5cn,
      0xbfe2cf2304755a5cn,
      0xbfee6f0e134454fen,
      0x3fea7771ae3550f5n,
    ]);
  });

  it('renders the golden tone', () => {
    const oscillator = expectSuccess(
      dspOf().createOscillator({
        frequency: 440,
        sampleRate: rate(48_000),
        startPhase: 0,
        amplitude: 0.5,
      }),
    );
    const samples = new Float32Array(4_800);
    oscillator.render(samples);
    oscillator.release();
    expect(fingerprint(samples)).toBe(0x46fc8a6833be7402n);
  });

  it('converts the golden ramp', () => {
    const output = convert(dspOf(), ramp(2_000), 44_100, 48_000, 300, 256);
    expect(output.length).toBe(2_177);
    // Was 0x07bc2c6d5a22da3f before each quality's filter was designed from
    // its passband edge and stopband floor (REQ-EXEC-180); see
    // `GOLDEN_CONVERSION` in `stream.rs`, which holds the same value.
    expect(fingerprint(output)).toBe(0x98be85a59ec272f0n);
  });

  it('writes the same bits whatever the chunks it is fed and pulled in', () => {
    const input = ramp(3_000);
    const whole = convert(dspOf(), input, 48_000, 32_000, 3_000, 4_096);
    const pieces = convert(dspOf(), input, 48_000, 32_000, 17, 5);
    expect(pieces).toEqual(whole);
  });

  it('renders a call of no frames, and the frames after it as if it had not been made', () => {
    const oscillator = expectSuccess(
      dspOf().createOscillator({
        frequency: 440,
        sampleRate: rate(48_000),
        startPhase: 0,
        amplitude: 0.5,
      }),
    );
    oscillator.render(new Float32Array(0));
    const samples = new Float32Array(4_800);
    oscillator.render(samples);
    oscillator.release();
    expect(fingerprint(samples)).toBe(0x46fc8a6833be7402n);
  });

  it('takes and gives no frames, and throws the same fault for arrays of the wrong shape', () => {
    const resampler = expectSuccess(
      dspOf().createResampler({
        from: rate(48_000),
        to: rate(44_100),
        channels: 2,
        quality: ResamplingQuality.Draft,
      }),
    );
    const empty = new Float32Array(0);
    resampler.push([empty, empty]);
    expect(resampler.pull([empty, empty])).toBe(0);

    const long = new Float32Array(64);
    const short = new Float32Array(32);
    const uneven = 'A resampler was given channel arrays of different lengths.';
    expect(() => {
      resampler.push([long, short]);
    }).toThrow(uneven);
    expect(() => {
      resampler.push([short, long]);
    }).toThrow(uneven);
    expect(() => {
      resampler.push([long]);
    }).toThrow('A resampler of 2 channels was given 1 arrays.');
    resampler.push([long, long]);
    resampler.finish();
    expect(() => resampler.pull([long, short])).toThrow(uneven);
    expect(() => resampler.pull([short, long])).toThrow(uneven);
    expect(() => resampler.pull([long, long, long])).toThrow(
      'A resampler of 2 channels was given 3 arrays.',
    );
    expect(() => resampler.seek(1.5)).toThrow('A resampler cannot seek to frame 1.5.');
    // Nothing refused was taken: the 64 frames pushed whole convert to 59.
    expect(resampler.pull([long, long])).toBe(59);
    resampler.release();
  });

  it('refuses a tone above half the rate, with the reason', () => {
    const refused = dspOf().createOscillator({
      frequency: 30_000,
      sampleRate: rate(48_000),
      startPhase: 0,
      amplitude: 1,
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.failures[0].code).toBe('dsp.oscillator-frequency-out-of-range');
  });
});

describe('the two implementations', () => {
  it('say which they are', () => {
    expect(wasm.implementation).toBe(DspImplementation.WebAssembly);
    expect(REFERENCE_DSP.implementation).toBe(DspImplementation.Reference);
  });

  it('agree on every sample of a long multichannel conversion between unrelated rates', () => {
    // 44 099 and 48 000 share no factor, so the kernel's table has 48 000
    // phases, each filled the first time it is used, in the order the
    // conversion reaches them.
    const left = ramp(6_000);
    const right = left.map((sample) => -sample / 2);
    const run = (dsp: CanonicalDsp): Float32Array[] => {
      const resampler = expectSuccess(
        dsp.createResampler({
          from: rate(44_099),
          to: rate(48_000),
          channels: 2,
          quality: ResamplingQuality.Draft,
        }),
      );
      resampler.push([left, right]);
      resampler.finish();
      const out = [new Float32Array(7_000), new Float32Array(7_000)];
      const written = resampler.pull(out);
      resampler.release();
      return out.map((channel) => channel.subarray(0, written));
    };
    expect(run(wasm)).toEqual(run(REFERENCE_DSP));
  });
});
