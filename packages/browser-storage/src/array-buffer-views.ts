/**
 * Handing bytes to an API that takes only memory of its own: a buffer to
 * transfer, or a view that is not over shared memory.
 *
 * The ports hand bytes over as `Uint8Array`, which may be a window on a larger
 * buffer or on shared memory. A transfer gives up the whole buffer, and a
 * `Blob` or a file stream refuses shared memory, so each is given exactly the
 * bytes it is owed, copied only where the view is not already that (G5).
 */

/**
 * Whether a value is an ordinary buffer, not shared memory, from any realm.
 *
 * Asked of its tag rather than by `instanceof`, which answers for one realm's
 * constructor alone: a buffer made by another, such as one a message carried in
 * from a different context, is a buffer all the same.
 */
export function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return Object.prototype.toString.call(value) === '[object ArrayBuffer]';
}

/** Whether a view's memory is an ordinary buffer rather than shared memory. */
function isUnshared(bytes: Uint8Array): bytes is Uint8Array<ArrayBuffer> {
  return isArrayBuffer(bytes.buffer);
}

/** The view itself where its memory is an ordinary buffer, a copy otherwise. */
export function unshared(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return isUnshared(bytes) ? bytes : bytes.slice();
}

/**
 * A buffer holding exactly the bytes of a view no one else holds, to be given
 * up to another thread: its own where it spans the whole of it, and a copy of
 * its span otherwise, since a transfer gives up the whole buffer.
 */
export function wholeBuffer(bytes: Uint8Array<ArrayBuffer>): ArrayBuffer {
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes.buffer
    : bytes.slice().buffer;
}
