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

export { type AudioRuntimeCapabilities, audioRuntimeCapabilities } from './audio-runtime.js';

// What the inference runtime may use, for the application to start its worker with (ADR-0062).
export { type LocalInferenceCapabilities, localInferenceCapabilities } from './local-inference.js';

// What the machine has left, for the engine to plan work around (REQ-ARCH-087).
export { type ResourceFigures, readResourceFigures } from './resources.js';

// When the audio devices change, for the runtime to recover its context.
export { watchAudioDevices } from './audio-devices.js';

// The browser's audio input, which the application composes with the recording
// session and hands what it opens to the audio runtime (ADR-0070).
export {
  type MediaInput,
  type MediaInputGlobals,
  type MediaInputNavigator,
  readMediaInput,
} from './media-input.js';

export { type InputDeviceDescriptor, type ValueRange } from './input-devices.js';

export { type OpenedInput } from './opened-input.js';

export {
  type CaptureConstraintName,
  type CaptureRequest,
  type GrantedCaptureSettings,
  type SupportedCaptureConstraints,
} from './capture-constraints.js';

export { type MicrophonePermission } from './microphone-permission.js';

// Whether the page can be seen, for a recording a browser may suspend in the background.
export {
  type PageVisibility,
  type VisibilityDocument,
  readPageVisibility,
  watchPageVisibility,
} from './page-visibility.js';

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
  CANONICAL_DSP,
  DIRECT_FILE_ACCESS,
  FULL_SCREEN_PICTURE,
  HARDWARE_CODECS,
  LOCAL_INFERENCE,
  MULTI_THREADED_DSP,
  NAMING,
  OFFLINE_RENDERING,
  OFFLINE_USE,
  OUTPUT_DEVICE_CHOICE,
  PRESSURE_SENSITIVE_TOOLS,
  PROJECT_STORAGE,
  RECORDING,
  SETTINGS_STORAGE,
  SYSTEM_APPEARANCE,
} from './features.js';

// What the editor's renderer is handed: the GPU, and the pixel ratio as it changes.
export { type GraphicsPlatform, readGraphicsPlatform } from './graphics-platform.js';

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
