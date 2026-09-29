import { describe, expect, it } from 'vitest';

import { ExclusionGate, KeyedQueue } from './exclusion-gate.js';

/** A promise to be settled by the test, and a way to settle it. */
function pending(): { readonly promise: Promise<void>; readonly settle: () => void } {
  let settle = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

/** Lets every settled promise's reactions run. */
async function drained(): Promise<void> {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
}

describe('the exclusion gate', () => {
  it('lets shared work overlap, and keeps exclusive work apart from all of it', async () => {
    const gate = new ExclusionGate();
    const events: string[] = [];
    const first = pending();
    const second = pending();

    const one = gate.shared(async () => {
      events.push('one starts');
      await first.promise;
      events.push('one ends');
    });
    const two = gate.shared(async () => {
      events.push('two starts');
      await second.promise;
      events.push('two ends');
    });
    const alone = gate.exclusive(async () => {
      events.push('alone');
      await Promise.resolve();
    });
    await drained();
    expect(events).toEqual(['one starts', 'two starts']);

    first.settle();
    await drained();
    expect(events).toEqual(['one starts', 'two starts', 'one ends']);
    second.settle();
    await Promise.all([one, two, alone]);
    expect(events).toEqual(['one starts', 'two starts', 'one ends', 'two ends', 'alone']);
  });

  it('admits a waiting exclusive holder before shared work that arrived after it', async () => {
    const gate = new ExclusionGate();
    const events: string[] = [];
    const running = pending();

    const first = gate.shared(async () => {
      await running.promise;
      events.push('first');
    });
    const exclusive = gate.exclusive(async () => {
      events.push('exclusive');
      await Promise.resolve();
    });
    const later = gate.shared(async () => {
      events.push('later');
      await Promise.resolve();
    });
    running.settle();
    await Promise.all([first, exclusive, later]);

    expect(events).toEqual(['first', 'exclusive', 'later']);
  });

  it('opens again after work that fails', async () => {
    const gate = new ExclusionGate();

    await expect(gate.exclusive(() => Promise.reject(new Error('broke')))).rejects.toThrow('broke');

    expect(await gate.exclusive(() => Promise.resolve('open'))).toBe('open');
  });
});

describe('the keyed queue', () => {
  it('runs work of one key in turn, even after a failure, and work of two keys at once', async () => {
    const queue = new KeyedQueue<string>();
    const events: string[] = [];
    const held = pending();

    const first = queue.run('a', async () => {
      events.push('a1 starts');
      await held.promise;
      throw new Error('a1 failed');
    });
    const second = queue.run('a', async () => {
      events.push('a2 runs');
      await Promise.resolve();
    });
    const other = queue.run('b', async () => {
      events.push('b runs');
      await Promise.resolve();
    });
    await other;
    expect(events).toEqual(['a1 starts', 'b runs']);

    held.settle();
    await expect(first).rejects.toThrow('a1 failed');
    await second;
    expect(events).toEqual(['a1 starts', 'b runs', 'a2 runs']);
  });
});
