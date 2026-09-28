/**
 * The smallest thing a store needs to notify React.
 *
 * REQ-ARCH-153 prohibits one global store holding project, interface, renderer,
 * audio and job state together, and requires state partitioned by ownership and
 * lifetime. Each partition is therefore its own object with its own typed API.
 * This is what they share: a value, a way to replace it, and a way to be told.
 *
 * It is deliberately not a state-management framework. It has no actions, no
 * middleware, no devtools and no registry of stores, because a framework here
 * is how the partitions quietly grow back into one store. Every partition below
 * is a separate instance with its own domain-specific methods, and none of them
 * can see another.
 *
 * React reads these through `useSyncExternalStore`, so the authoritative value
 * lives outside React and a component re-renders because the value changed
 * rather than because a component decided to hold it.
 */

/** A value that can be observed. */
export interface Observable<T> {
  /** The current value. */
  readonly get: () => T;

  /**
   * Registers a listener, and returns the function that removes it.
   *
   * The remove function is the whole subscription contract: there is no
   * `unsubscribe(listener)` to call with the wrong listener, and nothing for a
   * caller to hold beyond the closure React already keeps.
   */
  readonly subscribe: (listener: () => void) => () => void;
}

/** A value that can be observed and replaced. */
export interface MutableObservable<T> extends Observable<T> {
  /**
   * Replaces the value and notifies every listener.
   *
   * Setting the identical value notifies nobody. React compares by identity, so
   * a store that notified regardless would re-render the tree on every event
   * that produced the same state.
   */
  readonly set: (value: T) => void;

  /** Replaces the value from the current one. */
  readonly update: (change: (current: T) => T) => void;
}

/** Creates an observable value. */
export function observable<T>(initial: T): MutableObservable<T> {
  let current = initial;
  const listeners = new Set<() => void>();

  const set = (value: T): void => {
    if (Object.is(value, current)) return;
    current = value;

    // Iterate a copy: a listener that unsubscribes while being notified would
    // otherwise skip the listener after it in the set.
    for (const listener of [...listeners]) listener();
  };

  return {
    get: () => current,

    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    set,

    update: (change) => {
      set(change(current));
    },
  };
}
