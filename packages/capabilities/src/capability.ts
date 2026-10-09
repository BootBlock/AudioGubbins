/**
 * What this browser can do, and what AudioGubbins does when it cannot.
 *
 * REQ-EXEC-216 names the assumptions an agent must never make silently: that a
 * browser API is available, that SharedArrayBuffer or WebGPU exists, that
 * storage quota is sufficient, that touch input implies no keyboard. Each of
 * those needs explicit fallback or error behaviour rather than a feature that
 * quietly does nothing.
 *
 * A capability is therefore not a boolean. It carries why it is unavailable and
 * what that costs the user, because "Spectral repair is unavailable" sends a
 * person looking for a setting, while "Spectral repair needs cross-origin
 * isolation, which this page is not served with" tells them what to do.
 */

/** Something the browser either offers or does not. */
export const CapabilityKey = {
  /** Origin private file system, where projects are stored. */
  OriginPrivateFileSystem: 'origin-private-file-system',

  /** Reading and writing files the user chose from their own disk. */
  FileSystemAccess: 'file-system-access',

  /** Memory shared between threads, which multi-threaded DSP needs. */
  SharedArrayBuffer: 'shared-array-buffer',

  /** Whether the page is cross-origin isolated, which the above requires. */
  CrossOriginIsolation: 'cross-origin-isolation',

  /** Audio processing on the audio thread. */
  AudioWorklet: 'audio-worklet',

  /**
   * Compiling WebAssembly, which the canonical DSP runs as (ADR-0031).
   *
   * Asked by compiling a module, not by looking for the global: a page whose
   * security policy forbids compilation has the global and cannot use it.
   */
  WebAssembly: 'webassembly',

  /**
   * Fixed-width WebAssembly SIMD, which every build of the inference runtime
   * needs and a pinned final render is defined on (ADR-0062).
   *
   * Asked by validating a module that uses a 128-bit vector instruction, which
   * says whether the engine knows the instructions and compiles nothing; that
   * compilation is allowed at all is the WebAssembly capability above.
   */
  WebAssemblySimd: 'webassembly-simd',

  /** Choosing which audio device playback goes to, rather than the system's. */
  AudioOutputSelection: 'audio-output-selection',

  /** Background threads for analysis, decoding and rendering. */
  WebWorkers: 'web-workers',

  /** GPU rendering for the waveform and spectrogram. */
  WebGpu: 'webgpu',

  /** The rendering fallback where WebGPU is absent. */
  WebGl2: 'webgl2',

  /** Drawing on a canvas from a worker, keeping the UI thread free. */
  OffscreenCanvas: 'offscreen-canvas',

  /** Hardware media decoding and encoding. */
  WebCodecs: 'web-codecs',

  /** Capturing audio from a microphone or an interface. */
  MediaDevices: 'media-devices',

  /** Offline running and installation. */
  ServiceWorker: 'service-worker',

  /** An estimate of how much storage is available. */
  StorageEstimate: 'storage-estimate',

  /** Asking the browser not to evict the user's projects. */
  PersistentStorage: 'persistent-storage',

  /** Pointer events, which unify mouse, touch and pen. */
  PointerEvents: 'pointer-events',

  /** Pen pressure, used by spectral painting where the hardware reports it. */
  PointerPressure: 'pointer-pressure',

  /** Keeping settings, workspaces and shortcut profiles between visits. */
  LocalStorage: 'local-storage',

  /** Reading the operating system's appearance settings, which System follows. */
  MediaQueries: 'media-queries',

  /**
   * Being told what the user's keyboard layout types on each key.
   *
   * Chromium answers; Firefox and Safari do not, and there the layout is
   * learned from the keys the user presses. Probed and reported like any other,
   * so the degradation it causes, a default shortcut with no key until its
   * character is typed, is explained by its cause rather than only described
   * (REQ-EXEC-216).
   */
  KeyboardLayoutMap: 'keyboard-layout-map',

  /**
   * Comparing two names by the one rule AudioGubbins holds them to on every
   * machine: English collation, punctuation and digits as they are written.
   *
   * Asked of the rule itself (see `namesCanBeCompared` in the text package),
   * so the probe and every comparison of two names read one check. Without it
   * nothing can be named, since whether another workspace or profile has a
   * name cannot be decided, and the reason is shown at start rather than met
   * at the first name given.
   */
  NameComparison: 'name-comparison',

  /**
   * Being told when a video frame is presented, which reference picture is
   * checked against the audio on (ADR-0046).
   */
  VideoFrameCallback: 'video-frame-callback',

  /** Showing an element across the whole screen, as a picture preview is. */
  Fullscreen: 'fullscreen',
} as const;

