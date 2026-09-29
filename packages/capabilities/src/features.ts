/**
 * The features whose availability depends on what the browser offers.
 *
 * Declared in one place so that the capability surface, the diagnostic bundle
 * and the controls that must dim themselves all read the same list. A feature
 * that requires a capability and is absent from this list is one whose button
 * fails silently on the device that lacks it, which is what REQ-EXEC-216 exists
 * to prevent.
 *
 * Phase 01 owns the capability machinery, not the features themselves. The
 * entries here describe requirements the later phases that own those features
 * will satisfy. They are declarations of what a feature needs, not partial
 * implementations of it, so they do not leak a later phase's work into this one
 * (REQ-EXEC-136.9).
 */

import { CapabilityKey, type FeatureRequirement } from './capability.js';

/** Storing and reopening a project without the user exporting it. */
export const PROJECT_STORAGE: FeatureRequirement = {
  featureKey: 'project-storage',
  label: 'Saving projects in the browser',
  required: [CapabilityKey.OriginPrivateFileSystem],
  preferred: [CapabilityKey.PersistentStorage, CapabilityKey.StorageEstimate],
  fallback:
    'Projects cannot be kept between visits. Export anything you want to keep before you close the tab.',
};

/** Opening and saving files where the user keeps them. */
export const DIRECT_FILE_ACCESS: FeatureRequirement = {
  featureKey: 'direct-file-access',
  label: 'Opening and saving files on your disk',
  required: [CapabilityKey.FileSystemAccess],
  fallback: 'Files are imported through a file chooser and exported to your downloads instead.',
};

/**
 * Playing and processing audio without interrupting the interface.
 *
 * Shared memory lets the audio thread read what it plays without a message
 * for every block; without it, audio is sent in messages and the engine keeps
 * more of it ahead of the play position, so playback starts a little later.
 */
export const AUDIO_PLAYBACK: FeatureRequirement = {
  featureKey: 'audio-playback',
  label: 'Playback and live effects',
  required: [CapabilityKey.AudioWorklet],
  preferred: [CapabilityKey.SharedArrayBuffer],
  fallback: 'Playback is unavailable in this browser.',
};

/**
 * The canonical DSP compiled to WebAssembly (ADR-0031).
 *
 * Without it, processing runs the TypeScript reference path, which repeats
 * every operation of the canonical one in the same order and gives the same
 * bits (ADR-0032), so nothing a render produces changes; only its speed does.
 */
export const CANONICAL_DSP: FeatureRequirement = {
  featureKey: 'canonical-dsp',
  label: 'Fast canonical processing',
  required: [],
  preferred: [CapabilityKey.WebAssembly],
  fallback:
    'Processing runs without WebAssembly. Renders are the same, sample for sample, and take longer.',
};

/**
 * Rendering offline, away from the interface.
 *
 * Requires background threads outright: REQ-ARCH-036 keeps heavy processing
 * off the thread that draws the interface, so a browser without workers is
 * told the renderer is unavailable rather than having its interface stall.
 */
export const OFFLINE_RENDERING: FeatureRequirement = {
  featureKey: 'offline-rendering',
  label: 'Rendering in the background',
  required: [CapabilityKey.WebWorkers],
  fallback:
    'Offline rendering is unavailable in this browser, because it would stop the interface while it ran.',
};

/** Choosing the device playback goes to. */
export const OUTPUT_DEVICE_CHOICE: FeatureRequirement = {
  featureKey: 'output-device-choice',
  label: 'Choosing the playback device',
  required: [CapabilityKey.AudioOutputSelection],
  fallback: "Playback goes to your system's default device.",
};

/** Running DSP across several threads. */
export const MULTI_THREADED_DSP: FeatureRequirement = {
  featureKey: 'multi-threaded-dsp',
  label: 'Multi-threaded processing',
  required: [CapabilityKey.WebWorkers],
  // Shared memory between threads needs the page cross-origin isolated, so
  // either missing reduces this.
  preferred: [CapabilityKey.SharedArrayBuffer, CapabilityKey.CrossOriginIsolation],
  fallback: 'Processing runs on fewer threads, so long files take longer.',
};

/** Drawing the waveform and spectrogram. */
export const ACCELERATED_RENDERING: FeatureRequirement = {
  featureKey: 'accelerated-rendering',
  label: 'Accelerated waveform and spectrogram drawing',
  required: [],
  preferred: [CapabilityKey.WebGpu, CapabilityKey.WebGl2, CapabilityKey.OffscreenCanvas],
  fallback: 'Drawing falls back to the processor, which is slower on long files.',
};

/** Capturing audio. */
export const RECORDING: FeatureRequirement = {
  featureKey: 'recording',
  label: 'Recording',
  required: [CapabilityKey.MediaDevices, CapabilityKey.AudioWorklet],
  fallback: 'Recording is unavailable in this browser.',
};

