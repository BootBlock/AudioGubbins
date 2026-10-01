import { describe, expect, it } from 'vitest';

import { MemoryStorageTree } from '@audiogubbins/media-store/testing';

import { TurnTakingTree, turnsEvery } from './host-turns.js';

describe('turns given in slices of time', () => {
  it('gives a turn only once a slice has run since the last', async () => {
    let now = 100;
    let given = 0;
    const turn = turnsEvery(
      8,
      () => now,
      () => {
        given += 1;
        return Promise.resolve();
      },
    );

    await turn();
    now = 107;
    await turn();
    expect(given).toBe(0);

    now = 108;
    await turn();
    expect(given).toBe(1);

    now = 115;
    await turn();
    expect(given).toBe(1);
    now = 116;
    await turn();
    expect(given).toBe(2);
  });
});

describe('a tree that takes turns', () => {
  it('takes one before each operation, and does what was asked', async () => {
    const turns: string[] = [];
    const inner = new MemoryStorageTree();
    let doing = 'nothing';
    const tree = new TurnTakingTree(inner, () => {
      turns.push(doing);
      return Promise.resolve();
    });

    doing = 'write';
    await tree.writeFile('a/b', Uint8Array.from([1, 2]));
    doing = 'create';
    const sink = await tree.createFile('a/c');
    await sink.write(Uint8Array.from([3]));
    await sink.close();
    doing = 'read';
    expect(Array.from((await tree.readFile('a/b')) ?? [])).toEqual([1, 2]);
    doing = 'open';
    expect((await tree.openFile('a/c'))?.size).toBe(1);
    doing = 'list';
    expect((await tree.list('a')).map((entry) => entry.name)).toEqual(['b', 'c']);
    doing = 'remove';
    await tree.remove('a');

    expect(turns).toEqual(['write', 'create', 'read', 'open', 'list', 'remove']);
    expect(inner.paths()).toEqual([]);
  });
});
