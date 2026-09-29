import { describe, expect, it } from 'vitest';

import {
  LogSeverity,
  createDiagnosticCentre,
  createLogStore,
  type Logger,
  type VerbosityConfiguration,
} from '@audiogubbins/diagnostics';

import { CapabilityKey, FeatureStatus, type FeatureRequirement } from './capability.js';
import { createCapabilityRegistry, type CapabilityEnvironment } from './registry.js';
import {
  ACCELERATED_RENDERING,
  ALL_FEATURES,
  MULTI_THREADED_DSP,
  NAMING,
  PROJECT_STORAGE,
} from './features.js';

/**
 * A browser that offers everything, or nothing.
 *
 * Every field is listed, so a capability added to the environment is a type
 * error here until a test states what a browser without it looks like.
 */
function environmentWhere(available: boolean): CapabilityEnvironment {
  return {
    hasOriginPrivateFileSystem: available,
    hasFileSystemAccess: available,
    hasSharedArrayBuffer: available,
    isCrossOriginIsolated: available,
    hasAudioWorklet: available,
    compilesWebAssembly: available,
    choosesAudioOutput: available,
    hasWebWorkers: available,
    hasWebGpu: available,
    hasWebGl2: available,
    hasOffscreenCanvas: available,
    hasWebCodecs: available,
    hasMediaDevices: available,
    hasServiceWorker: available,
    hasStorageEstimate: available,
    hasPersistentStorage: available,
    hasPointerEvents: available,
    reportsPointerPressure: available,
    hasLocalStorage: available,
    hasMediaQueries: available,
    hasKeyboardLayoutMap: available,
    comparesNames: available,
  };
}

/** A browser that offers everything. */
const CAPABLE = environmentWhere(true);

/** A browser that offers nothing. */
const BARE = environmentWhere(false);

/** Admits every record, so a test can assert on what was logged. */
const VERBOSE: VerbosityConfiguration = {
  defaultSeverity: LogSeverity.Trace,
  categoryOverrides: {},
};

function silentLogger(): Logger {
  return createDiagnosticCentre(createLogStore(), { now: () => 0 }).loggerFor('capabilities');
}

function registryFor(environment: CapabilityEnvironment) {
  return createCapabilityRegistry(environment, silentLogger());
}

describe('capability detection', () => {
  it('reports every capability as available on a capable browser', () => {
    const registry = registryFor(CAPABLE);
    expect(registry.missing()).toEqual([]);
    expect(registry.all()).toHaveLength(Object.values(CapabilityKey).length);
  });

  it('reports every capability as missing on a bare browser', () => {
    expect(registryFor(BARE).missing()).toHaveLength(Object.values(CapabilityKey).length);
  });

  it('gives every missing capability a reason a person can read', () => {
    for (const state of registryFor(BARE).missing()) {
      expect(state.reason.length).toBeGreaterThan(20);
      expect(state.reason.endsWith('.')).toBe(true);
    }
  });

  it('reports shared memory as unavailable without cross-origin isolation', () => {
    // The constructor exists but an allocation would fail. Reporting the
    // capability as present here is exactly the surprise REQ-EXEC-216
    // prohibits.
    const registry = registryFor({ ...CAPABLE, isCrossOriginIsolated: false });
    expect(registry.has(CapabilityKey.SharedArrayBuffer)).toBe(false);
    expect(registry.has(CapabilityKey.CrossOriginIsolation)).toBe(false);
  });

  it('explains how to obtain cross-origin isolation', () => {
    const state = registryFor(BARE).state(CapabilityKey.CrossOriginIsolation);
    expect(state.available).toBe(false);
    if (!state.available) expect(state.remedy).toContain('Cross-Origin-Opener-Policy');
  });

  it('gives the same answer every time it is asked', () => {
    // A browser whose answer changes after the first time it is asked. Probed
    // on every question, the capability would vanish during the session.
    let probes = 0;
    const changing: CapabilityEnvironment = {
      ...CAPABLE,
      get hasWebGpu() {
        probes += 1;
        return probes === 1;
      },
    };
    const registry = registryFor(changing);

    expect([registry.has(CapabilityKey.WebGpu), registry.has(CapabilityKey.WebGpu)]).toEqual([
      true,
      true,
    ]);
    expect(probes).toBe(1);
  });

  it('throws rather than reporting an invented capability as available', () => {
    const registry = registryFor(CAPABLE);
    expect(() => registry.state('not-a-capability' as CapabilityKey)).toThrow();
  });

  it('records which capabilities are absent, for a later diagnostic', () => {
    const store = createLogStore();
    const logger = createDiagnosticCentre(store, { now: () => 0 }, VERBOSE).loggerFor(
      'capabilities',
    );
    createCapabilityRegistry(BARE, logger);

    const [record] = store.snapshot();
    expect(record?.message).toBe('Some browser capabilities are unavailable.');
    expect(record?.fields['count']).toBe(Object.values(CapabilityKey).length);
  });

  it('records the absences at Info, not as a warning', () => {
    // A missing capability is ordinary on many devices, not something wrong. A
    // diagnostic bundle carries the whole capability matrix as its own category
    // (REQ-PRIV-161), so nothing is lost by the default verbosity filtering the
    // record out, and a user is not shown a warning about a normal browser.
    const store = createLogStore();
    const logger = createDiagnosticCentre(store, { now: () => 0 }).loggerFor('capabilities');
    createCapabilityRegistry(BARE, logger);

    expect(store.snapshot()).toEqual([]);

    // Filtered out by the default verbosity, which admits a warning, and kept
    // at Info where every record is admitted.
    const verboseStore = createLogStore();
    createCapabilityRegistry(
      BARE,
      createDiagnosticCentre(verboseStore, { now: () => 0 }, VERBOSE).loggerFor('capabilities'),
    );
    expect(verboseStore.snapshot().map((record) => record.severity)).toEqual([LogSeverity.Info]);
  });

  it('logs nothing when nothing is missing', () => {
    const store = createLogStore();
    const logger = createDiagnosticCentre(store, { now: () => 0 }, VERBOSE).loggerFor(
      'capabilities',
    );
    createCapabilityRegistry(CAPABLE, logger);

    expect(store.snapshot()).toEqual([]);
  });
});

