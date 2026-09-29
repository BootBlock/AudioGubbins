/**
 * Detecting capabilities once, and answering questions about them.
 *
 * Detection happens through an injected {@link CapabilityEnvironment} rather
 * than by reading globals directly. That is what makes every branch testable:
 * a test can present a browser with no SharedArrayBuffer and assert that
 * multi-threaded DSP reports itself reduced, which is impossible if the code
 * reads `globalThis` and the test runner's environment decides the answer.
 *
 * Detection is also done once and kept. Probing on every question would make a
 * capability appear to change during a session, and code that asked twice could
 * take two different branches for one user action.
 */

import type { Logger } from '@audiogubbins/diagnostics';

import {
  CapabilityKey,
  FeatureStatus,
  absent,
  present,
  type CapabilityAbsent,
  type CapabilityState,
  type FeatureAvailability,
  type FeatureRequirement,
} from './capability.js';

/**
 * What detection reads.
 *
 * Every field answers one question about the host. Keeping them as plain values
 * rather than as the globals themselves means a test states the browser it is
 * describing instead of building one.
 */
export interface CapabilityEnvironment {
  readonly hasOriginPrivateFileSystem: boolean;
  readonly hasFileSystemAccess: boolean;
  readonly hasSharedArrayBuffer: boolean;
  readonly isCrossOriginIsolated: boolean;
  readonly hasAudioWorklet: boolean;
  readonly compilesWebAssembly: boolean;
  readonly choosesAudioOutput: boolean;
  readonly hasWebWorkers: boolean;

  /**
   * Whether the WebGPU interface is there at all.
   *
   * Only the precondition: whether it has an adapter is asked asynchronously,
   * and given to the registry as a late answer.
   */
  readonly hasWebGpu: boolean;
  readonly hasWebGl2: boolean;
  readonly hasOffscreenCanvas: boolean;
  readonly hasWebCodecs: boolean;
  readonly hasMediaDevices: boolean;
  readonly hasServiceWorker: boolean;
  readonly hasStorageEstimate: boolean;
  readonly hasPersistentStorage: boolean;
  readonly hasPointerEvents: boolean;
  readonly reportsPointerPressure: boolean;
  readonly hasLocalStorage: boolean;
  readonly hasMediaQueries: boolean;
  readonly hasKeyboardLayoutMap: boolean;
  readonly comparesNames: boolean;
}

/** The remedy for a capability every supported browser has in its current version. */
const USE_A_CURRENT_BROWSER = 'Use a current version of Chrome, Edge, Firefox or Safari.';

/**
 * Why each capability is missing, and what if anything the user can do.
 *
 * Written once, here, so that the same explanation reaches the capability
 * surface, a degraded-feature notice and a diagnostic bundle. REQ-EXEC-136.11
 * requires a rule like this to have one home; three near-identical wordings in
 * three places is how they drift apart.
 */
