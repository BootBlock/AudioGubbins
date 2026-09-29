import { nodeDigest } from '@audiogubbins/media-store/testing';
import { describe, expect, it } from 'vitest';

import { yieldToHost } from './host-yielding.js';
import { webDigest } from './web-digest.js';

describe('the digest over Web Crypto', () => {
  it('is SHA-256, as the reference digest is', async () => {
    const bytes = new TextEncoder().encode('AudioGubbins');
    expect(await webDigest(crypto.subtle)(bytes)).toEqual(await nodeDigest(bytes));
  });
});

describe('giving the page a turn', () => {
  it("uses the scheduler's own yield where the browser has one", async () => {
    let yielded = 0;
    const turn = yieldToHost({
      kind: 'scheduler',
      yieldNow: () => {
        yielded += 1;
        return Promise.resolve();
      },
    });
    await turn();
    await turn();
    expect(yielded).toBe(2);
  });

  it('otherwise waits for a message it posts itself, on one channel, resuming in order', async () => {
    let channels = 0;
    const turn = yieldToHost({
      kind: 'macrotask',
      createChannel: () => {
        channels += 1;
        return new MessageChannel();
      },
    });
    const order: string[] = [];
    const tasks = [turn().then(() => order.push('first')), turn().then(() => order.push('second'))];
    // A microtask queued now runs before either turn is given back.
    await Promise.resolve().then(() => order.push('microtask'));
    await Promise.all(tasks);
    expect(order).toEqual(['microtask', 'first', 'second']);
    expect(channels).toBe(1);
  });

  it('gives each turn back at once where the browser offers neither', async () => {
    await expect(yieldToHost({ kind: 'none' })()).resolves.toBeUndefined();
  });
});
