import { describe, expect, it } from 'vitest';

import {
  FailureKind,
  combine,
  fail,
  failure,
  flatMapResult,
  isFailure,
  isRetryable,
  isSuccess,
  mapResult,
  succeed,
} from './result.js';

const rejected = failure('test.rejected', FailureKind.Rejected, 'The input was rejected.');
const retryable = failure('test.retryable', FailureKind.Retryable, 'A transient condition.');
const integrity = failure(
  'test.integrity',
  FailureKind.IntegrityViolation,
  'Stored data broke an invariant.',
);

describe('succeed and fail', () => {
  it('narrows a success to its value', () => {
    const result = succeed(42);
    expect(isSuccess(result)).toBe(true);
    expect(isFailure(result)).toBe(false);
    if (isSuccess(result)) expect(result.value).toBe(42);
  });

  it('keeps every failure it was given, in order', () => {
    const result = fail(rejected, retryable);
    expect(result.failures).toHaveLength(2);
    expect(result.failures.map((problem) => problem.code)).toEqual([
      'test.rejected',
      'test.retryable',
    ]);
  });

  it('carries structured details without them being required', () => {
    const withDetails = failure('test.detail', FailureKind.Rejected, 'Summary.', {
      details: { field: 'gain', value: 3 },
    });
    expect(withDetails.details).toEqual({ field: 'gain', value: 3 });
    expect(rejected.details).toBeUndefined();
  });

  it('preserves the causal chain', () => {
    const wrapped = failure(
      'test.outer',
      FailureKind.Unrecoverable,
      'The outer operation failed.',
      {
        cause: rejected,
      },
    );
    expect(wrapped.cause?.code).toBe('test.rejected');
  });
});

describe('isRetryable', () => {
  it('reports a retryable failure as worth trying again', () => {
    expect(isRetryable(fail(retryable))).toBe(true);
  });

  it('does not invite a retry for rejected input', () => {
    expect(isRetryable(fail(rejected))).toBe(false);
  });

  it('never invites a retry for an integrity violation', () => {
    expect(isRetryable(fail(integrity))).toBe(false);
  });

  it('offers a retry when any of several failures is retryable', () => {
    expect(isRetryable(fail(rejected, retryable))).toBe(true);
  });
});

describe('combine', () => {
  it('collects the values when every result succeeded', () => {
    const result = combine([succeed(1), succeed(2), succeed(3)]);
    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) expect(result.value).toEqual([1, 2, 3]);
  });

  it('reports every failure rather than only the first', () => {
    const result = combine([succeed(1), fail(rejected), succeed(2), fail(retryable)]);
    expect(isFailure(result)).toBe(true);
    if (isFailure(result)) {
      expect(result.failures.map((problem) => problem.code)).toEqual([
        'test.rejected',
        'test.retryable',
      ]);
    }
  });

  it('succeeds with an empty list when given nothing', () => {
    const result = combine<number>([]);
    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) expect(result.value).toEqual([]);
  });
});

describe('mapResult', () => {
  it('transforms a successful value', () => {
    const result = mapResult(succeed(2), (value) => value * 3);
    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) expect(result.value).toBe(6);
  });

  it('leaves a failure untouched and does not run the transform', () => {
    let ran = false;
    const failed = fail(rejected);
    const result = mapResult(failed, () => {
      ran = true;
      return 1;
    });
    expect(ran).toBe(false);
    expect(result).toBe(failed);
  });
});

describe('flatMapResult', () => {
  it('chains an operation that succeeds', () => {
    const result = flatMapResult(succeed(2), (value) => succeed(value + 1));
    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) expect(result.value).toBe(3);
  });

  it('propagates a failure from the chained operation', () => {
    const result = flatMapResult(succeed(2), () => fail(retryable));
    expect(isFailure(result)).toBe(true);
    if (isFailure(result)) expect(result.failures[0].code).toBe('test.retryable');
  });

  it('short-circuits without running the chained operation', () => {
    let ran = false;
    flatMapResult(fail(rejected), () => {
      ran = true;
      return succeed(1);
    });
    expect(ran).toBe(false);
  });
});
