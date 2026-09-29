import { describe, expect, it } from 'vitest';

import { DspImplementation, wasmDsp } from '@audiogubbins/audio-engine';

import { dspModuleBytes } from '../testing/dsp-module-bytes.js';
import { scopeDsp } from './dsp-instance.js';

// This project runs in jsdom, whose global `ArrayBuffer` is not the realm the
// module's memory is made in, so these tests also hold the engine's check of
// the memory to one that does not depend on the realm.

/** The smallest valid module: the magic number and version, and nothing the ABI needs. */
const EMPTY_MODULE = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

/** A double's bits, so equality is to the bit and not to the value (ADR-0032). */
function bitsOf(value: number): bigint {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  return view.getBigUint64(0);
}

describe('scopeDsp', () => {
  it('runs the WebAssembly module it was sent, with no fallback reason', async () => {
    const module = await WebAssembly.compile(dspModuleBytes());

    const scoped = scopeDsp(module, undefined);

    expect(scoped.dsp.implementation).toBe(DspImplementation.WebAssembly);
    expect(scoped.fallbackReason).toBeUndefined();
  });

  it('runs the reference path with the main thread’s reason when no module was sent', () => {
    const scoped = scopeDsp(undefined, 'This page cannot compile WebAssembly.');

    expect(scoped.dsp.implementation).toBe(DspImplementation.Reference);
    expect(scoped.fallbackReason).toBe('This page cannot compile WebAssembly.');
  });

  it('runs the reference path with the engine’s reason for a module without the ABI', async () => {
    const module = await WebAssembly.compile(EMPTY_MODULE);
    const checked = wasmDsp(new WebAssembly.Instance(module, {}).exports);
    const enginesReason = checked.ok ? undefined : checked.failures[0].summary;

    const scoped = scopeDsp(module, 'unused, since a module was sent');

    expect(enginesReason).toBeDefined();
    expect(scoped.dsp.implementation).toBe(DspImplementation.Reference);
    expect(scoped.fallbackReason).toBe(enginesReason);
  });

  it('gives the same bits on both paths', async () => {
    const module = await WebAssembly.compile(dspModuleBytes());

    const compiled = scopeDsp(module, undefined).dsp;
    const reference = scopeDsp(undefined, 'the reference path, for comparison').dsp;

    expect(compiled.implementation).not.toBe(reference.implementation);
    expect(bitsOf(compiled.sineOfTurns(0.1))).toBe(bitsOf(reference.sineOfTurns(0.1)));
    // The golden value both are held to, so two paths agreeing on a wrong
    // answer would still fail.
    expect(bitsOf(compiled.sineOfTurns(0.1))).toBe(0x3fe2cf2304755a5en);
  });
});
