/**
 * Browser globals jsdom does not implement.
 *
 * jsdom provides neither `matchMedia` nor `ResizeObserver`. Code that reaches
 * for either would fail with a type error at run time instead of exercising the
 * fallback it was written to have, so the test would report a crash where the
 * real browser reports a working feature.
 *
 * Every query reports itself as not matching. That is the honest default: a
 * test that depends on `prefers-reduced-motion` or `prefers-contrast` must say
 * so, rather than inheriting whatever the machine running the suite prefers.
 */

if (!('matchMedia' in window)) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }) satisfies MediaQueryList,
  });
}

if (!('ResizeObserver' in window)) {
  Object.defineProperty(window, 'ResizeObserver', {
    writable: true,
    value: class {
      // jsdom never resizes anything, so an observer here has nothing to
      // report. The methods exist so that code which observes an element runs
      // its real path instead of failing on a missing global.
      observe(): void {
        return undefined;
      }
      unobserve(): void {
        return undefined;
      }
      disconnect(): void {
        return undefined;
      }
    },
  });
}

if (typeof Element.prototype.scrollIntoView !== 'function') {
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    writable: true,
    // jsdom lays nothing out and scrolls nothing, so there is nothing to bring
    // into view. It exists so that a control which opens a list and scrolls the
    // chosen item to it runs its real path instead of throwing.
    value: () => undefined,
  });
}
