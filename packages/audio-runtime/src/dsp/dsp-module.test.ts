import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AudioRuntimeCapabilities } from '@audiogubbins/capabilities';

import { dspModuleBytes } from '../testing/dsp-module-bytes.js';
import { compileDspModule, DspModuleAvailabilityKind } from './dsp-module.js';

const EVERYTHING: AudioRuntimeCapabilities = {
  playback: true,
  offlineRendering: true,
  webAssembly: true,
  sharedMemory: true,
  outputSelection: true,
  gpu: true,
};

describe('compileDspModule', () => {
  it('compiles the canonical module where WebAssembly can be compiled', async () => {
    const availability = await compileDspModule(dspModuleBytes(), EVERYTHING);

    expect(availability.kind).toBe(DspModuleAvailabilityKind.Compiled);
    expect(
      availability.kind === DspModuleAvailabilityKind.Compiled && availability.module,
    ).toBeInstanceOf(WebAssembly.Module);
  });

  it('does not try where the page cannot compile WebAssembly, and says what that costs', async () => {
    // The bytes are valid, so a module here would mean the capability was ignored.
    const availability = await compileDspModule(dspModuleBytes(), {
      ...EVERYTHING,
      webAssembly: false,
    });

    expect(availability).toEqual({
      kind: DspModuleAvailabilityKind.Unavailable,
      reason:
        'This page cannot compile WebAssembly. ' +
        'Processing runs on the reference path, which gives the same result more slowly.',
    });
  });

  it('reports corrupt bytes as unavailable, with the compiler’s reason', async () => {
    const bytes = dspModuleBytes();
    // The magic number intact and the version word damaged: a download cut or
    // altered in flight, which the compiler refuses.
    bytes[4] = 0xff;

    const availability = await compileDspModule(bytes, EVERYTHING);

    expect(availability.kind).toBe(DspModuleAvailabilityKind.Unavailable);
    const reason =
      availability.kind === DspModuleAvailabilityKind.Unavailable ? availability.reason : '';
    expect(reason).toMatch(
      /^The DSP module could not be compiled: .+ Processing runs on the reference path/,
    );
  });
});

describe('compileDspModule, when compiling fails', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports an engine out of memory as unavailable, with its reason', async () => {
    vi.spyOn(WebAssembly, 'compile').mockRejectedValueOnce(
      new RangeError('Out of memory: Cannot allocate Wasm memory.'),
    );

    const availability = await compileDspModule(dspModuleBytes(), EVERYTHING);

    expect(availability).toEqual({
      kind: DspModuleAvailabilityKind.Unavailable,
      reason:
        'The DSP module could not be compiled: Out of memory: Cannot allocate Wasm memory. ' +
        'Processing runs on the reference path, which gives the same result more slowly.',
    });
  });

  it('lets a fault that is no refusal surface as itself', async () => {
    const fault = new TypeError('WebAssembly.compile(): Argument 0 must be a buffer source.');
    vi.spyOn(WebAssembly, 'compile').mockRejectedValueOnce(fault);

    await expect(compileDspModule(dspModuleBytes(), EVERYTHING)).rejects.toBe(fault);
  });
});
