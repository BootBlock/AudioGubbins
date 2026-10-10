/**
 * The prebuilt encoders of `wasm-media-encoders` 0.7.0 (ADR-0091): LAME 3.100
 * and libvorbis 1.3.7 with libogg 1.3.4, each compiled to a WebAssembly module
 * of its own file, which the codec worker loads only when its format is
 * exported. Nothing of either is compiled into AudioGubbins: this is the one
 * place that knows their C interface, driven directly rather than through the
 * package's script, which inlines both modules into itself as text, cannot be
 * given an Ogg serial number without overriding a random one, and refuses the
 * 56 and 144 kbit/s MP3 rates LAME itself encodes.
 *
 * Each module states its version and MIME type, and one that is not the build
 * this runtime speaks to is refused before it is used. A module's memory may
 * grow on any call, so every view of it is made after the call it follows.
 * A call that traps, or reaches the C library's `exit`, ends the encoder.
 */

import { fail, succeed, type DomainResult } from '@audiogubbins/domain';
import type { SamplePlane } from '@audiogubbins/codecs';

import { prebuiltFailed, prebuiltRefused } from './encoding-failures.js';
import type { PrebuiltEncoderName, WebAssemblyCode } from './export-encoder-request.js';

/** The build of the modules this runtime speaks to, as each states its version. */
const PREBUILT_VERSION = 'wasm-media-encoders-0.7.0';

/** The MIME type each module states. */
const MIME_TYPES: Readonly<Record<PrebuiltEncoderName, string>> = {
  lame: 'audio/mpeg',
  libvorbis: 'audio/ogg',
};

/** The C library's `exit`, which the modules' runtime calls on a fatal error. */
class PrebuiltExit extends Error {
  constructor(code: number) {
    super(`the module exited with status ${String(code)}`);
  }
}

/** A call into a module, with the arguments its C interface gives it. */
type Call = (...args: readonly number[]) => number;

/** The functions the modules export, both alike. */
interface PrebuiltExports {
  readonly memory: WebAssembly.Memory;
  readonly version: Call;
  readonly mimeType: Call;
  readonly malloc: Call;
  readonly free: Call;
  /** `(params)`: the encoder, or 0 where its settings are refused. */
  readonly init: Call;
  /** `(encoder, frames)`: the address of the planes' addresses, or 0. */
  readonly pcm: Call;
  /** `(encoder)`: the address of the output bytes. */
  readonly output: Call;
  /** `(encoder, frames)`: the bytes of output, negative for a failure. */
  readonly encode: Call;
  readonly flush: Call;
  readonly release: Call;
}

const isFunction = (value: unknown): value is (...args: readonly number[]) => unknown =>
  typeof value === 'function';

/** The exports, read, or why the module is not one this runtime calls. */
function readExports(exports: WebAssembly.Exports): DomainResult<PrebuiltExports> {
  const memory = exports['memory'];
  const missing: string[] = memory instanceof WebAssembly.Memory ? [] : ['memory'];
  const call = (name: string): Call => {
    const found = exports[name];
    if (isFunction(found)) return (...args) => Number(found(...args));
    missing.push(name);
    return () => Number.NaN;
  };
  const read = {
    version: call('version'),
    mimeType: call('mime_type'),
    malloc: call('malloc'),
    free: call('free'),
    init: call('enc_init'),
    pcm: call('enc_get_pcm'),
    output: call('enc_get_out_buf'),
    encode: call('enc_encode'),
    flush: call('enc_flush'),
    release: call('enc_free'),
  };
  if (!(memory instanceof WebAssembly.Memory) || missing.length > 0) {
    return fail(
      prebuiltRefused(`The module lacks exports this runtime calls: ${missing.join(', ')}.`),
    );
  }
  return succeed({ memory, ...read });
}

/** A C string at `address`, read as ASCII to its terminating zero. */
function cString(memory: WebAssembly.Memory, address: number): string {
  const bytes = new Uint8Array(memory.buffer, address >>> 0);
  const end = bytes.indexOf(0);
  return String.fromCharCode(...bytes.subarray(0, end === -1 ? 0 : end));
}

/**
 * Runs `call`, answering what it answered or, where it trapped or exited, the
 * failure that ends the encoder. Anything else it throws is a fault in this
 * runtime, raised as itself.
 */
function guarded<T>(name: string, call: () => T): DomainResult<T> {
  try {
    return succeed(call());
  } catch (error) {
    if (error instanceof WebAssembly.RuntimeError || error instanceof PrebuiltExit) {
      return fail(prebuiltFailed(name, error.message));
    }
    throw error;
  }
}

/** One instance of a prebuilt module, checked to be the build this runtime speaks to. */
export class PrebuiltModule {
  readonly #exports: PrebuiltExports;

  private constructor(exports: PrebuiltExports) {
    this.#exports = exports;
  }

