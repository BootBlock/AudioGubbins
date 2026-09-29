/**
 * The public contract of AudioGubbins capability detection.
 *
 * This is the only package that probes the browser. REQ-EXEC-136.4 keeps
 * platform APIs from becoming implicit global dependencies, and REQ-EXEC-216
 * requires capability-sensitive assumptions to carry explicit fallback or error
 * behaviour. Both hold only while detection has one home; a `typeof window.x`
 * check written inside a feature is a silent assumption by another name.
 */

export {
  CapabilityKey,
  type CapabilityAbsent,
  type CapabilityPresent,
  type CapabilityState,
  type FeatureAvailability,
  type FeatureRequirement,
  FeatureStatus,
  absent,
  present,
} from './capability.js';

export {
  type CapabilityEnvironment,
  type CapabilityRegistry,
  type LateAnswers,
  createCapabilityRegistry,
} from './registry.js';

export {
  type AppearanceSettings,
  type AppearanceSettingsWatch,
  askLateQuestions,
  describeEnvironment,
  detectBrowserEnvironment,
  readPlatformSignals,
  watchAppearanceSettings,
  watchMediaQuery,
} from './browser-environment.js';

export {
  OperatingSystem,
  type PlatformSignals,
  operatingSystemOf,
  usesAppleModifiers,
} from './platform.js';

export {
  ACCELERATED_RENDERING,
  ALL_FEATURES,
  AUDIO_PLAYBACK,
  DIRECT_FILE_ACCESS,
  HARDWARE_CODECS,
  MULTI_THREADED_DSP,
  NAMING,
  OFFLINE_USE,
  PRESSURE_SENSITIVE_TOOLS,
  PROJECT_STORAGE,
  RECORDING,
  SETTINGS_STORAGE,
  SYSTEM_APPEARANCE,
} from './features.js';

// What the user's keyboard layout types on each key, where the browser says.
export { readLayoutMap, type LayoutMapPairs } from './keyboard-layout-map.js';

// The storage objects the browser offers, read once for the storage adapters,
// and what each one's absence costs.
export {
  type FilePickers,
  type HostYielding,
  type StorageGlobals,
  type StorageNavigator,
  type StoragePersistence,
  type StoragePlatform,
  readOriginPrivateRoot,
  readStoragePlatform,
} from './storage-platform.js';

export {
  type StorageCapabilityAbsence,
  StorageCapabilityKey,
  missingStorageCapabilities,
} from './storage-capabilities.js';