describe('feature availability', () => {
  it('reports a feature as running fully when everything is present', () => {
    const availability = registryFor(CAPABLE).featureAvailability(PROJECT_STORAGE);
    expect(availability.status).toBe(FeatureStatus.Full);
    expect(availability.explanation).toBe('');
  });

  it('reports a feature as unavailable when a required capability is missing', () => {
    const registry = registryFor({ ...CAPABLE, hasOriginPrivateFileSystem: false });
    const availability = registry.featureAvailability(PROJECT_STORAGE);

    expect(availability.status).toBe(FeatureStatus.Unavailable);
    expect(availability.missingRequired.map((state) => state.key)).toEqual([
      CapabilityKey.OriginPrivateFileSystem,
    ]);
  });

  it('tells the user what happens instead, not merely that it is unavailable', () => {
    const registry = registryFor({ ...CAPABLE, hasOriginPrivateFileSystem: false });
    expect(registry.featureAvailability(PROJECT_STORAGE).explanation).toContain(
      'Export anything you want to keep',
    );
  });

  it('reports a feature as reduced when only a preferred capability is missing', () => {
    const registry = registryFor({ ...CAPABLE, hasSharedArrayBuffer: false });
    const availability = registry.featureAvailability(MULTI_THREADED_DSP);

    expect(availability.status).toBe(FeatureStatus.Reduced);
    expect(availability.explanation).toContain('take longer');
  });

  it('prefers the unavailable verdict when both kinds are missing', () => {
    const registry = registryFor(BARE);
    expect(registry.featureAvailability(MULTI_THREADED_DSP).status).toBe(FeatureStatus.Unavailable);
  });

  it('treats a feature with no required capabilities as always runnable', () => {
    const registry = registryFor(BARE);
    expect(registry.featureAvailability(ACCELERATED_RENDERING).status).toBe(FeatureStatus.Reduced);
  });

  it('reports a feature that needs nothing at all as running fully', () => {
    const nothingNeeded: FeatureRequirement = {
      featureKey: 'always-works',
      label: 'Always works',
      required: [],
      fallback: 'Never used.',
    };
    expect(registryFor(BARE).featureAvailability(nothingNeeded).status).toBe(FeatureStatus.Full);
  });
});

