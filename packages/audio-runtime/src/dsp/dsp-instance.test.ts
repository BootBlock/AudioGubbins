import { describe, expect, it } from 'vitest';

import { DspImplementation, wasmDsp } from '@audiogubbins/audio-engine';
import { dspModuleBytes } from '@audiogubbins/audio-engine/testing';

import { DspDeliveryKind } from './dsp-delivery.js';
import { scopeDsp } from './dsp-instance.js';

// This project runs in jsdom, whose global `ArrayBuffer` is not the realm the
// module's memory is made in, so these tests also hold the engine's check of
// the memory to one that does not depend on the realm.

/** The smallest valid module: the magic number and version, and nothing the ABI needs. */
const EMPTY_MODULE = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

/**
 * A module that imports a function from a module named `env`, which the empty
 * import object a scope instantiates with does not have: instantiating it
 * throws a `TypeError`, a fault in the caller rather than a refusal.
 */
const IMPORTING_MODULE = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  // Types: one function of no parameters and no results.
  0x01, 0x04, 0x01, 0x60, 0x00, 0x00,
  // Imports: `env.f`, a function of that type.
  0x02, 0x09, 0x01, 0x03, 0x65, 0x6e, 0x76, 0x01, 0x66, 0x00, 0x00,
]);

/** A module whose start function traps, so instantiating it throws a `RuntimeError`. */
const TRAPPING_MODULE = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  // Types: one function of no parameters and no results.
  0x01, 0x04, 0x01, 0x60, 0x00, 0x00,
  // Functions: one, of that type.
  0x03, 0x02, 0x01, 0x00,
  // Start: that function.
  0x08, 0x01, 0x00,
  // Code: its body, `unreachable`.
  0x0a, 0x05, 0x01, 0x03, 0x00, 0x00, 0x0b,
]);

/** A double's bits, so equality is to the bit and not to the value (ADR-0032). */
function bitsOf(value: number): bigint {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  return view.getBigUint64(0);
}

describe('scopeDsp', () => {
  it('runs the WebAssembly module it was sent, with no fallback reason', async () => {
    const module = await WebAssembly.compile(dspModuleBytes());

    const scoped = scopeDsp({ kind: DspDeliveryKind.Available, module });

    expect(scoped.dsp.implementation).toBe(DspImplementation.WebAssembly);
    expect(scoped.fallbackReason).toBeUndefined();
  });

  it('runs the reference path with the main thread’s reason when no module was sent', () => {
    const scoped = scopeDsp({
      kind: DspDeliveryKind.Unavailable,
      reason: 'This page cannot compile WebAssembly.',
    });

    expect(scoped.dsp.implementation).toBe(DspImplementation.Reference);
    expect(scoped.fallbackReason).toBe('This page cannot compile WebAssembly.');
  });

  it('runs the reference path with the engine’s reason for a module without the ABI', async () => {
    const module = await WebAssembly.compile(EMPTY_MODULE);
    const checked = wasmDsp(new WebAssembly.Instance(module, {}).exports);
    const enginesReason = checked.ok ? undefined : checked.failures[0].summary;

    const scoped = scopeDsp({ kind: DspDeliveryKind.Available, module });

    expect(enginesReason).toBeDefined();
    expect(scoped.dsp.implementation).toBe(DspImplementation.Reference);
    expect(scoped.fallbackReason).toBe(enginesReason);
    // ADR-0031: the reason reported names what the module lacks.
    expect(scoped.fallbackReason).toBe(
      'The DSP module lacks exports this engine calls: memory, ag_abi_version, ' +
        'ag_buffer_create, ag_buffer_address, ag_buffer_release, ' +
        'ag_buffer_f64_create, ag_buffer_f64_address, ag_buffer_f64_release, ' +
        'ag_sine_of_turns, ag_cosine_of_turns, ag_tangent_of_turns, ag_arctangent_turns, ' +
        'ag_exp, ag_ln, ag_log2, ag_log10, ag_pow, ag_decibels_to_gain, ag_gain_to_decibels, ' +
        'ag_oscillator_create, ag_oscillator_render, ag_oscillator_seek, ag_oscillator_release, ' +
        'ag_resampler_create, ag_resampler_lookahead, ag_resampler_push, ' +
        'ag_resampler_finish, ag_resampler_pull, ag_resampler_drained, ' +
        'ag_resampler_seek, ag_resampler_table_bytes, ag_resampler_release, ' +
        'ag_fft_create, ag_fft_forward_real, ag_fft_inverse_real, ag_fft_release, ' +
        'ag_stft_create, ag_stft_push, ag_stft_pull_complex, ag_stft_pull_polar, ag_stft_release, ' +
        'ag_peak_meter_create, ag_peak_meter_push, ag_peak_meter_read, ag_peak_meter_release, ' +
        'ag_loudness_meter_create, ag_loudness_meter_push, ag_loudness_meter_pull_series, ' +
        'ag_loudness_meter_read, ag_loudness_meter_release, ' +
        'ag_detector_create, ag_detector_record_width, ag_detector_push, ag_detector_pull, ' +
        'ag_detector_release.',
    );
  });

  it('runs the reference path with the reason when the module traps as it starts', async () => {
    const module = await WebAssembly.compile(TRAPPING_MODULE);

    const scoped = scopeDsp({ kind: DspDeliveryKind.Available, module });

    expect(scoped.dsp.implementation).toBe(DspImplementation.Reference);
    expect(scoped.fallbackReason).toMatch(/^The DSP module could not start: ./u);
  });

  it('lets a TypeError from instantiating surface as itself, a fault not a refusal', async () => {
    const module = await WebAssembly.compile(IMPORTING_MODULE);

    expect(() => scopeDsp({ kind: DspDeliveryKind.Available, module })).toThrow(TypeError);
  });

  it('gives the same bits on both paths', async () => {
    const module = await WebAssembly.compile(dspModuleBytes());

    const compiled = scopeDsp({ kind: DspDeliveryKind.Available, module }).dsp;
    const reference = scopeDsp({
      kind: DspDeliveryKind.Unavailable,
      reason: 'the reference path, for comparison',
    }).dsp;

    expect(compiled.implementation).not.toBe(reference.implementation);
    expect(bitsOf(compiled.sineOfTurns(0.1))).toBe(bitsOf(reference.sineOfTurns(0.1)));
    // The golden value both are held to, so two paths agreeing on a wrong
    // answer would still fail.
    expect(bitsOf(compiled.sineOfTurns(0.1))).toBe(0x3fe2cf2304755a5en);
  });
});
