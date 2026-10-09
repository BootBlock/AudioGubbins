/**
 * Reading what the browser may refuse to hand over, for the adapters that read
 * from a navigator, a document or a global object given as an argument.
 *
 * A sandboxed frame or a hardened browser can throw a `SecurityError` from a
 * read rather than answer `undefined`, and an object the type definitions
 * describe can lack the member a probe needs, so neither is trusted.
 */

/**
 * Reads a value the browser may refuse to hand over: refused is the same as
 * not offered. Anything other than a `DOMException` is a fault, and is not
 * taken for a refusal.
 */
export function offered<T>(read: () => T | undefined): T | undefined {
  try {
    return read();
  } catch (error) {
    if (error instanceof DOMException) return undefined;
    throw error;
  }
}

/** A function on a host, bound to it, where the host has one by that name. */
export function method(
  host: unknown,
  name: string,
): ((...args: readonly unknown[]) => unknown) | undefined {
  if ((typeof host !== 'object' && typeof host !== 'function') || host === null) return undefined;
  const found: unknown = Reflect.get(host, name);
  if (typeof found !== 'function') return undefined;
  return (...args) => {
    const answer: unknown = Reflect.apply(found, host, args);
    return answer;
  };
}