/** Something the browser either offers or does not. */
export type CapabilityKey = (typeof CapabilityKey)[keyof typeof CapabilityKey];

/** What AudioGubbins knows about one capability. */
export type CapabilityState = CapabilityPresent | CapabilityAbsent;

/** The capability is available. */
export interface CapabilityPresent {
  readonly key: CapabilityKey;
  readonly available: true;
}

/** The capability is not available, and this is what that means. */
export interface CapabilityAbsent {
  readonly key: CapabilityKey;
  readonly available: false;

  /**
   * British-English explanation of why, written for the person using
   * AudioGubbins rather than for a developer.
   */
  readonly reason: string;

  /**
   * What the user can do about it, when there is anything.
   *
   * Absent when there is genuinely nothing: telling someone to upgrade a
   * browser they do not control is not a remedy.
   */
  readonly remedy?: string;

  /**
   * Set while the browser has not yet answered.
   *
   * Some questions can only be asked asynchronously: whether WebGPU has an
   * adapter is one. Until the answer arrives the capability is treated as
   * absent, because assuming it is present is the assumption REQ-EXEC-216
   * forbids, and it says it is still being checked rather than that it is
   * missing.
   */
  readonly checking?: true;
}

/** Marks a capability as present. */
export function present(key: CapabilityKey): CapabilityPresent {
  return { key, available: true };
}

/** Marks a capability as absent, with a reason and an optional remedy. */
export function absent(key: CapabilityKey, reason: string, remedy?: string): CapabilityAbsent {
  return { key, available: false, reason, ...(remedy === undefined ? {} : { remedy }) };
}

/**
 * A feature that needs capabilities, and what it does without them.
 *
 * REQ-EXEC-216 requires capability-sensitive assumptions to have explicit
 * fallback or error behaviour. Declaring the requirement beside the fallback is
 * what makes that checkable: a feature with neither is visible here rather than
 * discovered by a user whose button does nothing.
 */
export interface FeatureRequirement {
  /** Stable key, for example `multi-threaded-dsp`. */
  readonly featureKey: string;

  /** British-English name of the feature, for the capability surface. */
  readonly label: string;

  /** Capabilities without which the feature cannot run at all. */
  readonly required: readonly CapabilityKey[];

  /**
   * Capabilities that improve the feature without being necessary.
   *
   * A feature missing only these still runs, and the surface says what is
   * reduced rather than reporting it as broken.
   */
  readonly preferred?: readonly CapabilityKey[];

  /**
   * What happens without the required capabilities.
   *
   * British-English, and specific: "Rendering falls back to the CPU, which is
   * slower on long files" rather than "Degraded".
   */
  readonly fallback: string;
}

/** How a feature is running on this device. */
export const FeatureStatus = {
  /** Everything it wants is present. */
  Full: 'full',

  /** It runs, but without something that would improve it. */
  Reduced: 'reduced',

  /** It cannot run here. */
  Unavailable: 'unavailable',
} as const;

/** How a feature is running on this device. */
export type FeatureStatus = (typeof FeatureStatus)[keyof typeof FeatureStatus];

/** A feature, how it is running, and why. */
export interface FeatureAvailability {
  readonly featureKey: string;
  readonly label: string;
  readonly status: FeatureStatus;

  /** The required capabilities that are missing. */
  readonly missingRequired: readonly CapabilityAbsent[];

  /** The preferred capabilities that are missing. */
  readonly missingPreferred: readonly CapabilityAbsent[];

  /**
   * What the user is told.
   *
   * Empty when the feature is running fully, so the surface can list only what
   * is actually reduced rather than a wall of green ticks.
   */
  readonly explanation: string;
}
