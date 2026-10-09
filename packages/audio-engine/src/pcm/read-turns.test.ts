import { describe, expect, it } from 'vitest';

import { Cancelled, createCancellationSource } from '@audiogubbins/domain';

import { ReadTurns } from './read-turns.js';

/** A read that starts when its turn comes and settles when the test says. */
function heldRead(log: string[], name: string) {
  let settle: (failure?: Error) => void = () => undefined;
  const read = (): Promise<string> =>
    new Promise<string>((resolve, reject) => {
      log.push(`${name} started`);
      settle = (failure) => {
        log.push(`${name} settled`);
        if (failure === undefined) resolve(name);
        else reject(failure);
      };
    });
  return {
    read,
    settle: (failure?: Error) => {
      settle(failure);
    },
  };
}

/** Lets every callback already due run. */
async function drained(): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
}

describe('the turns a source gives its reads', () => {
  it('runs one read at a time, in the order they were made, whether the one before answered or failed', async () => {
    const turns = new ReadTurns();
    const log: string[] = [];
    const first = heldRead(log, 'first');
    const second = heldRead(log, 'second');
    const third = heldRead(log, 'third');
    const answers = [first, second, third].map((one) => turns.take(one.read));
    const settled = Promise.allSettled(answers);
    await drained();
    expect(log).toEqual(['first started']);

    first.settle(new Error('The file went away.'));
    await drained();
    expect(log).toEqual(['first started', 'first settled', 'second started']);

    second.settle();
    await drained();
    third.settle();
    expect((await settled).map((one) => one.status)).toEqual([
      'rejected',
      'fulfilled',
      'fulfilled',
    ]);
    expect(log).toEqual([
      'first started',
      'first settled',
      'second started',
      'second settled',
      'third started',
      'third settled',
    ]);
  });

  it('rejects a read cancelled while it waits at once, never runs it, and keeps the next waiting for the one running', async () => {
    const turns = new ReadTurns();
    const log: string[] = [];
    const running = heldRead(log, 'running');
    const cancelled = heldRead(log, 'cancelled');
    const next = heldRead(log, 'next');
    const stop = createCancellationSource();
    const answer = turns.take(running.read);
    const withdrawn = turns.take(cancelled.read, stop.signal);
    const after = turns.take(next.read);
    await drained();

    stop.cancel(new Cancelled('The view closed.'));

    await expect(withdrawn).rejects.toThrow('The view closed.');
    await drained();
    expect(log).toEqual(['running started']);
    running.settle();
    await drained();
    next.settle();
    await expect(answer).resolves.toBe('running');
    await expect(after).resolves.toBe('next');
    expect(log).toEqual(['running started', 'running settled', 'next started', 'next settled']);
  });
});
