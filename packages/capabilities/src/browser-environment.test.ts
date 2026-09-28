import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  askLateQuestions,
  describeEnvironment,
  detectBrowserEnvironment,
  watchAppearanceSettings,
  watchMediaQuery,
} from './browser-environment.js';
import { CapabilityKey } from './capability.js';
import { OperatingSystem, operatingSystemOf, usesAppleModifiers } from './platform.js';

/**
 * What the browser currently answers, and who is listening.
 *
 * The answers are mutable because the watcher re-reads every query when any one
 * of them changes, rather than trusting the event: the browser's own settings
 * can move together, and reading them all is how the answer stays one value.
 */
let answers: Record<string, boolean> = {};
let listeners: { query: string; notify: () => void }[] = [];

const originalMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia');

afterEach(() => {
  if (originalMatchMedia !== undefined) {
    Object.defineProperty(window, 'matchMedia', originalMatchMedia);
  }
  answers = {};
  listeners = [];
  vi.restoreAllMocks();
});

/** Makes the browser answer each query the way the test says. */
function answering(initial: Readonly<Record<string, boolean>>): void {
  answers = { ...initial };

  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      get matches() {
        return answers[query] ?? false;
      },
      media: query,
      onchange: null,
      addEventListener: (_: string, notify: () => void) => listeners.push({ query, notify }),
      removeEventListener: (_: string, notify: () => void) => {
        listeners = listeners.filter((one) => one.notify !== notify);
      },
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

/** Tells every subscriber to a query that its answer changed. */
function systemChanges(query: string, matches: boolean): void {
  answers[query] = matches;
  for (const listener of listeners.filter((one) => one.query === query)) listener.notify();
}

describe('reading the system appearance', () => {
  /*
   * Each query is answered on its own, so an inverted or swapped query fails:
   * the three fields cannot all be false. Without these, the dark query could
   * be inverted with the whole suite green.
   */

  it('reads the dark preference from the colour-scheme query alone', () => {
    answering({ '(prefers-color-scheme: dark)': true });

    expect(watchAppearanceSettings().read()).toEqual({
      prefersDark: true,
      prefersReducedMotion: false,
      prefersMoreContrast: false,
    });
  });

  it('reads the reduced-motion preference from the reduced-motion query alone', () => {
    answering({ '(prefers-reduced-motion: reduce)': true });

    expect(watchAppearanceSettings().read()).toEqual({
      prefersDark: false,
      prefersReducedMotion: true,
      prefersMoreContrast: false,
    });
  });

  it('reads the contrast preference from the contrast query alone', () => {
    answering({ '(prefers-contrast: more)': true });

    expect(watchAppearanceSettings().read()).toEqual({
      prefersDark: false,
      prefersReducedMotion: false,
      prefersMoreContrast: true,
    });
  });

  it('answers that nothing is asked for when the browser cannot be asked', () => {
    // REQ-EXEC-216 prohibits assuming a browser API is present. The capability
    // surface reports the absence, and every setting can be chosen explicitly.
    Object.defineProperty(window, 'matchMedia', { writable: true, value: undefined });

    expect(watchAppearanceSettings().read()).toEqual({
      prefersDark: false,
      prefersReducedMotion: false,
      prefersMoreContrast: false,
    });
  });

  it('tells every subscriber when a setting changes, and gives the new answer', () => {
    answering({ '(prefers-color-scheme: dark)': false });
    const watch = watchAppearanceSettings();
    const first = vi.fn();
    const second = vi.fn();
    watch.subscribe(first);
    watch.subscribe(second);

    systemChanges('(prefers-color-scheme: dark)', true);

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(watch.read().prefersDark).toBe(true);
  });

  it('gives the same answer object until a setting changes', () => {
    // A reader compares answers by identity, so a fresh object with the same
    // values would be taken for a change on every read.
    answering({ '(prefers-contrast: more)': true });
    const watch = watchAppearanceSettings();

    expect(watch.read()).toBe(watch.read());
  });

  it('stops listening to the browser once the last subscriber has gone', () => {
    answering({});
    const watch = watchAppearanceSettings();
    const stopFirst = watch.subscribe(() => undefined);
    const stopSecond = watch.subscribe(() => undefined);
    const listening = listeners.length;
    expect(listening).toBeGreaterThan(0);

    stopFirst();
    expect(listeners).toHaveLength(listening);

    stopSecond();
    expect(listeners).toEqual([]);
  });
});

describe('watchMediaQuery', () => {
  it('tells its reader each time the query starts and stops matching', () => {
    const listeners = new Set<() => void>();
    let matches = false;
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: () => ({
        get matches() {
          return matches;
        },
        addEventListener: (_: string, listener: () => void) => listeners.add(listener),
        removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
      }),
    });

    const seen: boolean[] = [];
    const stop = watchMediaQuery('(width < 640px)', (matched) => seen.push(matched));

    // Nothing is said until it changes: a page that announced its own width as
    // it opened would say it over whatever the reader came for.
    expect(seen).toEqual([]);

    matches = true;
    for (const listener of listeners) listener();
    matches = false;
    for (const listener of listeners) listener();

    expect(seen).toEqual([true, false]);

    stop();
    expect(listeners.size).toBe(0);
  });

  it('says nothing at all where the browser answers no media query', () => {
    Object.defineProperty(window, 'matchMedia', { writable: true, value: undefined });

    const seen: boolean[] = [];
    const stop = watchMediaQuery('(width < 640px)', (matched) => seen.push(matched));

    expect(seen).toEqual([]);
    expect(() => {
      stop();
    }).not.toThrow();
  });
});

