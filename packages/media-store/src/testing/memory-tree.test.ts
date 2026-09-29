import { describe, expect, it } from 'vitest';

import { TreeFailure } from '@audiogubbins/project-format';

import { MemoryStorageTree, SimulatedCrash } from './memory-tree.js';

const bytes = (...values: readonly number[]): Uint8Array<ArrayBuffer> => new Uint8Array(values);

describe('the in-memory storage tree', () => {
  it('lists a directory sorted, with each entry once and its kind', async () => {
    const tree = new MemoryStorageTree();
    await tree.writeFile('b/z.json', bytes(1));
    await tree.writeFile('b/a/deep.json', bytes(2));
    await tree.writeFile('b/a/deeper/x', bytes(3));
    await tree.writeFile('a.json', bytes(4));

    expect(await tree.list('')).toEqual([
      { name: 'a.json', kind: 'file' },
      { name: 'b', kind: 'directory' },
    ]);
    expect(await tree.list('b')).toEqual([
      { name: 'a', kind: 'directory' },
      { name: 'z.json', kind: 'file' },
    ]);
    expect(await tree.list('missing')).toEqual([]);
  });

  it('removes a directory whole, and takes an absent path as removed', async () => {
    const tree = new MemoryStorageTree();
    await tree.writeFile('a/b/c', bytes(1));
    await tree.writeFile('a/d', bytes(2));
    await tree.writeFile('ab', bytes(3));

    await tree.remove('a');
    await tree.remove('nothing/here');

    expect(tree.paths()).toEqual(['ab']);
  });

  it('makes a file exist from its creation, growing as it is written, and replaces one there', async () => {
    const tree = new MemoryStorageTree();
    await tree.writeFile('f', bytes(9, 9, 9, 9));
    const sink = await tree.createFile('f');
    expect(await tree.readFile('f')).toEqual(bytes());

    await sink.write(bytes(1, 2));
    expect(await tree.readFile('f')).toEqual(bytes(1, 2));
    await sink.close();
    await expect(sink.write(bytes(3))).rejects.toThrow('closed or aborted');
  });

  it('abandons what an aborted sink wrote', async () => {
    const tree = new MemoryStorageTree();
    const sink = await tree.createFile('f');
    await sink.write(bytes(1));
    await sink.abort();

    expect(tree.paths()).toEqual([]);
  });

  it('reads short where the file shrank or went after it was opened', async () => {
    const tree = new MemoryStorageTree();
    await tree.writeFile('f', bytes(1, 2, 3, 4));
    const source = await tree.openFile('f');
    await tree.writeFile('f', bytes(1, 2));

    expect(source?.size).toBe(4);
    expect(await source?.read(0, 4)).toEqual(bytes(1, 2));
    await tree.remove('f');
    expect(await source?.read(0, 4)).toEqual(bytes());
    expect(await tree.openFile('f')).toBeUndefined();
  });

  it('refuses an invalid path as a programmer error, and a file where a directory stands', async () => {
    const tree = new MemoryStorageTree();
    await tree.writeFile('a/b', bytes(1));

    await expect(tree.writeFile('../x', bytes(1))).rejects.toThrow('Not a tree path');
    await expect(tree.readFile('')).rejects.toThrow('not a file');
    await expect(tree.writeFile('a', bytes(1))).rejects.toBeInstanceOf(TreeFailure);
    await expect(tree.writeFile('a/b/c', bytes(1))).rejects.toBeInstanceOf(TreeFailure);
  });

  it('tears the write it crashes on, and fails everything after it', async () => {
    const tree = new MemoryStorageTree({ crashAt: 3 });
    await tree.writeFile('a', bytes(1, 2));
    const sink = await tree.createFile('b');

    await expect(sink.write(bytes(1, 2, 3, 4))).rejects.toBeInstanceOf(SimulatedCrash);
    await expect(tree.readFile('a')).rejects.toBeInstanceOf(SimulatedCrash);
    expect(tree.operations).toBe(3);
    const restarted = tree.restarted();
    expect(await restarted.readFile('b')).toEqual(bytes(1, 2));
    expect(await restarted.readFile('a')).toEqual(bytes(1, 2));
  });

  it('crashes on an operation that writes nothing, without effect', async () => {
    const tree = new MemoryStorageTree({ crashAt: 2 });
    await tree.writeFile('a', bytes(1));

    await expect(tree.remove('a')).rejects.toBeInstanceOf(SimulatedCrash);
    expect(tree.restarted().paths()).toEqual(['a']);
  });

  it('refuses a write past its quota before writing any of it', async () => {
    const tree = new MemoryStorageTree({ quotaBytes: 4 });
    await tree.writeFile('a', bytes(1, 2, 3));
    const sink = await tree.createFile('b');

    await expect(sink.write(bytes(1, 2))).rejects.toMatchObject({ kind: 'quota' });
    await tree.writeFile('a', bytes(1, 2, 3, 4));
    expect(await tree.readFile('b')).toEqual(bytes());
    await expect(tree.writeFile('a', bytes(1, 2, 3, 4, 5))).rejects.toMatchObject({
      kind: 'quota',
    });
    expect(await tree.readFile('a')).toEqual(bytes(1, 2, 3, 4));
  });
});