describe('degradedFeatures', () => {
  it('lists nothing on a browser that offers everything', () => {
    expect(registryFor(CAPABLE).degradedFeatures(ALL_FEATURES)).toEqual([]);
  });

  it('lists every feature that is not running fully', () => {
    const degraded = registryFor(BARE).degradedFeatures(ALL_FEATURES);
    expect(degraded.map((feature) => [feature.featureKey, feature.status])).toEqual([
      ['settings-storage', FeatureStatus.Unavailable],
      ['system-appearance', FeatureStatus.Unavailable],
      ['keyboard-placed-shortcuts', FeatureStatus.Reduced],
      ['naming', FeatureStatus.Unavailable],
      ['project-storage', FeatureStatus.Unavailable],
      ['direct-file-access', FeatureStatus.Unavailable],
      ['audio-playback', FeatureStatus.Unavailable],
      ['output-device-choice', FeatureStatus.Unavailable],
      ['canonical-dsp', FeatureStatus.Reduced],
      ['offline-rendering', FeatureStatus.Unavailable],
      ['multi-threaded-dsp', FeatureStatus.Unavailable],
      ['accelerated-rendering', FeatureStatus.Reduced],
      ['recording', FeatureStatus.Unavailable],
      ['offline-use', FeatureStatus.Unavailable],
      ['pressure-sensitive-tools', FeatureStatus.Unavailable],
      ['hardware-codecs', FeatureStatus.Reduced],
    ]);
  });

  it('names each feature it lists as its declaration names it', () => {
    // Every feature is degraded on a bare browser, in the order declared.
    const degraded = registryFor(BARE).degradedFeatures(ALL_FEATURES);
    expect(degraded.map((feature) => feature.label)).toEqual(
      ALL_FEATURES.map((feature) => feature.label),
    );
  });

  it('lists only the feature actually affected', () => {
    const registry = registryFor({ ...CAPABLE, hasServiceWorker: false });
    const degraded = registry.degradedFeatures(ALL_FEATURES);

    expect(degraded.map((feature) => feature.featureKey)).toEqual(['offline-use']);
  });

  it('explains a degraded feature by what is missing, then what happens instead', () => {
    // Only the missing capabilities that decided the verdict: a feature with a
    // required one missing is not also explained by its preferred ones.
    const [multiThreaded] = registryFor(BARE).degradedFeatures([MULTI_THREADED_DSP]);
    expect(multiThreaded?.explanation).toBe(
      'This browser cannot run background threads. Processing runs on fewer threads, so long files take longer.',
    );

    const [rendering] = registryFor(BARE).degradedFeatures([ACCELERATED_RENDERING]);
    expect(rendering?.explanation).toBe(
      'This browser or this graphics hardware does not offer WebGPU. This browser or this graphics hardware does not offer WebGL 2. This browser cannot draw from a background thread. Drawing falls back to the processor, which is slower on long files.',
    );
  });

  it('counts a browser that cannot compare names among the missing, and says what it cannot name', () => {
    // A check made where the text package loads keeps such a browser at a
    // blank page; it starts, and naming alone is refused, and said here.
    const registry = registryFor({ ...CAPABLE, comparesNames: false });

    expect(registry.missing().map((state) => state.key)).toEqual([CapabilityKey.NameComparison]);
    expect(
      registry.degradedFeatures(ALL_FEATURES).map((feature) => [feature.label, feature.status]),
    ).toEqual([['Naming workspaces and shortcut profiles', FeatureStatus.Unavailable]]);
    expect(registry.featureAvailability(NAMING).explanation).toBe(
      'This browser cannot compare two names the way AudioGubbins does on every machine. Workspaces and shortcut profiles cannot be saved as new ones, copied, renamed or imported, and the built-in shortcuts cannot be changed. Those you have are kept, and you can still switch between them.',
    );
  });
});

