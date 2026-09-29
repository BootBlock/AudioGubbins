import { afterEach, describe, expect, it, vi } from 'vitest';

import { DspImplementation } from '@audiogubbins/audio-engine';

import { dspModuleBytes } from '../testing/dsp-module-bytes.js';
import { workletDsp } from './worklet-dsp.js';

/** Makes `new WebAssembly.Module` throw `error`, as the engine compiling in the worklet would. */
function compilingThrows(error: Error): void {
  vi.spyOn(WebAssembly, 'Module').mockImplementation(function refuse(): never {
    throw error;
  });
}

describe('workletDsp', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs the module compiled from its bytes', () => {
    expect(workletDsp(dspModuleBytes(), undefined)).toMatchObject({
      dsp: { implementation: DspImplementation.WebAssembly },
      fallbackReason: undefined,
    });
  });

  it('runs the reference path, with the reason, on bytes the engine refuses', () => {
    expect(workletDsp(dspModuleBytes().slice(0, 40), undefined)).toMatchObject({
      dsp: { implementation: DspImplementation.Reference },
      fallbackReason: expect.stringMatching(
        /^The DSP module could not be compiled in the audio thread: /u,
      ),
    });
  });

  it('runs the reference path, with the reason, when the engine is out of memory', () => {
    compilingThrows(new RangeError('Out of memory.'));

    expect(workletDsp(dspModuleBytes(), undefined)).toMatchObject({
      dsp: { implementation: DspImplementation.Reference },
      fallbackReason: 'The DSP module could not be compiled in the audio thread: Out of memory.',
    });
  });

  it('lets a fault that is no refusal surface as itself', () => {
    const fault = new TypeError('Cannot read properties of undefined.');
    compilingThrows(fault);

    expect(() => workletDsp(dspModuleBytes(), undefined)).toThrow(fault);
  });
});
