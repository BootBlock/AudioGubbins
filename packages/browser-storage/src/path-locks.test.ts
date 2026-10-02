import { describe, expect, it } from 'vitest';

import { PathLocks } from './path-locks.js';

/** Settles every promise already waiting. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('the order the storage worker changes the tree in', () => {
  it('grants one path to one change at a time, in the order they asked', async () => {
    const locks = new PathLocks();
    const order: string[] = [];
    const first = await locks.acquire('a/b');
    const second = locks.acquire('a/b').then((release) => {
      order.push('second');
      return release;
    });
    const third = locks.acquire('a/b').then((release) => {
      order.push('third');
      return release;
    });
    await settle();
    expect(order).toEqual([]);

    first();
    await settle();
    expect(order).toEqual(['second']);
    (await second)();
    await settle();
    expect(order).toEqual(['second', 'third']);
    (await third)();
  });

  it.each([
    ['a directory and a file in it', 'a', 'a/b'],
    ['a file and the directory it is in', 'a/b/c', 'a/b'],
    ['the root and anything', '', 'z'],
  ])('holds back %s', async (_form, held, asked) => {
    const locks = new PathLocks();
    const release = await locks.acquire(held);
    let granted = false;
    const waiting = locks.acquire(asked).then((next) => {
      granted = true;
      return next;
    });
    await settle();
    expect(granted).toBe(false);
    release();
    (await waiting)();
    expect(granted).toBe(true);
  });

  it('lets changes to unrelated paths run together, even past one that waits', async () => {
    const locks = new PathLocks();
    const holding = await locks.acquire('a');
    const blocked = locks.acquire('a/x');
    // A name that starts with another's is not inside it.
    const beside = await locks.acquire('ab');
    const unrelated = await locks.acquire('b');
    beside();
    unrelated();
    holding();
    (await blocked)();
  });

  it('keeps a later change behind an earlier one that overlaps it, although the path is free', async () => {
    const locks = new PathLocks();
    const holding = await locks.acquire('a/x');
    let granted = false;
    const whole = locks.acquire('a');
    const later = locks.acquire('a/y').then((release) => {
      granted = true;
      return release;
    });
    await settle();
    expect(granted).toBe(false);
    holding();
    (await whole)();
    (await later)();
    expect(granted).toBe(true);
  });

  it('drops a waiter whose signal aborts, with its reason, and lets the next one through', async () => {
    const locks = new PathLocks();
    const holding = await locks.acquire('a');
    const controller = new AbortController();
    const reason = new Error('Abandoned.');
    const abandoned = locks.acquire('a', controller.signal);
    const behind = locks.acquire('a');
    controller.abort(reason);
    await expect(abandoned).rejects.toBe(reason);
    holding();
    (await behind)();
    await expect(locks.acquire('a', AbortSignal.abort(reason))).rejects.toBe(reason);
  });
});
