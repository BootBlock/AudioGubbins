import { describe, expect, it, vi } from 'vitest';

import { createDiagnosticCentre, createLogStore } from '@audiogubbins/diagnostics';

import { audioRuntimeCapabilities } from './audio-runtime.js';
import { watchAudioDevices } from './audio-devices.js';
import {
  createCapabilityRegistry,
  type CapabilityEnvironment,
  type CapabilityRegistry,
} from './registry.js';

/** A browser that offers nothing the audio engine can use. */
const NOTHING_FOR_AUDIO: CapabilityEnvironment = {
  hasOriginPrivateFileSystem: true,
  hasFileSystemAccess: true,
  hasSharedArrayBuffer: false,
  isCrossOriginIsolated: false,
  hasAudioWorklet: false,
  compilesWebAssembly: false,
  choosesAudioOutput: false,
  hasWebWorkers: false,
  hasWebGpu: false,
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
};

function registryOf(environment: Partial<CapabilityEnvironment>): CapabilityRegistry {
  const logger = createDiagnosticCentre(createLogStore(), { now: () => 0 }).loggerFor(
    'capabilities',
  );
  return createCapabilityRegistry({ ...NOTHING_FOR_AUDIO, ...environment }, logger);
}

describe('audioRuntimeCapabilities', () => {
  it('chooses every accelerator on a device that offers them all', () => {
    const answer = audioRuntimeCapabilities(
      registryOf({
        hasAudioWorklet: true,
        hasWebWorkers: true,
        compilesWebAssembly: true,
        hasSharedArrayBuffer: true,
        isCrossOriginIsolated: true,
        choosesAudioOutput: true,
        hasWebGpu: true,
      }),
    );
    expect(answer).toEqual({
      playback: true,
      offlineRendering: true,
      webAssembly: true,
      sharedMemory: true,
      outputSelection: true,
      gpu: true,
    });
  });

  it('reports the accelerators missing and keeps playback, where only the essentials are offered', () => {
    // The static host the application is published on cannot send the
    // isolation headers shared memory needs, so this is the common case.
    const answer = audioRuntimeCapabilities(
      registryOf({ hasAudioWorklet: true, hasWebWorkers: true, hasSharedArrayBuffer: true }),
    );
    expect(answer.playback).toBe(true);
    expect(answer.offlineRendering).toBe(true);
    expect(answer.webAssembly).toBe(false);
    expect(answer.sharedMemory).toBe(false);
    expect(answer.outputSelection).toBe(false);
    expect(answer.gpu).toBe(false);
  });
});

describe('watchAudioDevices', () => {
  it('reports each change of the devices until it is stopped', () => {
    const devices = new EventTarget();
    const original = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: devices });
    try {
      const changed = vi.fn();
      const stop = watchAudioDevices(changed);
      devices.dispatchEvent(new Event('devicechange'));
      expect(changed).toHaveBeenCalledTimes(1);
      stop();
      devices.dispatchEvent(new Event('devicechange'));
      expect(changed).toHaveBeenCalledTimes(1);
    } finally {
      if (original === undefined) Reflect.deleteProperty(navigator, 'mediaDevices');
      else Object.defineProperty(navigator, 'mediaDevices', original);
    }
  });

  it('reports nothing, and stops cleanly, where the browser offers no media devices', () => {
    const original = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
    try {
      const stop = watchAudioDevices(() => {
        throw new Error('No device change can be reported here.');
      });
      expect(stop).not.toThrow();
    } finally {
      if (original === undefined) Reflect.deleteProperty(navigator, 'mediaDevices');
      else Object.defineProperty(navigator, 'mediaDevices', original);
    }
  });
});
