/**
 * What an AudioWorkletGlobalScope offers the modules the engine processor
 * loads into it, beyond the language: exactly the members they use, declared
 * as the scope has them.
 *
 * No library of TypeScript's describes the scope. The DOM's describes a page,
 * so code checked against it may call `setTimeout`, `TextDecoder`,
 * `performance` or `self`, which the scope does not have, and fail only on the
 * audio thread. This project checks the processor against the language and
 * these declarations alone, so a name the scope lacks is a type error. The
 * names only the processor's own module reads, `registerProcessor`,
 * `AudioWorkletProcessor`, `sampleRate` and `currentFrame`, it declares
 * itself, since the package's own project compiles that module too.
 */

/** A message that arrived at a port. */
interface MessageEvent<T = unknown> {
  readonly data: T;
}

/** The port between a processor and its node on the main thread. */
interface MessagePort {
  postMessage(message: unknown): void;
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
}
