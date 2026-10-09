/**
 * What another package's tests may take from the domain's test support.
 *
 * A declared entry point, so a test elsewhere reaches it by a path the manifest
 * offers rather than past the package into its source. The helpers here read a
 * {@link DomainResult}, which this package owns, so this is where they belong:
 * written out again in each package that needs them, the copies would drift
 * apart, one more with each package that needed one.
 *
 * Apart from the package's own entry point, and staying apart. Production code
 * handles both branches of a result, and a shipped helper that throws on
 * failure would be an inviting way to stop doing so. An architecture rule
 * refuses any production module that reaches test support, whatever path it
 * takes.
 */

export { expectFailureCode, expectSuccess } from './unwrap.js';
export { type OracleWorld, type Samples, applyEdit } from './edit-oracle.js';
export { PLAN_WITHOUT_CHAINS, TEST_ENGINE } from './plan-context.js';
export { deepestChain, nestedGroups } from './deep-chains.js';
export {
  CUTOFF,
  GENTLE,
  LOOK_AHEAD,
  TEST_CATALOGUE,
  TEST_DENOISER,
  TEST_FILTER,
  TEST_LIMITER,
  TEST_UPMIXER,
} from './test-processors.js';
export { renderPlan } from './plan-render.js';
export { crossingThreads } from './thread-crossing.js';
export { sourceShape } from '../editing/edit-shape.js';