const ABSENCE: Record<CapabilityKey, { readonly reason: string; readonly remedy?: string }> = {
  [CapabilityKey.OriginPrivateFileSystem]: {
    reason: 'This browser does not offer private storage for AudioGubbins projects.',
    remedy: USE_A_CURRENT_BROWSER,
  },
  [CapabilityKey.FileSystemAccess]: {
    reason: 'This browser cannot open and save files directly on your disk.',
    remedy: 'You can still import and export through the download folder.',
  },
  [CapabilityKey.SharedArrayBuffer]: {
    reason: 'Memory cannot be shared between threads on this page.',
    remedy:
      'This needs the page to be served with cross-origin isolation headers, which only whoever serves it can send. The version published on GitHub Pages cannot send them; a copy you serve yourself can.',
  },
  [CapabilityKey.CrossOriginIsolation]: {
    reason: 'This page is not cross-origin isolated.',
    // Addressed to the person reading it rather than to an operator. Saying
    // "the site must send" two headers would read as something the user can do,
    // and the GitHub Pages deployment this project ships from cannot send them
    // at all.
    remedy:
      'Only whoever serves the page can turn this on, by sending the Cross-Origin-Opener-Policy and Cross-Origin-Embedder-Policy headers. The version published on GitHub Pages cannot send them; a copy you serve yourself can.',
  },
  [CapabilityKey.AudioWorklet]: {
    reason: 'This browser cannot run audio processing on the audio thread.',
    remedy: USE_A_CURRENT_BROWSER,
  },
  [CapabilityKey.WebAssembly]: {
    reason: 'This page cannot compile WebAssembly.',
    remedy:
      'A security setting or an extension that blocks WebAssembly usually causes this. Processing gives the same result without it, more slowly.',
  },
  [CapabilityKey.AudioOutputSelection]: {
    reason: 'This browser plays audio only to the device your system chooses.',
    remedy: "Change the output device in your system's sound settings.",
  },
  [CapabilityKey.WebWorkers]: {
    reason: 'This browser cannot run background threads.',
  },
  [CapabilityKey.WebGpu]: {
    reason: 'This browser or this graphics hardware does not offer WebGPU.',
  },
  [CapabilityKey.WebGl2]: {
    reason: 'This browser or this graphics hardware does not offer WebGL 2.',
  },
  [CapabilityKey.OffscreenCanvas]: {
    reason: 'This browser cannot draw from a background thread.',
  },
  [CapabilityKey.WebCodecs]: {
    reason: 'This browser does not offer hardware media decoding.',
  },
  [CapabilityKey.MediaDevices]: {
    reason: 'This browser cannot reach a microphone or an audio interface.',
    remedy: 'Recording needs the page to be served over a secure connection.',
  },
  [CapabilityKey.ServiceWorker]: {
    reason: 'This browser cannot run AudioGubbins offline.',
    remedy: 'Private browsing usually switches this off.',
  },
  [CapabilityKey.StorageEstimate]: {
    reason: 'This browser does not say how much storage is available.',
  },
  [CapabilityKey.PersistentStorage]: {
    reason: 'This browser will not promise to keep AudioGubbins projects.',
    remedy: 'Export anything you want to keep.',
  },
  [CapabilityKey.PointerEvents]: {
    reason: 'This browser does not report pointer events.',
  },
  [CapabilityKey.PointerPressure]: {
    reason: 'This device does not report pen pressure.',
    remedy: 'Pressure-sensitive tools use a fixed strength instead.',
  },
  [CapabilityKey.LocalStorage]: {
    reason: 'This browser will not keep anything AudioGubbins stores between visits.',
    remedy: 'Private browsing and blocked site data usually cause this.',
  },
  [CapabilityKey.MediaQueries]: {
    reason: "This browser does not report your system's appearance settings.",
    remedy: 'Choose the theme, motion and contrast yourself in the settings.',
  },
  [CapabilityKey.KeyboardLayoutMap]: {
    reason: 'This browser does not tell AudioGubbins what your keyboard types on each key.',
    remedy: 'AudioGubbins learns your keyboard from the keys you press.',
  },
  [CapabilityKey.NameComparison]: {
    reason: 'This browser cannot compare two names the way AudioGubbins does on every machine.',
    remedy: USE_A_CURRENT_BROWSER,
  },
};

