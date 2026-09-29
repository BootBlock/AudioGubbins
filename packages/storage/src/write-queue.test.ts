import { describe, expect, it } from 'vitest';

import { FailureKind, fail, failure, succeed } from '@audiogubbins/domain';
import { TreeFailure, TreeFailureKind } from '@audiogubbins/project-format';

import { WriteQueue, type Write } from './write-queue.js';

/** A write that notes its name when it runs, and gives what `result` says. */
function noting(
  written: string[],
  name: string,
  result: () => ReturnType<Write> = () => Promise.resolve(succeed(undefined)),
): Write {
  return async () => {
    const outcome = await result();
    if (outcome.ok) written.push(name);
    return outcome;
  };
}

const NOT_CONFIRMED = failure(
  'storage.write-not-confirmed',
  FailureKind.Retryable,
  'Not read back.',
);

describe('the order writes reach storage in', () => {
  it('writes one at a time, in the order queued', async () => {
    const written: string[] = [];
    const queue = new WriteQueue(() => undefined);
    const outcomes = await Promise.all(
      ['a', 'b', 'c'].map((name) => queue.enqueue(noting(written, name))),
    );
    expect(written).toEqual(['a', 'b', 'c']);
    expect(outcomes).toEqual([{ kind: 'written' }, { kind: 'written' }, { kind: 'written' }]);
    expect(queue.status).toEqual({ kind: 'saved' });
  });

  it('pauses at a refused write, keeps it and every later one, and resumes in order', async () => {
    const written: string[] = [];
    let full = true;
    const queue = new WriteQueue(() => undefined);
    const refusing = noting(written, 'b', () => {
      if (full) throw new TreeFailure(TreeFailureKind.Quota, 'Full.');
      return Promise.resolve(succeed(undefined));
    });
    const [a, b, c] = await Promise.all([
      queue.enqueue(noting(written, 'a')),
      queue.enqueue(refusing),
      queue.enqueue(noting(written, 'c')),
    ]);
    expect([a, b, c]).toMatchObject([
      { kind: 'written' },
      { kind: 'not-saved', cause: { code: 'storage.full' } },
      { kind: 'not-saved', cause: { code: 'storage.full' } },
    ]);
    expect(queue.status).toMatchObject({ kind: 'not-saved', pending: 2 });

    full = false;
    expect(await queue.retry()).toEqual({ kind: 'saved' });
    expect(written).toEqual(['a', 'b', 'c']);
  });

  it('pauses at a write that fails for itself, and makes it again first', async () => {
    const written: string[] = [];
    let confirmed = false;
    const queue = new WriteQueue(() => undefined);
    const unconfirmed = noting(written, 'a', () =>
      Promise.resolve(confirmed ? succeed(undefined) : fail(NOT_CONFIRMED)),
    );
    expect(await queue.enqueue(unconfirmed)).toEqual({ kind: 'not-saved', cause: NOT_CONFIRMED });
    confirmed = true;
    // The next write queued resumes the queue, the paused write first.
    expect(await queue.enqueue(noting(written, 'b'))).toEqual({ kind: 'written' });
    expect(written).toEqual(['a', 'b']);
  });

  it('stops for good at anything else a write throws, and passes it to every caller waiting', async () => {
    const queue = new WriteQueue(() => undefined);
    const defect = new Error('A defect.');
    const first = queue.enqueue(() => Promise.reject(defect));
    const second = queue.enqueue(() => Promise.resolve(succeed(undefined)));
    await expect(first).rejects.toBe(defect);
    await expect(second).rejects.toBe(defect);
    expect(queue.status).toEqual({ kind: 'stopped', unsaved: 2 });
    expect(await queue.enqueue(() => Promise.resolve(succeed(undefined)))).toEqual({
      kind: 'stopped',
    });
  });

  it('drops what waits when stopped, and says how much', async () => {
    let release: () => void = () => undefined;
    const queue = new WriteQueue(() => undefined);
    const running = queue.enqueue(
      () =>
        new Promise((resolve) => {
          release = () => {
            resolve(succeed(undefined));
          };
        }),
    );
    const waiting = queue.enqueue(() => Promise.resolve(succeed(undefined)));
    expect(queue.stop()).toBe(2);
    release();
    expect(await running).toEqual({ kind: 'stopped' });
    expect(await waiting).toEqual({ kind: 'stopped' });
  });
});
