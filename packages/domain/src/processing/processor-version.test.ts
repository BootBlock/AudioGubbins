import { describe, expect, it } from 'vitest';

import {
  checkStateVersion,
  type ModelIdentity,
  type ProcessorStateVersion,
} from './processor-version.js';

const MODEL: ModelIdentity = {
  pack: 'deepfilternet-3',
  version: '1.0.0',
  modelHash: 'a'.repeat(64),
  runtimeHash: 'b'.repeat(64),
};

const IMPLEMENTED: ProcessorStateVersion = {
  implementation: 1,
  parameters: 1,
  resampler: 1,
  model: MODEL,
};

/** The summary of the refusal of `found`, or nothing where it is accepted. */
function refusal(found: ProcessorStateVersion): string | undefined {
  const checked = checkStateVersion('deepfilternet-3', found, IMPLEMENTED);
  return checked.ok ? undefined : `${checked.failures[0].code}: ${checked.failures[0].summary}`;
}

describe('checkStateVersion, for an instance that names a model', () => {
  it('accepts the model and runtime this build runs', () => {
    expect(refusal({ ...IMPLEMENTED, model: { ...MODEL } })).toBeUndefined();
  });

  it('refuses another pack, pack version or hash of the files, saying the model differs', () => {
    for (const model of [
      { ...MODEL, pack: 'deepfilternet-2' },
      { ...MODEL, version: '1.0.1' },
      { ...MODEL, modelHash: 'c'.repeat(64) },
    ]) {
      expect(refusal({ ...IMPLEMENTED, model })).toBe(
        'processor.version-unknown: This build does not have the model version that processor "deepfilternet-3" was saved with.',
      );
    }
  });

  it('refuses another runtime build, saying the runtime differs', () => {
    expect(refusal({ ...IMPLEMENTED, model: { ...MODEL, runtimeHash: 'c'.repeat(64) } })).toBe(
      'processor.version-unknown: This build does not have the inference runtime version that processor "deepfilternet-3" was saved with.',
    );
  });

  it('refuses an instance that names no model where the build runs one, and the reverse', () => {
    const none: ProcessorStateVersion = { implementation: 1, parameters: 1, resampler: 1 };
    expect(refusal(none)).toMatch(/the model, inference runtime version/);
    expect(checkStateVersion('deepfilternet-3', IMPLEMENTED, none).ok).toBe(false);
  });

  it('names both models in the details, so a reader can say which is installed', () => {
    const checked = checkStateVersion(
      'deepfilternet-3',
      { ...IMPLEMENTED, model: { ...MODEL, version: '0.9.0' } },
      IMPLEMENTED,
    );
    expect(checked.ok ? {} : checked.failures[0].details).toMatchObject({
      foundModel: `deepfilternet-3 0.9.0 (${'a'.repeat(64)})`,
      implementedModel: `deepfilternet-3 1.0.0 (${'a'.repeat(64)})`,
    });
  });
});
