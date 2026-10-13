/**
 * An encoder module's instance (ADR-0091): LAME's or libvorbis's, built from
 * vendored source into a module of its own file (`native/`,
 * `tools/build-encoder-modules.mjs`), which the codec worker loads only when
 * its format is exported.
 *
 * Each module states the version of its interface, and one that is not the
 * version this runtime speaks, or lacks a function it calls, is refused before
 * it is used. A module's memory may grow on any call, so every view of it is
 * made after the call it follows. A call that traps, or reaches the C
 * library's `exit`, ends the encoder; anything else it throws is a fault in
 * this runtime, raised as itself.
 */

import { fail, succeed, type DomainResult } from '@audiogubbins/domain';

import { thrownName, thrownSaid } from '../thrown-name.js';
import type { EncoderModuleName } from '../worker/codec-worker-messages.js';
import { EncoderExit, encoderModuleImports } from './encoder-host.js';
import { encoderModuleFailed, encoderModuleRefused } from './encoding-failures.js';

/** A call into a module, with the arguments its C interface takes. */
export type ModuleCall = (...args: readonly number[]) => number;

/** Each module's prefix of its exports and the version of its interface this runtime speaks. */
const INTERFACES: Readonly<
  Record<EncoderModuleName, { readonly prefix: string; readonly version: number }>
> = {
  mp3: { prefix: 'ag_mp3_', version: 1 },
  vorbis: { prefix: 'ag_vorbis_', version: 1 },
};

/** A module instantiated and checked: its memory, and each function asked for, by its name without the prefix. */
export interface EncoderInstance<F extends string> {
  readonly memory: WebAssembly.Memory;
  readonly call: (name: F) => ModuleCall;
}

const isFunction = (value: unknown): value is (...args: readonly number[]) => unknown =>
  typeof value === 'function';

/**
 * Runs `call`, answering what it answered or, where it trapped or exited, the
 * failure that ends the encoder.
 */
export function guarded<T>(name: string, call: () => T): DomainResult<T> {
  try {
    return succeed(call());
  } catch (error) {
    if (error instanceof WebAssembly.RuntimeError || error instanceof EncoderExit) {
      return fail(encoderModuleFailed(name, error.message));
    }
    throw error;
  }
}

/** A C string at `address`, read as ASCII to its terminating zero. */
export function cString(memory: WebAssembly.Memory, address: number): string {
  const bytes = new Uint8Array(memory.buffer, address >>> 0);
  const end = bytes.indexOf(0);
  return String.fromCharCode(...bytes.subarray(0, end === -1 ? 0 : end));
}

/**
 * Instantiates `name`'s module from its code, answering the functions asked
 * for, or why the module is not one this runtime calls: bytes that are not
 * WebAssembly, imports the host does not give, a function missing, or an
 * interface of another version.
 */
export async function instantiateEncoderModule<const F extends string>(
  name: EncoderModuleName,
  code: WebAssembly.Module | BufferSource,
  functions: readonly F[],
): Promise<DomainResult<EncoderInstance<F>>> {
  const imports = encoderModuleImports();
  let instance: WebAssembly.Instance;
  try {
    instance =
      code instanceof WebAssembly.Module
        ? await WebAssembly.instantiate(code, imports)
        : (await WebAssembly.instantiate(code, imports)).instance;
  } catch (error) {
    // Bytes that are not WebAssembly, or a module whose imports are not the
    // host's; the browser's message says which.
    return fail(
      encoderModuleRefused(
        `The ${name} encoder module could not be instantiated: ${thrownSaid(error)}`,
        { reason: thrownName(error) },
      ),
    );
  }
  const { prefix, version } = INTERFACES[name];
  const { exports } = instance;
  const memory = exports['memory'];
  const missing: string[] = memory instanceof WebAssembly.Memory ? [] : ['memory'];
  // A function missing is named, and the module refused below, before anything calls it.
  const found = (export_: string): ModuleCall => {
    const value = exports[export_];
    if (isFunction(value)) return (...args) => Number(value(...args));
    missing.push(export_);
    return () => Number.NaN;
  };
  const abiVersion = found(`${prefix}abi_version`);
  const calls = new Map(functions.map((one) => [one, found(`${prefix}${one}`)] as const));
  const initialise = found('_initialize');
  if (!(memory instanceof WebAssembly.Memory) || missing.length > 0) {
    return fail(
      encoderModuleRefused(
        `The ${name} encoder module lacks exports this runtime calls: ${missing.join(', ')}.`,
      ),
    );
  }
  const started = guarded('_initialize', () => initialise());
  if (!started.ok) return started;
  const stated = abiVersion();
  if (stated !== version) {
    return fail(
      encoderModuleRefused(
        `The ${name} encoder module's interface is version ${String(stated)}, not ${String(version)}.`,
        { version: String(stated) },
      ),
    );
  }
  return succeed({ memory, call: (one) => calls.get(one) ?? (() => Number.NaN) });
}