/** Maps each capability to the environment field that decides it. */
const PROBES: Record<CapabilityKey, (environment: CapabilityEnvironment) => boolean> = {
  [CapabilityKey.OriginPrivateFileSystem]: (e) => e.hasOriginPrivateFileSystem,
  [CapabilityKey.FileSystemAccess]: (e) => e.hasFileSystemAccess,
  // Shared memory needs both the constructor and the isolation that makes it
  // usable. Probed for the constructor alone, a page with it but no isolation
  // would report the capability as present and then fail at the first
  // allocation, which is the kind of surprise REQ-EXEC-216 exists to prevent.
  [CapabilityKey.SharedArrayBuffer]: (e) => e.hasSharedArrayBuffer && e.isCrossOriginIsolated,
  [CapabilityKey.CrossOriginIsolation]: (e) => e.isCrossOriginIsolated,
  [CapabilityKey.AudioWorklet]: (e) => e.hasAudioWorklet,
  [CapabilityKey.WebAssembly]: (e) => e.compilesWebAssembly,
  [CapabilityKey.AudioOutputSelection]: (e) => e.choosesAudioOutput,
  [CapabilityKey.WebWorkers]: (e) => e.hasWebWorkers,
  [CapabilityKey.WebGpu]: (e) => e.hasWebGpu,
  [CapabilityKey.WebGl2]: (e) => e.hasWebGl2,
  [CapabilityKey.OffscreenCanvas]: (e) => e.hasOffscreenCanvas,
  [CapabilityKey.WebCodecs]: (e) => e.hasWebCodecs,
  [CapabilityKey.MediaDevices]: (e) => e.hasMediaDevices,
  [CapabilityKey.ServiceWorker]: (e) => e.hasServiceWorker,
  [CapabilityKey.StorageEstimate]: (e) => e.hasStorageEstimate,
  [CapabilityKey.PersistentStorage]: (e) => e.hasPersistentStorage,
  [CapabilityKey.PointerEvents]: (e) => e.hasPointerEvents,
  [CapabilityKey.PointerPressure]: (e) => e.reportsPointerPressure,
  [CapabilityKey.LocalStorage]: (e) => e.hasLocalStorage,
  [CapabilityKey.MediaQueries]: (e) => e.hasMediaQueries,
  [CapabilityKey.KeyboardLayoutMap]: (e) => e.hasKeyboardLayoutMap,
  [CapabilityKey.NameComparison]: (e) => e.comparesNames,
};

/**
 * Answers the browser gives later, by capability.
 *
 * A capability whose question can only be asked asynchronously is given here
 * as a promise of its answer. Its synchronous probe in the environment is a
 * precondition: when that says the API is absent, there is nothing to ask.
 */
export type LateAnswers = Readonly<Partial<Record<CapabilityKey, Promise<boolean>>>>;

/** What a capability is reported as while its answer has not arrived. */
const CHECKING_REASON = 'AudioGubbins is still asking this browser whether it can do this.';

/** Answers what this device can do. */
export interface CapabilityRegistry {
  /** The state of one capability. */
  readonly state: (key: CapabilityKey) => CapabilityState;

  /** Whether a capability is available. */
  readonly has: (key: CapabilityKey) => boolean;

  /**
   * Every capability, in a stable order.
   *
   * The same array until an answer arrives, so a reader can compare it by
   * identity, as `useSyncExternalStore` does.
   */
  readonly all: () => readonly CapabilityState[];

  /**
   * Every capability that has answered and is not there.
   *
   * One still being asked is not among them. It is held as unavailable so that
   * nothing reads it as present before its answer, and its cause is withheld
   * while it is being asked, since a question in flight is no cause of
   * anything. Were it counted as missing as well, the status bar would open
   * saying two capabilities were unavailable and the number would fall as each
   * answered, and a question that never answers would leave it standing for the
   * session with nothing anywhere explaining it.
   */
  readonly missing: () => readonly CapabilityAbsent[];

  /**
   * Registers a listener for an answer that arrives later, and returns the
   * function that removes it.
   */
  readonly subscribe: (listener: () => void) => () => void;

  /** How a feature is running here. */
  readonly featureAvailability: (requirement: FeatureRequirement) => FeatureAvailability;

  /**
   * Every feature that is not running fully.
   *
   * What the capability surface lists, and what a diagnostic bundle carries. It
   * deliberately omits features that are running fully: a list of what is wrong
   * is read, and a list of everything is not.
   */
  readonly degradedFeatures: (
    requirements: readonly FeatureRequirement[],
  ) => readonly FeatureAvailability[];
}

/** What a capability is when it is not available, with its stated reason. */
function unavailable(key: CapabilityKey): CapabilityAbsent {
  const absence = ABSENCE[key];
  return absent(key, absence.reason, absence.remedy);
}

/**
 * What a feature can do, given what each capability's state is.
 *
 * A pure answer from the states alone, apart from the registry that keeps them:
 * a feature is unavailable when a capability it requires is missing, reduced
 * when one it prefers is, and full otherwise. Each explanation is the missing
 * capabilities' reasons followed by what the feature does instead.
 */
