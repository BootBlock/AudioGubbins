/**
 * What an AudioWorkletGlobalScope offers the modules the engine and capture
 * processors load into it, beyond the language: exactly the members they use,
 * declared as the scope has them.
 *
 * No library of TypeScript's describes the scope. The DOM's describes a page,
 * so code checked against it may call `setTimeout`, `TextDecoder`,
 * `performance` or `self`, which the scope does not have, and fail only on the
 * audio thread. This project checks the processor against the language and
 * these declarations alone, so a name the scope lacks is a type error. The
 * names only a processor's own module reads, `registerProcessor`,
 * `AudioWorkletProcessor`, `sampleRate` and `currentFrame`, it declares
 * itself, since the package's own project compiles that module too.
 */

/** A message that arrived at a port. */
interface MessageEvent<T = unknown> {
  readonly data: T;
}

/**
 * A port: the one between a processor and its node on the main thread, and
 * a capture channel's, which carries a take's blocks with their buffers
 * transferred.
 */
interface MessagePort {
  postMessage(message: unknown, transfer?: ArrayBuffer[]): void;
  onmessage: ((event: MessageEvent) => void) | null;
  /** Called for a message that arrived and could not be received. */
  onmessageerror: ((event: MessageEvent) => void) | null;
}

/** The WebAssembly JavaScript interface, as the scope's engine offers it. */
declare namespace WebAssembly {
  /** A compiled module: compiled here from bytes, since a posted module can be dropped. */
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class -- the platform's class, whose instances have no members
  class Module {
    constructor(bytes: ArrayBufferView<ArrayBuffer> | ArrayBuffer);
  }

  /** A module instantiated with its imports. */
  class Instance {
    constructor(module: Module, imports?: Record<string, Record<string, unknown>>);
    readonly exports: Record<string, unknown>;
  }

  /** What compiling refuses bytes that are not a valid module with. */
  class CompileError extends Error {}

  /** What instantiating refuses a module whose imports cannot be linked with. */
  class LinkError extends Error {}

  /** What a module traps with, as its start function runs or later. */
  class RuntimeError extends Error {}
}
