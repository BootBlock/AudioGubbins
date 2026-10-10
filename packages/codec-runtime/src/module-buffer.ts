/**
 * A buffer in the codec module's memory, and the view the runtime fills or
 * reads it through.
 *
 * The view is made again whenever the memory has grown since the last one,
 * which detaches the old buffer, and whenever the buffer is made larger.
 */

import type { CodecExports } from './codec-exports.js';

/** How a buffer of one element type is made, found, released and viewed. */
export interface ModuleElements<View extends Uint8Array | Float32Array | Int32Array> {
  create(module: CodecExports, count: number): number;
  address(module: CodecExports, handle: number): number;
  release(module: CodecExports, handle: number): void;
  view(memory: ArrayBuffer, address: number, count: number): View;
}

/** Bytes: a packet given to a decoder. */
export const BYTES: ModuleElements<Uint8Array> = {
  create: (module, count) => module.bytesCreate(count),
  address: (module, handle) => module.bytesAddress(handle),
  release: (module, handle) => {
    module.bytesRelease(handle);
  },
  view: (memory, address, count) => new Uint8Array(memory, address, count),
};

/** Samples: what a decoder answers and an Opus encoder takes. */
export const FLOATS: ModuleElements<Float32Array> = {
  create: (module, count) => module.floatsCreate(count),
  address: (module, handle) => module.floatsAddress(handle),
  release: (module, handle) => {
    module.floatsRelease(handle);
  },
  view: (memory, address, count) => new Float32Array(memory, address, count),
};

/** Integer samples: what a FLAC encoder takes. */
export const INTS: ModuleElements<Int32Array> = {
  create: (module, count) => module.intsCreate(count),
  address: (module, handle) => module.intsAddress(handle),
  release: (module, handle) => {
    module.intsRelease(handle);
  },
  view: (memory, address, count) => new Int32Array(memory, address, count),
};

/** A buffer in the module's memory that grows to what it is asked to hold. */
export class ModuleBuffer<View extends Uint8Array | Float32Array | Int32Array> {
  readonly #module: CodecExports;
  readonly #elements: ModuleElements<View>;
  #handle = 0;
  #count = 0;

  constructor(module: CodecExports, elements: ModuleElements<View>) {
    this.#module = module;
    this.#elements = elements;
  }

  /**
   * The buffer's handle, holding at least `count` elements, or the module's
   * negative answer where it could not make one.
   */
  holding(count: number): number {
    if (this.#handle <= 0 || count > this.#count) {
      this.release();
      const handle = this.#elements.create(this.#module, Math.max(count, 1));
      if (handle <= 0) return handle;
      this.#handle = handle;
      this.#count = Math.max(count, 1);
    }
    return this.#handle;
  }

  /** A view of the buffer's first `count` elements, of the memory as it is now. */
  view(count: number): View {
    const address = this.#elements.address(this.#module, this.#handle);
    return this.#elements.view(this.#module.memoryBuffer(), address, count);
  }

  release(): void {
    if (this.#handle > 0) this.#elements.release(this.#module, this.#handle);
    this.#handle = 0;
    this.#count = 0;
  }
}

/** A copy of `length` bytes of the module's memory from `address`. */
export function copyOut(module: CodecExports, address: number, length: number): Uint8Array {
  return new Uint8Array(module.memoryBuffer(), address, length).slice();
}
