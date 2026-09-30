/**
 * Reading the real browser.
 *
 * The only module in AudioGubbins that probes globals. Everything else asks the
 * capability registry or is handed what this reads, which keeps platform
 * detection in one place rather than scattered as
 * `typeof window.showOpenFilePicker === 'function'` through the features that
 * happen to need it (REQ-EXEC-136.4).
 *
 * Every probe is a feature test rather than a browser-name test. A user-agent
 * string says who the browser claims to be; a feature test says what it does.
 * The one exception is the operating system, which no feature test can answer.
 */

import type { EnvironmentSummary } from '@audiogubbins/diagnostics';
import { namesCanBeCompared } from '@audiogubbins/text';

import { CapabilityKey } from './capability.js';
import { layoutMapRequest, type LayoutMapPairs } from './keyboard-layout-map.js';
import { operatingSystemOf, type PlatformSignals } from './platform.js';
import type { CapabilityEnvironment, LateAnswers } from './registry.js';

/** Whether a named property exists on an object, without reading its value. */
function exists(host: object | undefined, name: string): boolean {
  return host !== undefined && name in host;
}

/**
 * Asks a question of the browser that may throw instead of answering.
 *
 * A hardened or privacy-focused browser may make reading a property raise
 * rather than return `undefined`, and a capability probe that crashes the
 * application is worse than a missing capability. A probe that cannot answer
 * means the capability is not usable, which is the same conclusion as it being
 * absent; there is nothing to report here, because the registry logs the
 * absence with its reason.
 */
function safely(probe: () => unknown): boolean {
  try {
    // Only a literal `true` counts. The type definitions promise a boolean from
    // properties a real browser can leave undefined, and a probe that returned
    // one would store `undefined` in a field declared boolean.
    return probe() === true;
  } catch {
    return false;
  }
}

/**
 * The smallest module WebAssembly accepts: its magic number and version 1.
 *
 * Compiled, rather than `WebAssembly` looked for, because a security policy
 * without `'wasm-unsafe-eval'` leaves the global in place and refuses every
 * compilation, which is what the canonical DSP needs.
 */
const EMPTY_MODULE = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

/** The media queries the operating system's appearance settings answer. */
const APPEARANCE_QUERIES = {
  prefersDark: '(prefers-color-scheme: dark)',
  prefersReducedMotion: '(prefers-reduced-motion: reduce)',
  prefersMoreContrast: '(prefers-contrast: more)',
} as const;

/** Whether the browser can answer a media query. */
function canAskMediaQueries(): boolean {
  return safely(() => typeof window.matchMedia === 'function');
}

/**
 * Whether the browser will keep a value between visits.
 *
 * Asked by storing one, because nothing else tells: private browsing, a
 * blocked-cookies setting and a full quota all leave `localStorage` present and
 * make writing to it throw. A user in that browser keeps their settings until
 * the tab closes, and is told so rather than finding out on the next visit.
 */
function canKeepLocalValues(): boolean {
  return safely(() => {
    const key = 'audiogubbins.capability-probe';
    window.localStorage.setItem(key, key);
    window.localStorage.removeItem(key);
    return true;
  });
}

