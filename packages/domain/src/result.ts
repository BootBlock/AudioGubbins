/**
 * The result and failure vocabulary every domain operation speaks.
 *
 * REQ-EXEC-136.15 requires each boundary to define its failure behaviour rather
 * than relying on a blanket `try`/`catch` or a silent fallback. A thrown value
 * in TypeScript carries no type, so a caller cannot be made to handle it; a
 * returned {@link DomainResult} can, and the compiler enforces it.
 *
 * Exceptions remain reserved for programmer errors that no caller could
 * sensibly recover from, such as a broken invariant inside this package.
 */

/**
 * How a caller may respond to a failure.
 *
 * This is the recoverability semantic REQ-EXEC-136.15 asks for. It is part of
 * the failure's identity, decided where the failure is raised, because only
 * that code knows whether retrying could ever help.
 */
export const FailureKind = {
  /**
   * The caller supplied something the domain rejects. Correcting the input and
   * calling again is expected to succeed. Never retry unchanged.
   */
  Rejected: 'rejected',

  /**
   * The operation is valid but not possible in the current domain state, for
   * example renaming a track that another operation has just removed.
   */
  Conflict: 'conflict',

  /**
   * A transient condition prevented the operation. Calling again unchanged may
   * succeed.
   */
  Retryable: 'retryable',

  /**
   * The operation cannot proceed and no retry or input change will help. The
   * caller's job is to report it, not to work around it.
   */
  Unrecoverable: 'unrecoverable',

  /**
   * Stored or incoming data does not satisfy an invariant the domain relies on.
   * This is separated from the kinds above because it must never be repaired
   * silently: REQ-ARCH-153 makes the domain the authority, and quietly coercing
   * corrupt data would make the domain lie about what the user's project holds.
   */
  IntegrityViolation: 'integrity-violation',
} as const;

/** How a caller may respond to a failure. */
export type FailureKind = (typeof FailureKind)[keyof typeof FailureKind];

/** Failure kinds for which calling again unchanged could plausibly succeed. */
const RETRYABLE_KINDS: ReadonlySet<FailureKind> = new Set([FailureKind.Retryable]);

/**
 * A domain failure.
 *
 * `code` is a stable machine-readable identifier; `summary` is British-English
 * prose for a developer or a diagnostic log. Neither is a user-facing message:
 * REQ-PRIV-164 keeps presentation strings out of domain identifiers, and the
 * presentation layer decides how to word a failure for the person reading it.
 */
export interface DomainFailure {
  /** Stable identifier, for example `clip.start-before-asset-origin`. */
  readonly code: string;

  /** How a caller may respond. */
  readonly kind: FailureKind;

  /** Developer-facing explanation of what was wrong. */
  readonly summary: string;

  /**
   * Structured context for diagnostics. Must never hold audio samples, whole
   * project documents, credentials, or absolute filesystem paths
   * (REQ-PRIV-165).
   */
  readonly details?: Readonly<Record<string, string | number | boolean>>;

  /** The failure this one arose from, preserving the causal chain. */
  readonly cause?: DomainFailure;
}

/** A successful domain operation and its value. */
export interface DomainSuccess<TValue> {
  readonly ok: true;
  readonly value: TValue;
}

/** A failed domain operation and the reasons it failed. */
export interface DomainFailureResult {
  readonly ok: false;

  /**
   * Every reason the operation failed, in the order they were found.
   *
   * Validation reports all problems at once so a user correcting a dialogue is
   * not made to fix one field, resubmit, and discover the next.
   */
  readonly failures: readonly [DomainFailure, ...DomainFailure[]];
}

/** The outcome of a domain operation. */
export type DomainResult<TValue> = DomainSuccess<TValue> | DomainFailureResult;

/** Wraps a value as a successful result. */
export function succeed<TValue>(value: TValue): DomainSuccess<TValue> {
  return { ok: true, value };
}

/** Wraps one or more failures as a failed result. */
export function fail(first: DomainFailure, ...rest: readonly DomainFailure[]): DomainFailureResult {
  return { ok: false, failures: [first, ...rest] };
}

/** Builds a {@link DomainFailure}. */
export function failure(
  code: string,
  kind: FailureKind,
  summary: string,
  extra?: {
    readonly details?: Readonly<Record<string, string | number | boolean>>;
    readonly cause?: DomainFailure;
  },
): DomainFailure {
  return {
    code,
    kind,
    summary,
    ...(extra?.details === undefined ? {} : { details: extra.details }),
    ...(extra?.cause === undefined ? {} : { cause: extra.cause }),
  };
}

/** Narrows a result to its success branch. */
export function isSuccess<TValue>(result: DomainResult<TValue>): result is DomainSuccess<TValue> {
  return result.ok;
}

/** Narrows a result to its failure branch. */
export function isFailure<TValue>(result: DomainResult<TValue>): result is DomainFailureResult {
  return !result.ok;
}

/**
 * Whether calling the operation again unchanged could plausibly succeed.
 *
 * A caller that offers a retry must ask this rather than inspecting the kind,
 * so that adding a retryable kind later does not silently leave existing retry
 * affordances behind (REQ-EXEC-136.11: one authoritative home per domain rule).
 */
export function isRetryable(result: DomainFailureResult): boolean {
  return result.failures.some((problem) => RETRYABLE_KINDS.has(problem.kind));
}

/**
 * Collects several results into one.
 *
 * Every failure is preserved, so a caller validating a set of related changes
 * reports all of the problems rather than only the first.
 */
export function combine<TValue>(
  results: readonly DomainResult<TValue>[],
): DomainResult<readonly TValue[]> {
  const values: TValue[] = [];
  const failures: DomainFailure[] = [];

  for (const result of results) {
    if (result.ok) {
      values.push(result.value);
    } else {
      failures.push(...result.failures);
    }
  }

  const [first, ...rest] = failures;
  return first === undefined ? succeed(values) : fail(first, ...rest);
}

/** Transforms a successful value, leaving a failure untouched. */
export function mapResult<TIn, TOut>(
  result: DomainResult<TIn>,
  transform: (value: TIn) => TOut,
): DomainResult<TOut> {
  return result.ok ? succeed(transform(result.value)) : result;
}

/** Chains an operation that itself may fail. */
export function flatMapResult<TIn, TOut>(
  result: DomainResult<TIn>,
  next: (value: TIn) => DomainResult<TOut>,
): DomainResult<TOut> {
  return result.ok ? next(result.value) : result;
}
