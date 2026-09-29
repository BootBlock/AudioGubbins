/**
 * Telling a browser's refusal from a fault.
 *
 * The audio APIs refuse with a `DOMException` whose `name` says why, and a
 * caller catches the one refusal it expects so that a `TypeError` or any other
 * fault still surfaces as one. The class is read by its tag rather than with
 * `instanceof`, since a `DOMException` from another realm, such as the one a
 * test environment stands in with, is not an instance of this realm's class.
 */

/** A `DOMException`'s name, for the refusals the runtime expects. */
export type DomExceptionName = 'AbortError' | 'InvalidStateError';

/** Whether `error` is a `DOMException`, from any realm, named `name`. */
export function isDomException(error: unknown, name: DomExceptionName): error is DOMException {
  return (
    typeof error === 'object' &&
    error !== null &&
    Object.prototype.toString.call(error) === '[object DOMException]' &&
    'name' in error &&
    error.name === name
  );
}