/** Probes the current browser. */
export function detectBrowserEnvironment(): CapabilityEnvironment {
  return {
    hasOriginPrivateFileSystem: safely(() => typeof navigator.storage.getDirectory === 'function'),
    hasFileSystemAccess: safely(() => exists(window, 'showOpenFilePicker')),
    hasSharedArrayBuffer: safely(() => typeof SharedArrayBuffer === 'function'),
    isCrossOriginIsolated: safely(() => window.crossOriginIsolated),
    hasAudioWorklet: safely(
      () => exists(window, 'AudioWorkletNode') && exists(window, 'AudioContext'),
    ),
    compilesWebAssembly: safely(
      () => new WebAssembly.Module(EMPTY_MODULE) instanceof WebAssembly.Module,
    ),
    choosesAudioOutput: safely(
      () => exists(window, 'AudioContext') && 'setSinkId' in AudioContext.prototype,
    ),
    hasWebWorkers: safely(() => typeof Worker === 'function'),
    hasWebGpu: safely(() => exists(navigator, 'gpu')),
    hasWebGl2: safely(() => {
      // Asking is the only honest way to know: the class exists in browsers
      // that then refuse to give a context, on a blocked driver or an exhausted
      // context budget.
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('webgl2');

      // The context is released rather than dropped. An abandoned one would
      // stay alive until it is collected, holding a share of the small number a
      // browser allows, and Firefox would report an InvalidStateError from it
      // when the page unloads or reloads.
      context?.getExtension('WEBGL_lose_context')?.loseContext();

      return context !== null;
    }),
    hasOffscreenCanvas: safely(() => exists(window, 'OffscreenCanvas')),
    hasWebCodecs: safely(() => exists(window, 'AudioDecoder')),
    hasMediaDevices: safely(() => typeof navigator.mediaDevices.getUserMedia === 'function'),
    // The container itself, in a secure context, rather than the name. A
    // private window can keep the property and answer `undefined` from it, and
    // a page served insecurely can never register a worker at all.
    hasServiceWorker: safely(() => {
      const container: unknown = Reflect.get(navigator, 'serviceWorker');
      return window.isSecureContext && typeof container === 'object' && container !== null;
    }),
    hasStorageEstimate: safely(() => typeof navigator.storage.estimate === 'function'),
    hasPersistentStorage: safely(() => typeof navigator.storage.persist === 'function'),
    hasPointerEvents: safely(() => exists(window, 'PointerEvent')),

    // Whether a pen genuinely varies its pressure is only knowable from a real
    // pointer event, so this reports whether the browser exposes the field at
    // all. A device that always reports the same value is handled where
    // pressure is used: REQ-UX-068 makes pressure optional in every case, so no
    // editing capability depends on the answer here.
    reportsPointerPressure: safely(
      () => exists(window, 'PointerEvent') && 'pressure' in PointerEvent.prototype,
    ),

    hasLocalStorage: canKeepLocalValues(),
    hasMediaQueries: canAskMediaQueries(),

    // Only the precondition: whether the map names any key is answered by the
    // map itself, late (see `askLateQuestions`).
    hasKeyboardLayoutMap: safely(() => layoutMapRequest(navigator) !== undefined),

    // The rule's own check rather than a second statement of it, so the
    // capability and every comparison of two names cannot disagree.
    comparesNames: safely(namesCanBeCompared),

    hasVideoFrameCallback: safely(
      () =>
        exists(window, 'HTMLVideoElement') &&
        'requestVideoFrameCallback' in HTMLVideoElement.prototype,
    ),
    // Whether the document allows it, not only whether the method is there:
    // Safari on an iPhone has the method on no element but a video, and a
    // frame without the permission refuses every request.
    hasFullscreen: safely(() => document.fullscreenEnabled),
  };
}

/**
 * The questions that can only be answered asynchronously.
 *
 * Whether WebGPU is usable is whether the browser will give an adapter: the
 * interface can be present on a machine whose graphics hardware or driver the
 * browser refuses, which is exactly the assumption REQ-EXEC-216 names. The
 * interface's presence is the synchronous precondition; this asks the real
 * question.
 *
 * The layout map is given rather than asked for: the application reads it once
 * and hands the same answer to the keyboard layout (`readLayoutMap`). It is
 * there where it names a key, and not where the browser refused it or gave an
 * empty one.
 */
export function askLateQuestions(layoutMap: Promise<LayoutMapPairs>): LateAnswers {
  const layoutMapAnswer = {
    [CapabilityKey.KeyboardLayoutMap]: layoutMap.then((pairs) => pairs.length > 0),
  };

  const gpu: unknown = Reflect.get(navigator, 'gpu');
  if (typeof gpu !== 'object' || gpu === null) return layoutMapAnswer;

  const requestAdapter: unknown = Reflect.get(gpu, 'requestAdapter');
  if (typeof requestAdapter !== 'function') return layoutMapAnswer;

  return {
    ...layoutMapAnswer,
    [CapabilityKey.WebGpu]: Promise.resolve()
      .then((): unknown => Reflect.apply(requestAdapter, gpu, []))
      .then((adapter) => typeof adapter === 'object' && adapter !== null),
  };
}

/** What the operating system's appearance settings ask for. */
export interface AppearanceSettings {
  /** Whether the system asks for a dark interface. */
  readonly prefersDark: boolean;

  /** Whether the system asks for less movement. */
  readonly prefersReducedMotion: boolean;

  /** Whether the system asks for more contrast. */
  readonly prefersMoreContrast: boolean;
}

/**
 * The appearance settings, read now and followed from here on.
 *
 * Shaped for `useSyncExternalStore`: `read` returns the same object until a
 * setting changes, and `subscribe` returns the function that stops listening.
 */
export interface AppearanceSettingsWatch {
  readonly read: () => AppearanceSettings;
  readonly subscribe: (listener: () => void) => () => void;
}

/**
 * Nothing asked for: dark not requested, full motion, standard contrast.
 *
 * What a browser that cannot answer media queries is taken to say. It is not a
 * guess at the user's settings: every one of them can be chosen explicitly in
 * AudioGubbins, and the capability surface says that System follows nothing
 * here.
 */
const NOTHING_ASKED: AppearanceSettings = {
  prefersDark: false,
  prefersReducedMotion: false,
  prefersMoreContrast: false,
};

/**
 * Follows the operating system's appearance settings.
 *
 * Every query is read again when any one of them changes, rather than the event
 * being trusted for its own query alone: the settings can move together, and
 * reading them all is how the answer stays one consistent value.
 */
