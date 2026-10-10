/**
 * The canonical DSP module as a thread is given it, or why it is given none,
 * and the DSP a thread runs from it.
 *
 * One shape from the page to every thread: the host options, each message that
 * carries the module and each scope's choice of DSP read it, so no thread can
 * be sent both a module and a reason, or neither and left to guess why. The
 * module travels in whichever form the receiving scope accepts, which is the
 * type parameter: the page holds its bytes and the module it compiled from
 * them, a dedicated worker is posted the compiled module, and the AudioWorklet
 * is sent the bytes, since Chromium silently drops a message to a worklet that
 * carries a compiled module and delivers one that carries bytes.
 *
 * It lives with the engine, which runs in every scope, so a worker outside the
 * audio runtime, the spectrogram's (ADR-0080), takes the delivery a render
 * worker takes and chooses its DSP by the same rule. ADR-0031 makes the
 * reference path the documented fallback and ADR-0032 makes it give the same
 * bits, so a scope that cannot run the module still runs, and says why.
 */

import { fieldsOf, oneOf, textAt, type MessageFields } from '@audiogubbins/domain';

import type { CanonicalDsp } from './canonical-dsp.js';
import { REFERENCE_DSP } from './reference/reference-dsp.js';
import { wasmDsp } from './wasm/wasm-dsp.js';

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

/** The same delivery with its module in the form `form` takes from it; a reason passes unchanged. */
export function deliveredAs<TFrom, TTo>(
  delivery: DspDelivery<TFrom>,
  form: (module: TFrom) => TTo,
): DspDelivery<TTo> {
  return delivery.kind === DspDeliveryKind.Available
    ? { kind: delivery.kind, module: form(delivery.module) }
    : delivery;
}

/**
 * The DSP module as a thread is given it, its module read by `readModule`, or
 * the reason there is none. Its own fields are read under their full names,
 * `dsp.module` and the like, so a refusal says which `kind` was wrong.
 */
export function dspDeliveryAt<TModule>(
  fields: MessageFields,
  field: string,
  readModule: (delivery: MessageFields, field: string) => TModule,
): DspDelivery<TModule> {
  const delivery = fieldsOf(fields[field], field);
  const [kindField, moduleField, reasonField] = [
    `${field}.kind`,
    `${field}.module`,
    `${field}.reason`,
  ];
  const named: MessageFields = {
    [kindField]: delivery['kind'],
    [moduleField]: delivery['module'],
    [reasonField]: delivery['reason'],
  };
  const kind = oneOf(named, kindField, DspDeliveryKind);
  return kind === DspDeliveryKind.Available
    ? { kind, module: readModule(named, moduleField) }
    : { kind, reason: textAt(named, reasonField) };
}

/** The DSP a scope runs, and why it is the reference path when it is. */
export interface ScopeDsp {
  readonly dsp: CanonicalDsp;
  readonly fallbackReason: string | undefined;
}

/**
 * The names of the errors by which instantiating refuses a module in this
 * scope: one whose imports it cannot link (`LinkError`), whose start traps
 * (`RuntimeError`), or whose memory cannot be reserved (`RangeError`). Each
 * leaves the reference path to run. The first two are WebAssembly's own
 * classes, which a package compiled without a host's definitions knows by
 * name; anything else, such as a `TypeError` from a malformed import object,
 * is a fault.
 */
const REFUSALS: ReadonlySet<string> = new Set(['LinkError', 'RuntimeError', 'RangeError']);

function isRefusal(error: unknown): error is Error {
  return error instanceof Error && REFUSALS.has(error.name);
}

/**
 * The canonical DSP from a delivered module, or the reference path with the
 * reason: the main thread's, where it had no module to send, or what went
 * wrong instantiating or checking the one it sent. `instantiate` makes an
 * instance of the module in the scope's own way and answers its exports.
 */
export function deliveredDsp<TModule>(
  delivery: DspDelivery<TModule>,
  instantiate: (module: TModule) => unknown,
): ScopeDsp {
  if (delivery.kind === DspDeliveryKind.Unavailable) {
    return { dsp: REFERENCE_DSP, fallbackReason: delivery.reason };
  }
  let exports: unknown;
  try {
    exports = instantiate(delivery.module);
  } catch (error) {
    if (!isRefusal(error)) throw error;
    return {
      dsp: REFERENCE_DSP,
      fallbackReason: `The DSP module could not start: ${error.message}`,
    };
  }
  const checked = wasmDsp(exports);
  return checked.ok
    ? { dsp: checked.value, fallbackReason: undefined }
    : { dsp: REFERENCE_DSP, fallbackReason: checked.failures[0].summary };
}