describe('probing local storage', () => {
  it('finds storage that keeps a value', () => {
    expect(detectBrowserEnvironment().hasLocalStorage).toBe(true);
  });

  it('reports storage that refuses a write as absent', () => {
    // Private browsing and a full quota both leave `localStorage` present and
    // make a write throw, which is why the probe writes rather than looks.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    });

    expect(detectBrowserEnvironment().hasLocalStorage).toBe(false);
  });

  it('leaves nothing behind in storage', () => {
    const before = window.localStorage.length;
    detectBrowserEnvironment();
    expect(window.localStorage.length).toBe(before);
  });
});

describe('probing media queries', () => {
  it('reports a browser that cannot answer media queries', () => {
    Object.defineProperty(window, 'matchMedia', { writable: true, value: undefined });
    expect(detectBrowserEnvironment().hasMediaQueries).toBe(false);
  });
});

describe('probing the keyboard layout map', () => {
  /** Puts a keyboard on the navigator for one test, and takes it off after. */
  function withKeyboard(keyboard: unknown): void {
    Object.defineProperty(navigator, 'keyboard', { configurable: true, value: keyboard });
  }

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'keyboard');
  });

  it('reports a browser that says what each key types', () => {
    withKeyboard({ getLayoutMap: () => Promise.resolve(new Map()) });
    expect(detectBrowserEnvironment().hasKeyboardLayoutMap).toBe(true);
  });

  it('reports a browser with no layout map, where the layout is learned from typing', () => {
    expect(detectBrowserEnvironment().hasKeyboardLayoutMap).toBe(false);

    withKeyboard({});
    expect(detectBrowserEnvironment().hasKeyboardLayoutMap).toBe(false);
  });
});

/** User-agent strings of the kinds the parser has to tell apart. */
const AGENTS = {
  windowsChrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15',
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1',
  android:
    'Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  chromebook:
    'Mozilla/5.0 (X11; CrOS x86_64 16181.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  linuxFirefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:142.0) Gecko/20100101 Firefox/142.0',
  windowsEdge:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
  androidWebView:
    'Mozilla/5.0 (Linux; Android 16; Pixel 9; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36',
  windowsOpera:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36 OPR/124.0.0.0',
} as const;

describe('probing how names are compared', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('reports names compared where the runtime gives English collation', () => {
    expect(detectBrowserEnvironment().comparesNames).toBe(true);
  });

  it('reports names not compared where the runtime resolves another collation, as the rule does', async () => {
    const RealCollator = Intl.Collator;
    vi.spyOn(Intl, 'Collator').mockImplementation(
      class extends RealCollator {
        constructor(_locales?: Intl.LocalesArgument, options?: Intl.CollatorOptions) {
          super('tr', options);
        }
      },
    );
    vi.resetModules();

    const [probe, text] = await Promise.all([
      import('./browser-environment.js'),
      import('@audiogubbins/text'),
    ]);
    expect(probe.detectBrowserEnvironment().comparesNames).toBe(false);
    expect(text.namesCanBeCompared()).toBe(false);
  });
});

describe('naming the operating system', () => {
  it.each([
    [AGENTS.windowsChrome, 0, OperatingSystem.Windows],
    [AGENTS.macSafari, 0, OperatingSystem.MacOs],
    [AGENTS.iphone, 5, OperatingSystem.Ios],
    [AGENTS.ipad, 5, OperatingSystem.IpadOs],
    [AGENTS.android, 5, OperatingSystem.Android],
    [AGENTS.linuxFirefox, 0, OperatingSystem.Linux],
  ])('names %s', (userAgent, maxTouchPoints, expected) => {
    expect(operatingSystemOf({ userAgent, maxTouchPoints })).toBe(expected);
  });

  it('names a Chromebook, which also claims to be Linux', () => {
    expect(operatingSystemOf({ userAgent: AGENTS.chromebook, maxTouchPoints: 0 })).toBe(
      OperatingSystem.ChromeOs,
    );
  });

  it('names an iPad asking for desktop sites, which claims to be a Mac', () => {
    // Its user-agent string is a Mac's. A Mac has no touch screen.
    expect(operatingSystemOf({ userAgent: AGENTS.macSafari, maxTouchPoints: 5 })).toBe(
      OperatingSystem.IpadOs,
    );
  });

  it('believes the client hint over the user-agent string', () => {
    expect(
      operatingSystemOf({
        userAgent: AGENTS.windowsChrome,
        platformHint: 'Chrome OS',
        maxTouchPoints: 0,
      }),
    ).toBe(OperatingSystem.ChromeOs);
  });

  it('falls back to the user-agent string when the hint is one it does not know', () => {
    expect(
      operatingSystemOf({ userAgent: AGENTS.android, platformHint: 'Fuchsia', maxTouchPoints: 5 }),
    ).toBe(OperatingSystem.Android);
  });

  it('writes shortcuts the Apple way on every Apple system, and nowhere else', () => {
    const apple = Object.values(OperatingSystem).filter(usesAppleModifiers);
    expect(apple.sort()).toEqual(
      [OperatingSystem.IpadOs, OperatingSystem.Ios, OperatingSystem.MacOs].sort(),
    );
  });
});

