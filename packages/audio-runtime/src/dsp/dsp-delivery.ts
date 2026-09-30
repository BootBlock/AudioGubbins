/**
 * The canonical DSP module as a thread is given it, or why it is given none.
 *
 * One shape from the page to every thread: the host options, each message that
 * carries the module and each scope's choice of DSP read it, so no thread can
 * be sent both a module and a reason, or neither and left to guess why. The
 * module travels in whichever form the receiving scope accepts, which is the
 * type parameter: the page holds its bytes and the module it compiled from
 * them, a dedicated worker is posted the compiled module, and the AudioWorklet
 * is sent the bytes, since Chromium silently drops a message to a worklet that
 * carries a compiled module and delivers one that carries bytes.
 */

/** Whether a thread is given the DSP module. */
export const DspDeliveryKind = {
  Available: 'available',
  Unavailable: 'unavailable',
} as const;

export type DspDeliveryKind = (typeof DspDeliveryKind)[keyof typeof DspDeliveryKind];

/**
 * The DSP module in the form `TModule`, or why there is none, which the
 * receiving scope reports as the reason it runs the reference path.
 */
export type DspDelivery<TModule> =
  | { readonly kind: typeof DspDeliveryKind.Available; readonly module: TModule }
  | { readonly kind: typeof DspDeliveryKind.Unavailable; readonly reason: string };

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

/** The same delivery with its module in the form `form` takes from it; a reason passes unchanged. */
export function deliveredAs<TFrom, TTo>(
  delivery: DspDelivery<TFrom>,
  form: (module: TFrom) => TTo,
): DspDelivery<TTo> {
  return delivery.kind === DspDeliveryKind.Available
    ? { kind: delivery.kind, module: form(delivery.module) }
    : delivery;
}
