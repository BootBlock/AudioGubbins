/**
 * Every operation of the storage tree's port, run in order against a tree, so
 * the tree over the origin-private file system is held to the in-memory
 * reference tree by comparing what each came to.
 */

import { TreeFailure, type StorageTree } from '@audiogubbins/project-format';

export const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);

/** What an operation came to: its value, or the failure it met, by kind. */
async function outcome(operation: () => Promise<unknown>): Promise<unknown> {
  try {
    const value = await operation();
    return value instanceof Uint8Array ? { bytes: [...value] } : { value };
  } catch (error) {
    if (error instanceof TreeFailure) return { failure: error.kind };
    if (error instanceof Error) return { thrown: error.constructor.name };
    throw error;
  }
}

/**
 * Every operation of the port, including the edges the port promises, run in
 * order against a tree, and what each came to.
 */
export async function scenario(tree: StorageTree): Promise<readonly unknown[]> {
  const results: unknown[] = [];
  const record = async (operation: () => Promise<unknown>): Promise<void> => {
    results.push(await outcome(operation));
  };

  await record(() => tree.readFile('a/b.bin'));
  await record(() => tree.list(''));
  await record(() => tree.writeFile('a/b.bin', bytes(1, 2, 3)));
  await record(() => tree.readFile('a/b.bin'));
  await record(() => tree.writeFile('a/c/d.bin', bytes(4, 5, 6, 7, 8)));
  await record(() => tree.list(''));
  await record(() => tree.list('a'));
  await record(() => tree.writeFile('a/b.bin', bytes(9)));
  await record(() => tree.readFile('a/b.bin'));

  const source = await tree.openFile('a/c/d.bin');
  results.push(source?.size);
  await record(() => source?.read(1, 2) ?? Promise.resolve());
  await record(() => source?.read(3, 10) ?? Promise.resolve());

  const sink = await tree.createFile('a/e.bin');
  await sink.write(bytes(10, 11));
  // A file exists from its creation and grows as it is written.
  await record(() => tree.readFile('a/e.bin'));
  await sink.write(bytes(12));
  await sink.close();
  await record(() => tree.readFile('a/e.bin'));
  await record(() => sink.write(bytes(13)));

  const abandoned = await tree.createFile('a/b.bin');
  await abandoned.write(bytes(14, 15));
  await abandoned.abort();
  await record(() => tree.readFile('a/b.bin'));

  await record(() => tree.writeFile('a/c', bytes(1)));
  await record(() => tree.writeFile('a/e.bin/x', bytes(1)));
  await record(() => tree.list('a/e.bin'));
  await record(() => tree.list('nothing/here'));
  await record(() => tree.openFile('nothing'));

  const vanishing = await tree.openFile('a/e.bin');
  await tree.remove('a/e.bin');
  await record(() => vanishing?.read(0, 3) ?? Promise.resolve());

  await record(() => tree.remove('a/c'));
  await record(() => tree.list('a'));
  await record(() => tree.remove('never'));
  await record(() => tree.writeFile('z.bin', bytes(1)));
  await record(() => tree.remove(''));
  await record(() => tree.list(''));

  await record(() => tree.readFile(''));
  await record(() => tree.readFile('A'));
  await record(() => tree.writeFile('a/../b', bytes(1)));
  await record(() => tree.list('a//b'));
  await record(() => tree.createFile(''));
  return results;
}
