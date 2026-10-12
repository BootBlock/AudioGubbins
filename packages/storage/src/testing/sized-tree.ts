/**
 * A storage tree that keeps the length of each file written through a sink,
 * and none of its bytes, for a test of a file past four gibibytes that no test
 * host could hold: such a file reads back as zeros of its length. A file
 * written whole, such as an export's head, is kept as it was written. A
 * removal takes the path and everything under it, as a directory's does.
 */

import type { ByteSink, ByteSource, StorageTree, TreeEntry } from '@audiogubbins/project-format';

/** A file: its bytes where it was written whole, its length alone where it was streamed. */
type Kept =
  | { readonly kind: 'bytes'; readonly bytes: Uint8Array }
  | { readonly kind: 'length'; readonly length: number };

/** A tree keeping lengths, not bytes, of streamed files (see the module comment). */
export class SizedTree implements StorageTree {
  private readonly files = new Map<string, Kept>();

  readFile(path: string): Promise<Uint8Array<ArrayBuffer> | undefined> {
    const kept = this.files.get(path);
    if (kept === undefined) return Promise.resolve(undefined);
    return Promise.resolve(
      kept.kind === 'bytes' ? Uint8Array.from(kept.bytes) : new Uint8Array(kept.length),
    );
  }

  openFile(path: string): Promise<ByteSource | undefined> {
    const kept = this.files.get(path);
    if (kept === undefined) return Promise.resolve(undefined);
    const size = kept.kind === 'bytes' ? kept.bytes.length : kept.length;
    return Promise.resolve({
      size,
      read: (offset, length) => {
        const end = Math.min(size, offset + length);
        return Promise.resolve(
          kept.kind === 'bytes'
            ? Uint8Array.from(kept.bytes.subarray(offset, end))
            : new Uint8Array(Math.max(0, end - offset)),
        );
      },
    });
  }

  writeFile(path: string, bytes: Uint8Array): Promise<void> {
    this.files.set(path, { kind: 'bytes', bytes: Uint8Array.from(bytes) });
    return Promise.resolve();
  }

  createFile(path: string): Promise<ByteSink> {
    let length = 0;
    return Promise.resolve({
      write: (chunk) => {
        length += chunk.length;
        return Promise.resolve();
      },
      close: () => {
        this.files.set(path, { kind: 'length', length });
        return Promise.resolve();
      },
      abort: () => Promise.resolve(),
    });
  }

  remove(path: string): Promise<void> {
    for (const kept of [...this.files.keys()]) {
      if (kept === path || kept.startsWith(`${path}/`)) this.files.delete(kept);
    }
    return Promise.resolve();
  }

  list(directory: string): Promise<readonly TreeEntry[]> {
    const prefix = directory === '' ? '' : `${directory}/`;
    const names = new Map<string, TreeEntry['kind']>();
    for (const path of this.files.keys()) {
      if (!path.startsWith(prefix)) continue;
      const [name, ...rest] = path.slice(prefix.length).split('/');
      if (name !== undefined) names.set(name, rest.length > 0 ? 'directory' : 'file');
    }
    return Promise.resolve([...names].map(([name, kind]) => ({ name, kind })));
  }
}
