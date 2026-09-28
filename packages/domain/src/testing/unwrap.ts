/**
 * Result helpers for a test, this package's own and another package's.
 *
 * Offered through `@audiogubbins/domain/testing` rather than the package's
 * public entry point: production code handles both branches of a
 * {@link DomainResult}, and a helper that throws on failure would be an
 * inviting way to stop doing so.
 */

import type { DomainFailureResult, DomainResult } from '../result.js';

/**
 * Returns the value of a successful result, throwing if it failed.
 *
 * The thrown message names the failure code, so a test that regresses says
 * which validation started rejecting rather than only that something was
 * undefined.
 */
export function expectSuccess<TValue>(result: DomainResult<TValue>): TValue {
  if (!result.ok) {
    const codes = result.failures.map((problem) => problem.code).join(', ');
    throw new Error(`Expected a successful result, but it failed with: ${codes}`);
  }
  return result.value;
}

/** Returns a failed result's failures, throwing if it succeeded. */
function expectFailure<TValue>(result: DomainResult<TValue>): DomainFailureResult['failures'] {
  if (result.ok) {
    throw new Error('Expected the result to fail, but it succeeded.');
  }
  return result.failures;
}

/** Returns the code of a failed result's first failure. */
export function expectFailureCode<TValue>(result: DomainResult<TValue>): string {
  return expectFailure(result)[0].code;
}
