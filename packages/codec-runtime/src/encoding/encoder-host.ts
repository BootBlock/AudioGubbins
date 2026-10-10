/**
 * What an encoder module is given to import (ADR-0091): the WASI functions its
 * C library may call, each refusing, since an encoder reads and writes no file.
 *
 * The modules are built against wasi-libc, whose `exit` and `abort` and whose
 * diagnostics on stderr remain linked. A write, a seek and a close answer
 * `EBADF`, so a diagnostic goes nowhere; `proc_exit` ends the call that made
 * it, as a trap does, with the failure that ends the encoder. A module that
 * imports anything else is refused when it is instantiated, and a test holds
 * each module's imports to this list, so a new one is seen.
 */

/** The WASI module the imports are named under. */
const WASI_MODULE = 'wasi_snapshot_preview1';

/** WASI's `EBADF`: no such file. */
const BAD_DESCRIPTOR = 8;

/** The C library's `exit`, reached by a fatal error or a failed check. */
export class EncoderExit extends Error {
  constructor(status: number) {
    super(`the module exited with status ${String(status)}`);
  }
}

const refused = (): number => BAD_DESCRIPTOR;

/** The functions the host gives, by name. */
const WASI_IMPORTS = {
  fd_close: refused,
  fd_seek: refused,
  fd_write: refused,
  proc_exit: (status: number): never => {
    throw new EncoderExit(status);
  },
} as const;

/** The names of the functions the host gives, which no module may exceed. */
export const ENCODER_MODULE_IMPORTS: readonly string[] = Object.keys(WASI_IMPORTS).map(
  (name) => `${WASI_MODULE}.${name}`,
);

/** The imports an encoder module is instantiated with. */
export function encoderModuleImports(): WebAssembly.Imports {
  return { [WASI_MODULE]: { ...WASI_IMPORTS } };
}