describe('the declared feature list', () => {
  it('gives every feature a name a reader is shown', () => {
    const unnamed = ALL_FEATURES.filter((feature) => feature.label.trim() === '');
    expect(unnamed.map((feature) => feature.featureKey)).toEqual([]);
  });

  it('gives every feature a distinct key', () => {
    const keys = ALL_FEATURES.map((feature) => feature.featureKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives every feature a fallback, so none can fail silently', () => {
    for (const feature of ALL_FEATURES) {
      expect(feature.fallback.length).toBeGreaterThan(20);
    }
  });

  it('explains every capability through a feature, so none is counted and left unexplained', () => {
    // The status bar counts every missing capability and opens the
    // Capabilities panel, which lists features. A capability no feature names
    // raised the count and was explained nowhere there: the keyboard layout
    // map on every Firefox and Safari, and cross-origin isolation.
    const named = new Set(
      ALL_FEATURES.flatMap((feature) => [...feature.required, ...(feature.preferred ?? [])]),
    );

    expect(Object.values(CapabilityKey).filter((key) => !named.has(key))).toEqual([]);
  });
});

describe('an answer the browser gives later', () => {
  /** A promise and the function that settles it, so a test decides when. */
  function deferred(): {
    readonly promise: Promise<boolean>;
    readonly settle: (answer: boolean) => void;
    readonly refuse: () => void;
  } {
    let settle: (answer: boolean) => void = () => undefined;
    let refuse: () => void = () => undefined;
    const promise = new Promise<boolean>((resolve, reject) => {
      settle = resolve;
      refuse = () => {
        reject(new Error('The browser refused to say.'));
      };
    });
    return { promise, settle, refuse };
  }

  /** Lets settled promises run their handlers. */
  async function flush(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  it('is counted as neither present nor missing until it arrives', async () => {
    // It is held unavailable so nothing reads it as present before its answer.
    // Counted among the missing as well, the status bar opened saying a
    // capability was unavailable and the number fell as the answer came, and a
    // question that never answers left it standing for the session with
    // nothing anywhere explaining it.
    const answer = deferred();
    const registry = createCapabilityRegistry(CAPABLE, silentLogger(), {
      [CapabilityKey.WebGpu]: answer.promise,
    });

    expect(registry.has(CapabilityKey.WebGpu)).toBe(false);
    expect(registry.missing().map((one) => one.key)).not.toContain(CapabilityKey.WebGpu);

    answer.settle(false);
    await flush();

    expect(registry.missing().map((one) => one.key)).toContain(CapabilityKey.WebGpu);
  });

  it('is reported as being checked, not as present, until it arrives', () => {
    // WebGPU was reported available because its interface existed, which is
    // the assumption REQ-EXEC-216 names: the interface can be there with no
    // adapter behind it.
    const answer = deferred();
    const registry = createCapabilityRegistry(CAPABLE, silentLogger(), {
      [CapabilityKey.WebGpu]: answer.promise,
    });

    expect(registry.has(CapabilityKey.WebGpu)).toBe(false);
    expect(registry.state(CapabilityKey.WebGpu)).toMatchObject({ checking: true });
  });

  it('is counted as neither present nor missing by a feature either, until it arrives', () => {
    // The status bar stopped counting a capability still being asked, and the
    // feature list did not: the Capabilities panel and a diagnostic bundle
    // reported the feature Unavailable with "AudioGubbins is still asking this
    // browser whether it can do this" as its explanation. A panel corrects
    // itself; a bundle exported in the first moments of a session keeps the
    // sentence for good.
    const answer = deferred();
    const registry = createCapabilityRegistry(CAPABLE, silentLogger(), {
      [CapabilityKey.WebGpu]: answer.promise,
    });

    const wanting: FeatureRequirement = {
      featureKey: 'waiting-on-webgpu',
      label: 'Something that wants WebGPU',
      required: [CapabilityKey.WebGpu],
      fallback: 'It does something else.',
    };
    const availability = registry.featureAvailability(wanting);

    expect(availability.missingRequired).toEqual([]);
    expect(availability.status).toBe(FeatureStatus.Full);
  });

  it('becomes present when the browser says yes, and tells whoever is listening', async () => {
    const answer = deferred();
    const registry = createCapabilityRegistry(CAPABLE, silentLogger(), {
      [CapabilityKey.WebGpu]: answer.promise,
    });
    let told = 0;
    registry.subscribe(() => {
      told += 1;
    });

    answer.settle(true);
    await flush();

    expect(registry.has(CapabilityKey.WebGpu)).toBe(true);
    expect(registry.missing()).toEqual([]);
    expect(told).toBe(1);
  });

  it('stops telling a listener that has stopped listening', async () => {
    const answer = deferred();
    const registry = createCapabilityRegistry(CAPABLE, silentLogger(), {
      [CapabilityKey.WebGpu]: answer.promise,
    });
    let stayed = 0;
    let left = 0;
    registry.subscribe(() => {
      stayed += 1;
    });
    const unsubscribe = registry.subscribe(() => {
      left += 1;
    });
    unsubscribe();

    answer.settle(true);
    await flush();

    expect([stayed, left]).toEqual([1, 0]);
  });

  it('becomes absent, with its reason, when the browser says no', async () => {
    const answer = deferred();
    const registry = createCapabilityRegistry(CAPABLE, silentLogger(), {
      [CapabilityKey.WebGpu]: answer.promise,
    });

    answer.settle(false);
    await flush();

    const state = registry.state(CapabilityKey.WebGpu);
    expect(state.available).toBe(false);
    if (!state.available) {
      expect(state.checking).toBeUndefined();
      expect(state.reason).toContain('WebGPU');
    }
  });

  it('becomes absent when the browser refuses to answer at all', async () => {
    const answer = deferred();
    const registry = createCapabilityRegistry(CAPABLE, silentLogger(), {
      [CapabilityKey.WebGpu]: answer.promise,
    });

    answer.refuse();
    await flush();

    expect(registry.state(CapabilityKey.WebGpu)).toMatchObject({ available: false });
    expect(registry.state(CapabilityKey.WebGpu)).not.toHaveProperty('checking');
  });

  it('asks nothing when the interface is not there', () => {
    const answer = deferred();
    const registry = createCapabilityRegistry({ ...CAPABLE, hasWebGpu: false }, silentLogger(), {
      [CapabilityKey.WebGpu]: answer.promise,
    });

    expect(registry.state(CapabilityKey.WebGpu)).not.toHaveProperty('checking');
  });

  it('gives the same list until an answer changes it', async () => {
    const answer = deferred();
    const registry = createCapabilityRegistry(CAPABLE, silentLogger(), {
      [CapabilityKey.WebGpu]: answer.promise,
    });
    const before = registry.all();
    expect(registry.all()).toBe(before);

    answer.settle(true);
    await flush();

    expect(registry.all()).not.toBe(before);
  });
});