  /** Instantiates `name`'s module from its code, refusing one of another build or encoder. */
  static async instantiate(
    name: PrebuiltEncoderName,
    code: WebAssemblyCode,
  ): Promise<DomainResult<PrebuiltModule>> {
    const imports = {
      env: { emscripten_notify_memory_growth: () => undefined },
      wasi_snapshot_preview1: {
        proc_exit: (status: number) => {
          throw new PrebuiltExit(status);
        },
      },
    };
    let instance: WebAssembly.Instance;
    try {
      instance =
        code instanceof WebAssembly.Module
          ? await WebAssembly.instantiate(code, imports)
          : (await WebAssembly.instantiate(code, imports)).instance;
    } catch (error) {
      // Bytes that are not WebAssembly, or a module whose imports are not these.
      return fail(
        prebuiltRefused(`The ${name} module could not be instantiated.`, {
          reason: error instanceof Error ? error.name : String(error),
        }),
      );
    }
    const read = readExports(instance.exports);
    if (!read.ok) return read;
    const exports = read.value;
    const initialise = instance.exports['_initialize'];
    if (isFunction(initialise)) {
      const started = guarded('_initialize', () => initialise());
      if (!started.ok) return started;
    }
    const version = cString(exports.memory, exports.version());
    const mimeType = cString(exports.memory, exports.mimeType());
    if (version !== PREBUILT_VERSION || mimeType !== MIME_TYPES[name]) {
      return fail(
        prebuiltRefused(
          `The ${name} module is ${version} for ${mimeType}, not ${PREBUILT_VERSION} for ${MIME_TYPES[name]}.`,
          { version, mimeType },
        ),
      );
    }
    return succeed(new PrebuiltModule(exports));
  }

  /**
   * Opens an encoder of `channels` channels at `sampleRate`, with the
   * encoder's own parameters after them, as its C interface lays them out:
   * each a 32-bit word, `float` where `floats` says so.
   */
  open(
    channels: number,
    sampleRate: number,
    parameters: readonly { readonly value: number; readonly float: boolean }[],
  ): DomainResult<PrebuiltEncoder> {
    const exports = this.#exports;
    const words = 2 + parameters.length;
    const opened = guarded('enc_init', () => {
      const address = exports.malloc(words * 4);
      if (address === 0) return 0;
      try {
        const view = new DataView(exports.memory.buffer, address, words * 4);
        view.setUint32(0, channels, true);
        view.setUint32(4, sampleRate, true);
        parameters.forEach((parameter, index) => {
          const at = 8 + index * 4;
          if (parameter.float) view.setFloat32(at, parameter.value, true);
          else view.setInt32(at, parameter.value, true);
        });
        return exports.init(address);
      } finally {
        exports.free(address);
      }
    });
    if (!opened.ok) return opened;
    if (opened.value === 0) return fail(prebuiltFailed('enc_init', 'the settings were refused'));
    return succeed(new PrebuiltEncoder(exports, opened.value, channels));
  }
}

/** One encoder of a prebuilt module: samples in, the bytes of its stream out. */
export class PrebuiltEncoder {
  readonly #exports: PrebuiltExports;
  readonly #channels: number;
  #handle: number;

  constructor(exports: PrebuiltExports, handle: number, channels: number) {
    this.#exports = exports;
    this.#handle = handle;
    this.#channels = channels;
  }

  /** Encodes `frames` frames of `planes`, one per channel, answering a copy of the bytes it made. */
  encode(planes: readonly SamplePlane[], frames: number): DomainResult<Uint8Array> {
    if (frames === 0) return succeed(new Uint8Array());
    const exports = this.#exports;
    const handle = this.#live('enc_encode');
    if (!handle.ok) return handle;
    return this.#answer(
      'enc_encode',
      guarded('enc_encode', () => {
        const pointers = exports.pcm(handle.value, frames) >>> 0;
        if (pointers === 0) return -1;
        const addresses = new Uint32Array(exports.memory.buffer, pointers, this.#channels);
        for (let channel = 0; channel < this.#channels; channel += 1) {
          const into = new Float32Array(exports.memory.buffer, addresses[channel] ?? 0, frames);
          const plane = planes[channel];
          into.set(plane === undefined ? new Float32Array(frames) : plane.subarray(0, frames));
        }
        return exports.encode(handle.value, frames);
      }),
    );
  }

  /** Ends the stream, answering a copy of the last bytes. */
  flush(): DomainResult<Uint8Array> {
    const handle = this.#live('enc_flush');
    if (!handle.ok) return handle;
    return this.#answer(
      'enc_flush',
      guarded('enc_flush', () => this.#exports.flush(handle.value)),
    );
  }

  /** Releases the encoder. A second call does nothing. */
  release(): void {
    if (this.#handle === 0) return;
    const handle = this.#handle;
    this.#handle = 0;
    // A trap while freeing leaves nothing to answer for: the instance is dropped with it.
    guarded('enc_free', () => this.#exports.release(handle));
  }

  #live(call: string): DomainResult<number> {
    return this.#handle === 0
      ? fail(prebuiltFailed(call, 'the encoder was released'))
      : succeed(this.#handle);
  }

  /** The bytes a call answered, copied out of the module's memory before the next call. */
  #answer(call: string, length: DomainResult<number>): DomainResult<Uint8Array> {
    if (!length.ok) {
      this.release();
      return length;
    }
    if (length.value < 0) {
      this.release();
      return fail(prebuiltFailed(call, `it answered status ${String(length.value)}`));
    }
    const address = this.#exports.output(this.#handle) >>> 0;
    return succeed(new Uint8Array(this.#exports.memory.buffer, address, length.value).slice());
  }
}
