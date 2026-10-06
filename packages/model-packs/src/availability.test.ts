import { describe, expect, it } from 'vitest';

import { FailureKind, failure, type ModelIdentity } from '@audiogubbins/domain';

import {
  availabilityOf,
  packsToFetch,
  type AvailabilityContext,
  type LocalInferenceSupport,
  type PackAvailability,
  type PackNeed,
} from './availability.js';
import type { InstallState } from './install-state.js';
import type { ModelPackManifest } from './manifest.js';
import { ANY_SHA256, sampleManifest } from './testing/sample-packs.js';

const FULL: LocalInferenceSupport = {
  status: 'full',
  explanation: '',
  missingRequired: [],
  missingPreferred: [],
};

const NO_SIMD: LocalInferenceSupport = {
  status: 'unavailable',
  explanation:
    'This browser cannot run WebAssembly SIMD, which local machine-learning processing needs.',
  missingRequired: [{ key: 'webassembly-simd', reason: 'No SIMD.' }],
  missingPreferred: [],
};

const NO_WEBGPU: LocalInferenceSupport = {
  status: 'reduced',
  explanation: 'Previews run on one thread.',
  missingRequired: [],
  missingPreferred: [{ key: 'webgpu', reason: 'This browser has no WebGPU adapter.' }],
};

const RUNTIME = { name: 'onnxruntime-web', version: '1.30.0' };
const INSTALLED: InstallState = { kind: 'installed' };

const V1 = sampleManifest();
const V2 = sampleManifest({ version: '1.1.0' });
const NEEDS_RUNTIME_2 = sampleManifest({
  version: '2.0.0',
  runtime: { minimum: '2.0.0', below: '3.0.0' },
});

const REQUIRED: PackNeed = { role: 'processor', typeKey: 'sample-denoise', required: true };
const OPTIONAL: PackNeed = { role: 'detector', typeKey: 'clicks', required: false };

function context(
  packs: readonly (readonly [ModelPackManifest, InstallState])[],
  catalogue: readonly ModelPackManifest[] = [],
  device: LocalInferenceSupport = FULL,
): AvailabilityContext {
  return {
    packs: packs.map(([manifest, state]) => ({ manifest, state })),
    catalogue,
    runtime: RUNTIME,
    device,
  };
}

function summary(availability: PackAvailability): readonly unknown[] {
  switch (availability.condition) {
    case 'available':
      return [availability.condition, availability.pack.version];
    case 'update-available':
      return [availability.condition, availability.pack.version, availability.update.version];
    case 'incompatible':
      return [
        availability.condition,
        availability.pack.version,
        availability.reason.code,
        availability.offered?.version,
      ];
    case 'device-unavailable':
      return [availability.condition, availability.reason.code];
    default:
      return [availability.condition, availability.reason.code, availability.offered?.version];
  }
}

