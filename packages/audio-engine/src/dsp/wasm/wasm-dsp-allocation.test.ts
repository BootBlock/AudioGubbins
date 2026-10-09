/**
 * The WebAssembly path allocates nothing per call once it is warm.
 *
 * An oscillator renders on the audio thread, where a collection pauses the
 * quantum that triggered it, and an FFT runs per block of a spectral processor
 * there, so a view of the module's memory made per call, an argument array per
 * call into the module, or a closure per push is a pause waiting to happen.
 * Views are made again only when the memory's buffer or the module buffer they
 * look at changes.
 *
 * How an allocation is measured, and why that way, is in
 * `testing/allocation.ts`.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { sampleRate } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import { QUANTA, allocatedBy } from '../../testing/allocation.js';
import { dspModuleExports } from '../../testing/dsp-module.js';
import { ResamplingQuality, type CanonicalDsp } from '../canonical-dsp.js';
import { wasmDsp } from './wasm-dsp.js';

/** The frames of one render quantum. */
const FRAMES = 128;

let wasm: CanonicalDsp;

beforeAll(async () => {
  wasm = expectSuccess(wasmDsp(await dspModuleExports()));
});

describe('the WebAssembly path allocates nothing per call', () => {
  it('rendering an oscillator', () => {
    const oscillator = expectSuccess(
      wasm.createOscillator({
        frequency: 997,
        sampleRate: expectSuccess(sampleRate(48_000)),
        startPhase: 0,
        amplitude: 0.5,
      }),
    );
    const into = new Float32Array(FRAMES);

    const allocated = allocatedBy({
      quantum: () => {
        oscillator.render(into);
      },
    });

    oscillator.release();
    expect(allocated).toBeLessThan(QUANTA);
  });

  it('pushing to and pulling from a resampler', () => {
    const resampler = expectSuccess(
      wasm.createResampler({
        from: expectSuccess(sampleRate(48_000)),
        to: expectSuccess(sampleRate(48_000)),
        channels: 2,
        quality: ResamplingQuality.Draft,
      }),
    );
    const input = [new Float32Array(FRAMES).fill(0.25), new Float32Array(FRAMES).fill(-0.25)];
    const output = [new Float32Array(FRAMES), new Float32Array(FRAMES)];

    // Equal rates pass each quantum through whole, so the stream holds no
    // more between quanta and the module's memory settles.
    const allocated = allocatedBy({
      quantum: () => {
        resampler.push(input);
        resampler.pull(output);
      },
    });

    resampler.release();
    expect(output[1]?.[0]).toBe(-0.25);
    expect(allocated).toBeLessThan(QUANTA);
  });

  it('transforming a block to its spectrum and back', () => {
    const fft = expectSuccess(wasm.createFft(256));
    const signal = new Float32Array(256).fill(0.5);
    const real = new Float64Array(fft.bins);
    const imaginary = new Float64Array(fft.bins);

    const allocated = allocatedBy({
      quantum: () => {
        fft.forwardReal(signal, real, imaginary);
        fft.inverseReal(real, imaginary, signal);
      },
    });

    fft.release();
    expect(real[0]).toBe(128);
    expect(allocated).toBeLessThan(QUANTA);
  });
});
