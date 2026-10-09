import { describe, expect, it } from 'vitest';

import { createDiagnosticCentre, createLogStore } from '@audiogubbins/diagnostics';

import { localInferenceCapabilities } from './local-inference.js';
import {
  createCapabilityRegistry,
  type CapabilityEnvironment,
  type CapabilityRegistry,
} from './registry.js';

/** A cross-origin isolated browser that offers everything the runtime can use. */
const EVERYTHING: CapabilityEnvironment = {
  hasOriginPrivateFileSystem: true,
  hasFileSystemAccess: true,
  hasSharedArrayBuffer: true,
  isCrossOriginIsolated: true,
  hasAudioWorklet: true,
  compilesWebAssembly: true,
  validatesWebAssemblySimd: true,
  choosesAudioOutput: true,
  hasWebWorkers: true,
  hasWebGpu: true,
  hasWebGl2: true,
  hasOffscreenCanvas: true,
  hasWebCodecs: true,
  hasMediaDevices: true,
  hasServiceWorker: true,
  hasStorageEstimate: true,
  hasPersistentStorage: true,
  hasPointerEvents: true,
  reportsPointerPressure: true,
  hasLocalStorage: true,
  hasMediaQueries: true,
  hasKeyboardLayoutMap: true,
  comparesNames: true,
  hasVideoFrameCallback: true,
  hasFullscreen: true,
};

function registryOf(environment: Partial<CapabilityEnvironment> = {}): CapabilityRegistry {
  const logger = createDiagnosticCentre(createLogStore(), { now: () => 0 }).loggerFor(
    'capabilities',
  );
  return createCapabilityRegistry({ ...EVERYTHING, ...environment }, logger);
}

describe('localInferenceCapabilities', () => {
  it('offers SIMD on a device that has it', () => {
    expect(localInferenceCapabilities(registryOf())).toEqual({ fixedWidthSimd: true });
  });

  it('offers no SIMD where the page may not compile WebAssembly, though its engine knows the instructions', () => {
    const forbidden = registryOf({ compilesWebAssembly: false, validatesWebAssemblySimd: true });
    const unknown = registryOf({ validatesWebAssemblySimd: false });
    expect(localInferenceCapabilities(forbidden).fixedWidthSimd).toBe(false);
    expect(localInferenceCapabilities(unknown).fixedWidthSimd).toBe(false);
  });
});
