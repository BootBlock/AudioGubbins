/**
 * A message as it arrives in another thread, for the tests that play a
 * worker in their own thread: a structured clone, its buffers transferred,
 * and each end of a message channel among its fields carried as itself, as a
 * transferred port is, where a clone would copy it into a lifeless object.
 */

import { isMessagePortLike } from '../preview/preview-port.js';

/** `message` as it arrives in another thread, with `transfer` transferred. */
export function crossingThreads(message: unknown, transfer: readonly unknown[]): unknown {
  const buffers = transfer.filter((one): one is ArrayBuffer => one instanceof ArrayBuffer);
  if (typeof message !== 'object' || message === null) {
    return structuredClone(message, { transfer: buffers });
  }
  const fields = Object.entries(message);
  const ends = fields.filter(([, value]) => isMessagePortLike(value));
  const rest = fields.filter(([, value]) => !isMessagePortLike(value));
  return {
    ...structuredClone(Object.fromEntries(rest), { transfer: buffers }),
    ...Object.fromEntries(ends),
  };
}
