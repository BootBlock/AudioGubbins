import { describe, expect, it } from 'vitest';

import { OTHER_RATE, assetOf, frames, operationId, range } from '../testing/editing-fixtures.js';
import { PLAN_WITHOUT_CHAINS, TEST_ENGINE } from '../testing/plan-context.js';
import { expectFailureCode, expectSuccess } from '../testing/unwrap.js';
import type { EditOperation } from './operations.js';
import { assetPlan, bypassedAssetPlan, unrackedAssetPlan } from './plan-building.js';

const SOURCE = assetOf('source', 1_000);

function stretchBy(version: number): EditOperation {
  return {
    id: operationId('stretch'),
    kind: 'stretch',
    range: range(100, 200),
    length: frames(150),
    version,
  };
}

function conversionBy(version: number): EditOperation {
  return { id: operationId('convert'), kind: 'convert-rate', sampleRate: OTHER_RATE, version };
}

describe('the version of the engine’s algorithm an edit was made by (REQ-AUDIO-145)', () => {
  it('builds the plan of a stretch and a conversion this build’s versions made', () => {
    const asset = {
      ...SOURCE,
      edits: [stretchBy(TEST_ENGINE.stretch), conversionBy(TEST_ENGINE.resampler)],
    };
    expectSuccess(assetPlan(asset, PLAN_WITHOUT_CHAINS));
  });

  it('refuses a stretch or a conversion another version made, however the plan is built', () => {
    // Heard as this build's stretch makes it, it would be another sound.
    for (const edit of [
      stretchBy(TEST_ENGINE.stretch + 1),
      conversionBy(TEST_ENGINE.resampler + 1),
    ]) {
      const asset = { ...SOURCE, edits: [edit] };
      for (const plan of [
        assetPlan(asset, PLAN_WITHOUT_CHAINS),
        unrackedAssetPlan(asset, PLAN_WITHOUT_CHAINS),
        bypassedAssetPlan(asset, PLAN_WITHOUT_CHAINS),
      ]) {
        expect(expectFailureCode(plan)).toBe('edit.algorithm-version-unknown');
      }
    }
  });

  it('says which algorithm, and both versions', () => {
    const plan = assetPlan({ ...SOURCE, edits: [stretchBy(7)] }, PLAN_WITHOUT_CHAINS);
    expect(plan.ok ? undefined : plan.failures[0].details).toEqual({
      algorithm: 'stretch',
      found: 7,
      implemented: TEST_ENGINE.stretch,
    });
  });
});
