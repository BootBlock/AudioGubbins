import { describe, expect, it } from 'vitest';

import { StandardLayouts } from '../audio/channel-layout.js';
import { OTHER_RATE, assetOf, frames, operationId, range } from '../testing/editing-fixtures.js';
import { PLAN_WITHOUT_CHAINS, TEST_ENGINE } from '../testing/plan-context.js';
import { expectFailureCode, expectSuccess } from '../testing/unwrap.js';
import type { EditOperation } from './operations.js';
import { assetPlan, bypassedAssetPlan, unrackedAssetPlan } from './plan-building.js';
import { slicePlan } from './plan-slicing.js';

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

/** Audio at another rate pasted at the start, converted by version `resampler`, where one is given. */
function insertionBy(resampler: number | undefined): EditOperation {
  const other = assetOf('at-44', 441, [], StandardLayouts.stereo, OTHER_RATE);
  const payload = expectSuccess(
    slicePlan(expectSuccess(assetPlan(other, PLAN_WITHOUT_CHAINS)), 0, 441),
  );
  return {
    id: operationId('insert'),
    kind: 'insert',
    at: frames(0),
    payload,
    ...(resampler === undefined ? {} : { resampler }),
  };
}

describe('the version of the engine’s algorithm an edit was made by (REQ-AUDIO-145)', () => {
  it('builds the plan of a stretch and a conversion this build’s versions made', () => {
    const asset = {
      ...SOURCE,
      edits: [
        insertionBy(TEST_ENGINE.resampler),
        stretchBy(TEST_ENGINE.stretch),
        conversionBy(TEST_ENGINE.resampler),
      ],
    };
    expectSuccess(assetPlan(asset, PLAN_WITHOUT_CHAINS));
  });

  it('refuses a stretch or a conversion another version made, however the plan is built', () => {
    // Heard as this build's stretch makes it, it would be another sound.
    for (const edit of [
      stretchBy(TEST_ENGINE.stretch + 1),
      conversionBy(TEST_ENGINE.resampler + 1),
      insertionBy(TEST_ENGINE.resampler + 1),
      insertionBy(undefined),
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
    const pasted = assetPlan(
      { ...SOURCE, edits: [insertionBy(TEST_ENGINE.resampler + 2)] },
      PLAN_WITHOUT_CHAINS,
    );
    expect(pasted.ok ? undefined : pasted.failures[0].details).toEqual({
      algorithm: 'resampler',
      found: TEST_ENGINE.resampler + 2,
      implemented: TEST_ENGINE.resampler,
    });
    const plan = assetPlan({ ...SOURCE, edits: [stretchBy(7)] }, PLAN_WITHOUT_CHAINS);
    expect(plan.ok ? undefined : plan.failures[0].details).toEqual({
      algorithm: 'stretch',
      found: 7,
      implemented: TEST_ENGINE.stretch,
    });
  });
});