/** Running without a network connection, and installing. */
export const OFFLINE_USE: FeatureRequirement = {
  featureKey: 'offline-use',
  label: 'Working offline and installing AudioGubbins',
  required: [CapabilityKey.ServiceWorker],
  fallback: 'AudioGubbins needs a connection to load, and cannot be installed.',
};

/** Pressure-sensitive editing tools. */
export const PRESSURE_SENSITIVE_TOOLS: FeatureRequirement = {
  featureKey: 'pressure-sensitive-tools',
  label: 'Pressure-sensitive tools',
  required: [CapabilityKey.PointerEvents],
  preferred: [CapabilityKey.PointerPressure],
  fallback: 'Tools use a fixed strength, which you can set yourself.',
};

/** Faster import and export of compressed formats. */
export const HARDWARE_CODECS: FeatureRequirement = {
  featureKey: 'hardware-codecs',
  label: 'Hardware-assisted import and export',
  required: [],
  preferred: [CapabilityKey.WebCodecs],
  fallback: 'Compressed formats are decoded in software, which is slower.',
};

/**
 * Keeping the shell's own state between visits.
 *
 * Unlike the features above, this one is Phase 01's: the preferences, the
 * workspaces and the shortcut profiles are all stored this way today.
 */
export const SETTINGS_STORAGE: FeatureRequirement = {
  featureKey: 'settings-storage',
  label: 'Remembering your settings, workspaces and shortcuts',
  required: [CapabilityKey.LocalStorage],
  fallback: 'They last until you close this tab, and start from the defaults on the next visit.',
};

/** Following the operating system's dark, motion and contrast settings. */
export const SYSTEM_APPEARANCE: FeatureRequirement = {
  featureKey: 'system-appearance',
  label: "Following your system's appearance",
  required: [CapabilityKey.MediaQueries],
  fallback:
    'The System theme cannot follow your device, so it shows the light theme, and motion and contrast follow only what you choose.',
};

/**
 * The default shortcuts, on the keys of the user's own keyboard from the start.
 *
 * Phase 01's, as the settings' storage is. A default is placed on the key that
 * types its character, and where the browser gives no layout map that key is
 * learned from what the user types. Counted as missing in the status bar, it
 * says its cause and its remedy here as well as in the settings, where they
 * are shown only while a default waits.
 */
const KEYBOARD_PLACED_SHORTCUTS: FeatureRequirement = {
  featureKey: 'keyboard-placed-shortcuts',
  label: 'Default shortcuts on your keyboard from the start',
  required: [],
  preferred: [CapabilityKey.KeyboardLayoutMap],
  // Both waits, with Caps Lock off, as the Shortcuts settings say. Nothing is
  // learned while it is on, so a reader who follows the status bar here and
  // presses the key with it on is given the cause. The second wait is the one
  // a key press does not end: on Apple hardware a default whose character
  // sits away from its US key waits for a press made with Command, which only
  // the Shortcuts settings ask for.
  fallback:
    'A default shortcut waits until you have pressed the key it goes on once, with Caps Lock off, anywhere in AudioGubbins. On Apple hardware, a default may instead wait for you to press its key with Command while the Shortcuts settings, which name the key, are open.',
};

/**
 * Giving a workspace or a shortcut profile a name, which saving as, copying,
 * renaming and importing each do, and so does changing the built-in
 * shortcuts, which are copied under a name first.
 *
 * Phase 01's, as the settings' storage is. The commands that name read it, so
 * each is unavailable with the reason shown here, and nothing the user has is
 * refused: stored workspaces and profiles are read and switched between under
 * the names they have.
 */
export const NAMING: FeatureRequirement = {
  featureKey: 'naming',
  label: 'Naming workspaces and shortcut profiles',
  required: [CapabilityKey.NameComparison],
  fallback:
    'Workspaces and shortcut profiles cannot be saved as new ones, copied, renamed or imported, and the built-in shortcuts cannot be changed. Those you have are kept, and you can still switch between them.',
};

/** Every declared feature, for the capability surface and diagnostic bundles. */
export const ALL_FEATURES: readonly FeatureRequirement[] = [
  SETTINGS_STORAGE,
  SYSTEM_APPEARANCE,
  KEYBOARD_PLACED_SHORTCUTS,
  NAMING,
  PROJECT_STORAGE,
  DIRECT_FILE_ACCESS,
  AUDIO_PLAYBACK,
  OUTPUT_DEVICE_CHOICE,
  CANONICAL_DSP,
  OFFLINE_RENDERING,
  MULTI_THREADED_DSP,
  ACCELERATED_RENDERING,
  RECORDING,
  OFFLINE_USE,
  PRESSURE_SENSITIVE_TOOLS,
  HARDWARE_CODECS,
];