describe('describing the environment for a diagnostic bundle', () => {
  it('names the operating system with the same parser as everything else', () => {
    // There were two parsers, and they disagreed by construction on Android.
    expect(
      describeEnvironment({ userAgent: AGENTS.android, maxTouchPoints: 5 }).operatingSystem,
    ).toBe(OperatingSystem.Android);
    expect(
      describeEnvironment({ userAgent: AGENTS.chromebook, maxTouchPoints: 0 }).operatingSystem,
    ).toBe(OperatingSystem.ChromeOs);
  });

  it.each([
    ['Edge, which also claims Chrome and Safari', AGENTS.windowsEdge, 'Edge 140'],
    ['Opera, which also claims Chrome and Safari', AGENTS.windowsOpera, 'Opera 124'],
    ['Chrome', AGENTS.windowsChrome, 'Chrome 140'],
    [
      'an Android web view, which claims a Safari version as well as Chrome',
      AGENTS.androidWebView,
      'Chrome 140',
    ],
    ['Safari', AGENTS.macSafari, 'Safari 19'],
  ])('names %s by the most specific browser it claims', (_name, userAgent, browser) => {
    expect(describeEnvironment({ userAgent, maxTouchPoints: 0 }).browser).toBe(browser);
  });

  it('names the browser family and major version and nothing more', () => {
    expect(describeEnvironment({ userAgent: AGENTS.linuxFirefox, maxTouchPoints: 0 })).toEqual({
      browser: 'Firefox 142',
      operatingSystem: OperatingSystem.Linux,
      installed: false,
    });
  });
});

describe('asking whether WebGPU can be used', () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'gpu');
  });

  /** Gives the browser a WebGPU interface whose adapter request answers as given. */
  function offering(adapter: object | null): void {
    Object.defineProperty(navigator, 'gpu', {
      configurable: true,
      value: { requestAdapter: () => Promise.resolve(adapter) },
    });
  }

  it('says yes when the browser gives an adapter', async () => {
    offering({ name: 'adapter' });
    expect(await askLateQuestions(Promise.resolve([]))[CapabilityKey.WebGpu]).toBe(true);
  });

  it('says no when the interface is there and the browser gives no adapter', async () => {
    // The case the old probe got wrong: the interface existing was taken for
    // WebGPU being usable.
    offering(null);
    expect(await askLateQuestions(Promise.resolve([]))[CapabilityKey.WebGpu]).toBe(false);
  });

  it('asks nothing about WebGPU when there is no interface', () => {
    expect(askLateQuestions(Promise.resolve([]))[CapabilityKey.WebGpu]).toBeUndefined();
  });

  it('answers the layout map by whether the map names any key', async () => {
    // Answered by whether the request existed, a browser that refused the map,
    // or gave an empty one, was reported as giving one, and the wait it caused
    // was explained without its cause.
    expect(await askLateQuestions(Promise.resolve([]))[CapabilityKey.KeyboardLayoutMap]).toBe(
      false,
    );
    expect(
      await askLateQuestions(Promise.resolve([['KeyK', 't'] as const]))[
        CapabilityKey.KeyboardLayoutMap
      ],
    ).toBe(true);
  });
});

describe('the smaller probes', () => {
  it('answers a boolean for isolation even where the browser has no such property', () => {
    // A browser without `crossOriginIsolated` answered `undefined`, which was
    // stored in a field declared boolean.
    const original = Object.getOwnPropertyDescriptor(window, 'crossOriginIsolated');
    Object.defineProperty(window, 'crossOriginIsolated', { configurable: true, value: undefined });
    try {
      expect(detectBrowserEnvironment().isCrossOriginIsolated).toBe(false);
    } finally {
      if (original === undefined) Reflect.deleteProperty(window, 'crossOriginIsolated');
      else Object.defineProperty(window, 'crossOriginIsolated', original);
    }
  });

  it('reports no service worker when the container is missing though the name is not', () => {
    // A private window can keep `serviceWorker` on the navigator and answer
    // `undefined` from it; testing for the name reported a worker it could
    // never register.
    const original = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: undefined });
    try {
      expect('serviceWorker' in navigator).toBe(true);
      expect(detectBrowserEnvironment().hasServiceWorker).toBe(false);
    } finally {
      if (original === undefined) Reflect.deleteProperty(navigator, 'serviceWorker');
      else Object.defineProperty(navigator, 'serviceWorker', original);
    }
  });
});