describe('which condition holds for a processor or detector a project names (REQ-AUDIO-139)', () => {
  it('is available where an installed version serves it on this runtime and device', () => {
    expect(summary(availabilityOf(REQUIRED, context([[V1, INSTALLED]])))).toEqual([
      'available',
      '1.0.0',
    ]);
  });

  it('says an update is available where the catalogue offers a later version that runs here', () => {
    expect(summary(availabilityOf(REQUIRED, context([[V1, INSTALLED]], [V1, V2])))).toEqual([
      'update-available',
      '1.0.0',
      '1.1.0',
    ]);
    // A later version that needs another runtime is no update.
    expect(
      summary(availabilityOf(REQUIRED, context([[V1, INSTALLED]], [NEEDS_RUNTIME_2]))),
    ).toEqual(['available', '1.0.0']);
  });

  it('says a required model is unavailable where none is installed, offering one to install', () => {
    expect(summary(availabilityOf(REQUIRED, context([], [V1, V2])))).toEqual([
      'required-unavailable',
      'model-pack.not-installed',
      '1.1.0',
    ]);
  });

  it('says an optional enhancement is unavailable where its pack is not installed', () => {
    const detector = sampleManifest({ processors: [], detectors: ['clicks'] });
    expect(summary(availabilityOf(OPTIONAL, context([], [detector])))).toEqual([
      'optional-unavailable',
      'model-pack.not-installed',
      '1.0.0',
    ]);
    expect(summary(availabilityOf(OPTIONAL, context([], [])))).toEqual([
      'optional-unavailable',
      'model-pack.none-serves',
      undefined,
    ]);
  });

  it('says the model is incompatible where the installed version needs another runtime', () => {
    expect(summary(availabilityOf(REQUIRED, context([[NEEDS_RUNTIME_2, INSTALLED]])))).toEqual([
      'incompatible',
      '2.0.0',
      'model-pack.runtime-incompatible',
      undefined,
    ]);
    expect(
      summary(availabilityOf(REQUIRED, context([[NEEDS_RUNTIME_2, INSTALLED]], [V1]))),
    ).toEqual(['incompatible', '2.0.0', 'model-pack.runtime-incompatible', '1.0.0']);
    expect(summary(availabilityOf(REQUIRED, context([], [NEEDS_RUNTIME_2])))).toEqual([
      'incompatible',
      '2.0.0',
      'model-pack.runtime-incompatible',
      undefined,
    ]);
    const otherRuntime = sampleManifest({ runtime: { name: 'another-runtime' } });
    expect(summary(availabilityOf(REQUIRED, context([[otherRuntime, INSTALLED]])))[0]).toBe(
      'incompatible',
    );
  });

  it('says the device cannot run it where local inference is unavailable here, installed or not', () => {
    for (const situation of [context([[V1, INSTALLED]], [], NO_SIMD), context([], [V1], NO_SIMD)]) {
      const availability = availabilityOf(REQUIRED, situation);
      expect(summary(availability)).toEqual([
        'device-unavailable',
        'model-pack.device-unsupported',
      ]);
      expect(availability.condition === 'device-unavailable' && availability.reason.summary).toBe(
        NO_SIMD.explanation,
      );
    }
  });

  it('says the device cannot run a pack that needs a capability it lacks, and runs one that does not', () => {
    const gpu = sampleManifest({ runtime: { capabilities: ['webgpu'] } });
    const availability = availabilityOf(REQUIRED, context([[gpu, INSTALLED]], [], NO_WEBGPU));
    expect(summary(availability)).toEqual(['device-unavailable', 'model-pack.device-unsupported']);
    expect(availability.condition === 'device-unavailable' && availability.reason.details).toEqual({
      pack: 'sample-pack',
      capability: 'webgpu',
    });
    expect(summary(availabilityOf(REQUIRED, context([[V1, INSTALLED]], [], NO_WEBGPU)))).toEqual([
      'available',
      '1.0.0',
    ]);
  });

  it('makes a damaged or unfinished pack unavailable with that reason', () => {
    const damaged: InstallState = {
      kind: 'failed',
      reason: failure('model-pack.file-hash-mismatch', FailureKind.IntegrityViolation, 'Rot.'),
      resumable: false,
      received: 0,
    };
    expect(summary(availabilityOf(REQUIRED, context([[V1, damaged]], [V1])))).toEqual([
      'required-unavailable',
      'model-pack.damaged',
      '1.0.0',
    ]);
    const downloading: InstallState = { kind: 'downloading', received: 2, total: 8 };
    expect(
      summary(
        availabilityOf(
          OPTIONAL,
          context([[sampleManifest({ detectors: ['clicks'] }), downloading]]),
        ),
      ),
    ).toEqual(['optional-unavailable', 'model-pack.not-ready', undefined]);
  });

  it('holds an instance to the pack and version it was made with, by its model’s hash', () => {
    const model: ModelIdentity = {
      pack: 'sample-pack',
      version: '1.0.0',
      modelHash: ANY_SHA256,
      runtimeHash: 'a'.repeat(64),
    };
    const pinned: PackNeed = { ...REQUIRED, model };
    expect(
      summary(
        availabilityOf(
          pinned,
          context([
            [V1, INSTALLED],
            [V2, INSTALLED],
          ]),
        ),
      ),
    ).toEqual(['available', '1.0.0']);
    expect(summary(availabilityOf(pinned, context([[V2, INSTALLED]], [V1])))).toEqual([
      'required-unavailable',
      'model-pack.not-installed',
      '1.0.0',
    ]);
    expect(summary(availabilityOf(pinned, context([[V2, INSTALLED]], [V2])))).toEqual([
      'required-unavailable',
      'model-pack.version-not-offered',
      undefined,
    ]);
    const rebuilt: PackNeed = { ...REQUIRED, model: { ...model, modelHash: 'b'.repeat(64) } };
    expect(summary(availabilityOf(rebuilt, context([[V1, INSTALLED]])))).toEqual([
      'required-unavailable',
      'model-pack.model-differs',
      undefined,
    ]);
    const anotherPack: PackNeed = { ...REQUIRED, model: { ...model, pack: 'another-pack' } };
    expect(summary(availabilityOf(anotherPack, context([[V1, INSTALLED]])))[1]).toBe(
      'model-pack.none-serves',
    );
  });

  it('tells a processor from a detector of the same type key', () => {
    expect(
      summary(availabilityOf({ ...REQUIRED, role: 'detector' }, context([[V1, INSTALLED]]))),
    ).toEqual(['required-unavailable', 'model-pack.none-serves', undefined]);
  });
});

describe('what opening a project fetches', () => {
  const needs: readonly PackNeed[] = [
    REQUIRED,
    OPTIONAL,
    { ...REQUIRED, typeKey: 'sample-denoise' },
  ];
  const optionalPack = sampleManifest({ id: 'clicks-pack', processors: [], detectors: ['clicks'] });

  it('fetches nothing unless the person’s policy fetches required packs', () => {
    expect(packsToFetch(needs, context([], [V1, optionalPack]), 'never')).toEqual([]);
  });

  it('fetches only what is required, not installed and offered to run here, once each', () => {
    expect(packsToFetch(needs, context([], [V1, optionalPack]), 'required')).toEqual([V1]);
    expect(packsToFetch(needs, context([[V1, INSTALLED]], [V1, V2]), 'required')).toEqual([]);
    expect(packsToFetch(needs, context([], [NEEDS_RUNTIME_2]), 'required')).toEqual([]);
    expect(packsToFetch(needs, context([], [V1], NO_SIMD), 'required')).toEqual([]);
  });
});