function featureAvailability(
  requirement: FeatureRequirement,
  stateOf: (key: CapabilityKey) => CapabilityState,
): FeatureAvailability {
  // A capability still being asked is neither present nor missing, which is the
  // rule `missing()` keeps for the status bar. Were it counted as absent here,
  // a feature would be reported Unavailable or Reduced while the answer was in
  // flight, with "AudioGubbins is still asking this browser whether it can do
  // this" as its explanation — in the Capabilities panel, which corrects
  // itself, and in a diagnostic bundle, which does not.
  const absent = (keys: readonly CapabilityKey[]): readonly CapabilityAbsent[] =>
    keys
      .map(stateOf)
      .filter((state): state is CapabilityAbsent => !state.available && state.checking !== true);

  const missingRequired = absent(requirement.required);
  const missingPreferred = absent(requirement.preferred ?? []);

  const common = {
    featureKey: requirement.featureKey,
    label: requirement.label,
    missingRequired,
    missingPreferred,
  };

  if (missingRequired.length > 0) {
    return {
      ...common,
      status: FeatureStatus.Unavailable,
      explanation: `${missingRequired.map((state) => state.reason).join(' ')} ${requirement.fallback}`,
    };
  }

  if (missingPreferred.length > 0) {
    return {
      ...common,
      status: FeatureStatus.Reduced,
      explanation: `${missingPreferred.map((state) => state.reason).join(' ')} ${requirement.fallback}`,
    };
  }

  return { ...common, status: FeatureStatus.Full, explanation: '' };
}

/**
 * Detects every capability once and answers from the result.
 *
 * A capability given a late answer is reported as being checked until the
 * answer arrives, and then once, for good; subscribers are told when it does.
 * The logger records what is missing at Info, so a user reporting a problem has
 * the reason in their diagnostic bundle without having to reproduce it.
 */
export function createCapabilityRegistry(
  environment: CapabilityEnvironment,
  logger: Logger,
  late: LateAnswers = {},
): CapabilityRegistry {
  const states = new Map<CapabilityKey, CapabilityState>();
  const listeners = new Set<() => void>();

  let all: readonly CapabilityState[] = [];
  let missing: readonly CapabilityAbsent[] = [];
  const recompute = (): void => {
    all = Object.freeze([...states.values()]);
    missing = Object.freeze(
      all.filter((state): state is CapabilityAbsent => !state.available && state.checking !== true),
    );
  };

  /** Records an answer that arrived later, and tells whoever is listening. */
  const answered = (key: CapabilityKey, available: boolean): void => {
    states.set(key, available ? present(key) : unavailable(key));
    recompute();
    if (!available) {
      logger.info('A browser capability turned out to be unavailable.', { capability: key });
    }
    for (const listener of [...listeners]) listener();
  };

  for (const key of Object.values(CapabilityKey)) {
    const precondition = PROBES[key](environment);
    const answer = late[key];

    if (precondition && answer !== undefined) {
      states.set(key, { key, available: false, reason: CHECKING_REASON, checking: true });
      answer.then(
        (available) => {
          answered(key, available);
        },
        // A question the browser refused to answer is one whose answer is no.
        // The absence is recorded with its reason, like any other.
        () => {
          answered(key, false);
        },
      );
    } else {
      states.set(key, precondition ? present(key) : unavailable(key));
    }
  }
  recompute();

  if (missing.length > 0) {
    logger.info('Some browser capabilities are unavailable.', {
      missing: missing.map((state) => state.key).join(', '),
      count: missing.length,
    });
  }

  const stateOf = (key: CapabilityKey): CapabilityState => {
    const state = states.get(key);
    if (state === undefined) {
      // Every key of the enumeration was probed above, so reaching this means a
      // caller invented a key. Failing loudly beats reporting it as available.
      throw new Error(`"${key}" is not a capability AudioGubbins detects.`);
    }
    return state;
  };

  const availabilityOf = (requirement: FeatureRequirement): FeatureAvailability =>
    featureAvailability(requirement, stateOf);

  return {
    state: stateOf,
    has: (key) => stateOf(key).available,
    all: () => all,
    missing: () => missing,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    featureAvailability: availabilityOf,

    degradedFeatures: (requirements) =>
      requirements
        .map(availabilityOf)
        .filter((availability) => availability.status !== FeatureStatus.Full),
  };
}
