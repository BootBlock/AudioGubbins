/**
 * The page's compiled DSP module, in both the forms its threads accept.
 *
 * The delivery's shape, `DspDelivery`, is the engine's, so a worker outside
 * this package takes the same one (ADR-0080); this is the form the page holds
 * the module in before it chooses one for each thread.
 */

/** The page's module in both the forms its threads accept. */
export interface CompiledDspModule {
  /**
   * What the module was compiled from, for the AudioWorklet. Kept by the page
   * and copied into each message, never transferred, since every load sends
   * them again.
   */
  readonly bytes: Uint8Array<ArrayBuffer>;
  /** For a dedicated worker, which accepts a compiled module and so need not compile again. */
  readonly module: WebAssembly.Module;
}
