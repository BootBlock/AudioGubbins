/**
 * Every reason a refusal gives, rather than the first.
 *
 * A validator collects all it finds, so a profile with three bad bindings is
 * refused for three reasons; a store that passed on the first would have the
 * user hear one and mend one. A store answers with all of them, and the command
 * that asked hands them on as one refusal of several failures.
 */

/** One or more reasons, in the order they were found. */
export type Reasons = readonly [string, ...string[]];

/** The summary of each failure a refusal carries. */
export function reasonsOf(
  failures: readonly [{ readonly summary: string }, ...{ readonly summary: string }[]],
): Reasons {
  const [first, ...rest] = failures;
  return [first.summary, ...rest.map((one) => one.summary)];
}
