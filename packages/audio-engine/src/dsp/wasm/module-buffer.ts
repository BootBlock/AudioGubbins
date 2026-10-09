/**
 * A buffer in the DSP module's memory, and the view the engine reads and
 * writes it through.
 *
 * The view is checked just before it is used: a view made before the module's
 * memory grew is of the old buffer, and would read nothing, so it is made
 * again then. Otherwise the view is kept, so a call on the audio thread
 * allocates nothing.
 */

import type { DspExports } from './dsp-exports.js';

/** How a buffer of one element type is made, found and released, and viewed. */
export interface ModuleElements<View extends Float32Array | Float64Array> {
  /** What the buffer holds, for the fault when it cannot be made. */
  readonly noun: string;
  create(module: DspExports, count: number): number;
  address(module: DspExports, handle: number): number;
  release(module: DspExports, handle: number): void;
  view(memory: ArrayBuffer, address: number, count: number): View;
  readonly empty: View;
}

/** Samples, as the oscillator and the resampler carry them. */
export const SAMPLES: ModuleElements<Float32Array> = {
  noun: 'samples',
  create: (module, count) => module.bufferCreate(count),
  address: (module, handle) => module.bufferAddress(handle),
  release: (module, handle) => {
    module.bufferRelease(handle);
  },
  view: (memory, address, count) => new Float32Array(memory, address, count),
  empty: new Float32Array(0),
};

/** Doubles, as the FFT reads a signal and writes a spectrum. */
export const DOUBLES: ModuleElements<Float64Array> = {
  noun: 'doubles',
  create: (module, count) => module.bufferF64Create(count),
  address: (module, handle) => module.bufferF64Address(handle),
  release: (module, handle) => {
    module.bufferF64Release(handle);
  },
  view: (memory, address, count) => new Float64Array(memory, address, count),
  empty: new Float64Array(0),
};

/** A buffer in the module's memory that grows to what it is asked to hold. */
export class ModuleBuffer<View extends Float32Array | Float64Array> {
  readonly #module: DspExports;
  readonly #elements: ModuleElements<View>;
  #handle = 0;
  #count = 0;
  /** The last view made, and the memory buffer it is of: made again when either changes. */
  #view: View;
  #viewOf: ArrayBuffer | undefined;

  constructor(module: DspExports, elements: ModuleElements<View>) {
    this.#module = module;
    this.#elements = elements;
    this.#view = elements.empty;
  }

  /**
   * The buffer's handle, holding at least `count` elements: made on first use
   * even for none, so a call of zero frames names a buffer the module knows.
   */
  holding(count: number): number {
    if (this.#handle === 0 || count > this.#count) {
      this.release();
      const handle = this.#elements.create(this.#module, count);
      if (handle === 0) {
        throw new Error(
          `The DSP module could not allocate ${String(count)} ${this.#elements.noun}.`,
        );
      }
      this.#handle = handle;
      this.#count = count;
      this.#viewOf = undefined;
    }
    return this.#handle;
  }

  /**
   * A view of the first `count` elements of the memory as it is now: the view
   * last made, unless the memory has grown, the buffer been made again, or
   * the length changed since.
   */
  view(count: number): View {
    const memory = this.#module.memoryBuffer();
    if (memory !== this.#viewOf || this.#view.length !== count) {
      const address = this.#elements.address(this.#module, this.#handle);
      this.#view = this.#elements.view(memory, address, count);
      this.#viewOf = memory;
    }
    return this.#view;
  }

  release(): void {
    if (this.#handle !== 0) this.#elements.release(this.#module, this.#handle);
    this.#handle = 0;
    this.#count = 0;
    this.#viewOf = undefined;
  }
}
