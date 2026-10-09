/**
 * Plan contexts for tests: the versions of the engine's algorithms a test's
 * edits are made by, and a context for audio that names no chain of
 * processors, with no project chains and no processor types, so a rack edit
 * or a rack in the test is refused rather than heard as nothing.
 */

import type { PlanContext } from '../editing/plan-building.js';
import type { EngineVersions } from '../editing/operations.js';

/**
 * The versions a test's stretches and conversions of rate are made by, and
 * its contexts have. The domain knows no engine, so these stand in for its
 * `ENGINE_VERSIONS`; a test that builds plans the engine reads takes the
 * engine's own.
 */
export const TEST_ENGINE: EngineVersions = { stretch: 1, resampler: 1 };

export const PLAN_WITHOUT_CHAINS: PlanContext = {
  chains: new Map(),
  catalogue: new Map(),
  engine: TEST_ENGINE,
};