export function watchAppearanceSettings(): AppearanceSettingsWatch {
  if (!canAskMediaQueries()) {
    return { read: () => NOTHING_ASKED, subscribe: () => () => undefined };
  }

  const lists = Object.values(APPEARANCE_QUERIES).map((query) => window.matchMedia(query));
  const ask = (): AppearanceSettings => ({
    prefersDark: window.matchMedia(APPEARANCE_QUERIES.prefersDark).matches,
    prefersReducedMotion: window.matchMedia(APPEARANCE_QUERIES.prefersReducedMotion).matches,
    prefersMoreContrast: window.matchMedia(APPEARANCE_QUERIES.prefersMoreContrast).matches,
  });

  let current = ask();

  /**
   * Reads the settings again, keeping the same object when nothing moved.
   *
   * A reader compares answers by identity, so a fresh object with the same
   * values would count as a change: with two readers subscribed, each would be
   * told the other's re-read was new.
   */
  const refresh = (): boolean => {
    const latest = ask();
    if (
      latest.prefersDark === current.prefersDark &&
      latest.prefersReducedMotion === current.prefersReducedMotion &&
      latest.prefersMoreContrast === current.prefersMoreContrast
    ) {
      return false;
    }
    current = latest;
    return true;
  };

  const listeners = new Set<() => void>();
  const changed = (): void => {
    if (!refresh()) return;
    // A copy, so a listener that unsubscribes while being told does not make
    // the next one be skipped.
    for (const listener of [...listeners]) listener();
  };

  return {
    read: () => current,

    subscribe: (listener) => {
      if (listeners.size === 0) {
        for (const list of lists) list.addEventListener('change', changed);
      }
      listeners.add(listener);

      // A setting can change between the first read and the subscription being
      // in place, so the answer is read once more now that no change can be
      // missed.
      changed();

      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          for (const list of lists) list.removeEventListener('change', changed);
        }
      };
    },
  };
}

/**
 * Follows one media query, telling the caller each time it starts or stops
 * matching.
 *
 * For a rule the stylesheet applies and the application has to answer as well.
 * The shell stops drawing a docking workspace below a declared width, which
 * takes every panel out of the box tree: the browser drops focus to the
 * document body, so something has to move it and say what happened. The query
 * is written once by the caller and read here, because a browser global asked
 * outside this package is a question no capability answers for.
 *
 * Answers a function that stops following. A browser that answers no media
 * query never calls back, which is the same as a width that never changes: the
 * workspace is drawn, and nothing has to be said about it.
 */
export function watchMediaQuery(query: string, changed: (matches: boolean) => void): () => void {
  if (!canAskMediaQueries()) return () => undefined;

  const list = window.matchMedia(query);
  const answer = (): void => {
    changed(list.matches);
  };

  list.addEventListener('change', answer);
  return () => {
    list.removeEventListener('change', answer);
  };
}

/** What the browser says about where it is running. */
export function readPlatformSignals(): PlatformSignals {
  const hint = ((): string | undefined => {
    try {
      // Client hints are Chromium's, and absent from the DOM type definitions
      // because they are not yet a standard every engine implements.
      const data: unknown = Reflect.get(navigator, 'userAgentData');
      const platform: unknown =
        typeof data === 'object' && data !== null ? Reflect.get(data, 'platform') : undefined;
      return typeof platform === 'string' && platform !== '' ? platform : undefined;
    } catch {
      // A browser that refuses the question has given no hint, which is what
      // the user-agent tests are for.
      return undefined;
    }
  })();

  return {
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
    ...(hint === undefined ? {} : { platformHint: hint }),
  };
}

/**
 * Describes the browser and operating system for a diagnostic bundle.
 *
 * REQ-PRIV-161 permits browser and operating-system information and prohibits
 * anything identifying. This reports a family and a major version, never the
 * full user-agent string, which carries build numbers and device models that
 * together identify a machine.
 */
export function describeEnvironment(signals: PlatformSignals): EnvironmentSummary {
  const agent = signals.userAgent;

  const browser = ((): string => {
    // Order matters: every Chromium browser also claims to be Chrome, and
    // Chrome also claims to be Safari, so the most specific claim wins.
    for (const [name, pattern] of [
      ['Edge', /Edg\/(\d+)/],
      ['Opera', /OPR\/(\d+)/],
      ['Firefox', /Firefox\/(\d+)/],
      ['Chrome', /Chrome\/(\d+)/],
      ['Safari', /Version\/(\d+).*Safari/],
    ] as const) {
      const match = pattern.exec(agent);
      if (match?.[1] !== undefined) return `${name} ${match[1]}`;
    }
    return 'Unknown browser';
  })();

  const installed = canAskMediaQueries()
    ? safely(() => window.matchMedia('(display-mode: standalone)').matches)
    : false;

  return { browser, operatingSystem: operatingSystemOf(signals), installed };
}
