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
  it('offers SIMD, WebGPU and a thread for each processor on a device that has them all', () => {
    expect(localInferenceCapabilities(registryOf(), { hardwareConcurrency: 8 })).toEqual({
      fixedWidthSimd: true,
      threads: 8,
      webGpu: true,
    });
  });

  it('offers one thread where memory cannot be shared, however many processors there are', () => {
    const answer = localInferenceCapabilities(registryOf({ isCrossOriginIsolated: false }), {
      hardwareConcurrency: 8,
    });
    expect(answer.threads).toBe(1);
  });

  it('offers one thread where the browser does not say how many processors it has', () => {
    expect(localInferenceCapabilities(registryOf(), {}).threads).toBe(1);
  });

  it('offers no SIMD where the page may not compile WebAssembly, though its engine knows the instructions', () => {
    const forbidden = registryOf({ compilesWebAssembly: false, validatesWebAssemblySimd: true });
    const unknown = registryOf({ validatesWebAssemblySimd: false });
    expect(localInferenceCapabilities(forbidden, { hardwareConcurrency: 4 }).fixedWidthSimd).toBe(
      false,
    );
    expect(localInferenceCapabilities(unknown, { hardwareConcurrency: 4 }).fixedWidthSimd).toBe(
      false,
    );
  });
});
