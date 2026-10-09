/**
 * A page a test hides and shows, and gives the focus back to, as the person
 * leaves a tab and comes back to it: the visibility the project system watches,
 * telling each listener of the event it listens for.
 */

import type { PageVisibility } from '../state/layout-map-watch.js';

type PageEvent = Parameters<PageVisibility['listen']>[0];

/** A page a test drives (see the module comment). */
export class ScriptedPage implements PageVisibility {
  #visible = true;
  readonly #listeners = new Map<PageEvent, Set<() => void>>();

  readonly isVisible = (): boolean => this.#visible;

  readonly listen = (event: PageEvent, handler: () => void): (() => void) => {
    const listeners = this.#listeners.get(event) ?? new Set();
    this.#listeners.set(event, listeners);
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
    };
  };

  /** The person leaves the tab. */
  hide(): void {
    this.#visible = false;
    this.#tell('visibilitychange');
  }

  /** The person comes back to the tab, which is shown and then given the focus. */
  show(): void {
    this.#visible = true;
    this.#tell('visibilitychange');
    this.#tell('focus');
  }

  #tell(event: PageEvent): void {
    for (const listener of [...(this.#listeners.get(event) ?? [])]) listener();
  }
}
