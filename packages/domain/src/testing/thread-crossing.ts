/**
 * A message as it arrives in another thread, for the tests that play a
 * worker, a channel or an audio thread in their own: a structured clone, its
 * buffers transferred, and each end of a channel the message holds as a field
 * moved as itself, where a clone would copy it into a lifeless object.
 *
 * An end moves only when it is listed in `transfer`, as the platform moves a
 * port only when it is transferred, so a test that forgets the transfer fails
 * here as the real thread would. The protocols name an end only as a member
 * of the message itself.
 */

/** `message` as it arrives in another thread, with `transfer` transferred. */
export function crossingThreads(message: unknown, transfer: readonly unknown[]): unknown {
  const buffers = transfer.filter((one): one is ArrayBuffer => one instanceof ArrayBuffer);
  if (typeof message !== 'object' || message === null) {
    return structuredClone(message, { transfer: buffers });
  }
  const ends = new Set(transfer.filter((one) => !(one instanceof ArrayBuffer)));
  const fields = Object.entries(message);
  const moved = fields.filter(([, value]) => ends.has(value));
  const rest = fields.filter(([, value]) => !ends.has(value));
  return {
    ...structuredClone(Object.fromEntries(rest), { transfer: buffers }),
    ...Object.fromEntries(moved),
  };
}
