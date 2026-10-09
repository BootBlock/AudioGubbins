import { describe, expect, it } from 'vitest';

import type { AvailabilityContext, LocalInferenceSupport } from './availability-context.js';
import type { InstallState } from './install-state.js';
import type { ModelPackManifest } from './manifest.js';
import { packVersionCondition, type PackVersionCondition } from './pack-conditions.js';
import { sampleManifest } from './testing/sample-packs.js';

/**
 * Which of REQ-AUDIO-139's conditions holds for one pack version as the pack
 * manager lists it (ADR-0062): the device, the runtime, an update, or none.
 */

const FULL: LocalInferenceSupport = {
  status: 'full',
  explanation: '',
  missingRequired: [],
  missingPreferred: [],
};

const NO_SIMD_PREFERRED: LocalInferenceSupport = {
  status: 'reduced',
  explanation: 'Previews run on one thread.',
  missingRequired: [],
  missingPreferred: [{ key: 'webassembly-simd', reason: 'This browser has no fixed-width SIMD.' }],
};

const NO_INFERENCE: LocalInferenceSupport = {
  status: 'unavailable',
  explanation: 'This browser cannot run WebAssembly SIMD.',
  missingRequired: [{ key: 'webassembly-simd', reason: 'No SIMD.' }],
  missingPreferred: [],
};

const RUNTIME = { name: 'onnxruntime-web', version: '1.30.0', webAssemblySha256: 'a'.repeat(64) };
const INSTALLED: InstallState = { kind: 'installed' };

const V1 = sampleManifest();
const V1_1 = sampleManifest({ version: '1.1.0' });
const V1_2 = sampleManifest({ version: '1.2.0' });
const V1_3_NEEDS_RUNTIME_2 = sampleManifest({
  version: '1.3.0',
  runtime: { minimum: '2.0.0', below: '3.0.0' },
});
const NEEDS_SIMD = sampleManifest({
  id: 'gpu-pack',
  runtime: { capabilities: ['webassembly-simd'] },
});

function context(
  packs: readonly (readonly [ModelPackManifest, InstallState])[],
  catalogue: readonly ModelPackManifest[],
  device: LocalInferenceSupport = FULL,
): Pick<AvailabilityContext, 'packs' | 'catalogue' | 'runtime' | 'device'> {
  return {
    packs: packs.map(([manifest, state]) => ({ manifest, state })),
    catalogue,
    runtime: RUNTIME,
    device,
  };
}

function summary(condition: PackVersionCondition): readonly string[] {
  switch (condition.condition) {
    case 'runs':
      return ['runs'];
    case 'update-available':
      return [condition.condition, condition.update.version];
    case 'incompatible':
    case 'device-unavailable':
      return [condition.condition, condition.reason.code];
  }
}

describe('the condition of one pack version', () => {
  it('offers the highest later version that runs here as its update', () => {
    const held = context([[V1, INSTALLED]], [V1, V1_1, V1_2, V1_3_NEEDS_RUNTIME_2]);

    expect(summary(packVersionCondition(V1, held))).toEqual(['update-available', '1.2.0']);
  });

  it('offers no update already installed beside it, and none to the latest', () => {
    const held = context(
      [
        [V1, INSTALLED],
        [V1_1, INSTALLED],
      ],
      [V1, V1_1],
    );

    expect(summary(packVersionCondition(V1, held))).toEqual(['runs']);
    expect(summary(packVersionCondition(V1_1, held))).toEqual(['runs']);
  });

  it('says a version needing another runtime is incompatible, before any update', () => {
    const held = context([], [V1_3_NEEDS_RUNTIME_2, sampleManifest({ version: '1.4.0' })]);

    expect(summary(packVersionCondition(V1_3_NEEDS_RUNTIME_2, held))).toEqual([
      'incompatible',
      'model-pack.runtime-incompatible',
    ]);
  });

  it('says this browser or device cannot run a version it lacks a capability for', () => {
    expect(summary(packVersionCondition(NEEDS_SIMD, context([], [], NO_SIMD_PREFERRED)))).toEqual([
      'device-unavailable',
      'model-pack.device-unsupported',
    ]);
    expect(summary(packVersionCondition(V1, context([], [V1_1], NO_INFERENCE)))).toEqual([
      'device-unavailable',
      'model-pack.device-unsupported',
    ]);
  });
});
