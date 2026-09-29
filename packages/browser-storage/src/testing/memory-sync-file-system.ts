/**
 * The storage worker's file-system port held in memory, as strict as the
 * origin-private file system it stands in for, for the tests of the handler and
 * of the tree over it.
 *
 * Strict where it matters to the tree: an entry of the wrong kind is a
 * `TypeMismatchError` and a missing one a `NotFoundError`; an access handle is
 * exclusive, so a second opening of a file, or the removal of a file or a
 * directory holding one that is open, is a `NoModificationAllowedError`; and a
 * quota refuses, before changing anything, any write or growth that would take
 * what is held past it. Every operation is asynchronous, opening takes several
 * turns and a write a whole task, so a handler that did not order its changes
 * would meet the exclusivity or land them out of order. A refusal of any
 * operation can be injected by name.
 */

import { compareCodeUnits, type TreeEntry } from '@audiogubbins/project-format';

import type { FileSnapshot, SyncDirectory, SyncFile, SyncFileEntry } from '../sync-file-system.js';

/** The operations a refusal can be injected into. */
export type SyncOperation =
  | 'directory'
  | 'file'
  | 'remove'
  | 'entries'
  | 'snapshot'
  | 'open'
  | 'write'
  | 'truncate'
  | 'flush'
  | 'close';

/** The failures to inject. */
export interface MemorySyncOptions {
  /** The most bytes the file system holds, across every file. */
  readonly quotaBytes?: number;

  /** The refusal an operation on the named entry meets, where there is one. */
  readonly refuse?: (operation: SyncOperation, name: string) => DOMException | undefined;
}

class FileNode {
  bytes = new Uint8Array(0);
  open = false;
}

class DirectoryNode {
  readonly children = new Map<string, FileNode | DirectoryNode>();
}

function refusal(message: string, name: string): DOMException {
  return new DOMException(message, name);
}

async function turn(): Promise<void> {
  await Promise.resolve();
}

/** Whether a node is, or holds, a file with an access handle open. */
function holdsOpen(node: FileNode | DirectoryNode): boolean {
  if (node instanceof FileNode) return node.open;
  return [...node.children.values()].some(holdsOpen);
}

/** The whole file system in memory (see the module comment). */
export class MemorySyncFileSystem {
  readonly #root = new DirectoryNode();
  readonly #options: MemorySyncOptions;

  constructor(options: MemorySyncOptions = {}) {
    this.#options = options;
  }

  /** The root directory, as the port. */
  root(): SyncDirectory {
    return this.#directory(this.#root);
  }

  /** Every file's path and bytes, sorted by path. */
  files(): ReadonlyMap<string, Uint8Array> {
    const found: [string, Uint8Array][] = [];
    const walk = (node: DirectoryNode, prefix: string): void => {
      for (const [name, child] of node.children) {
        const path = prefix === '' ? name : `${prefix}/${name}`;
        if (child instanceof FileNode) found.push([path, child.bytes.slice()]);
        else walk(child, path);
      }
    };
    walk(this.#root, '');
    return new Map(found.sort(([one], [other]) => compareCodeUnits(one, other)));
  }

  /** Puts an entry the tree could not have written, as another program might. */
  plant(name: string): void {
    this.#root.children.set(name, new FileNode());
  }

  #refuse(operation: SyncOperation, name: string): void {
    const refused = this.#options.refuse?.(operation, name);
    if (refused !== undefined) throw refused;
  }

  #held(): number {
    let total = 0;
    const walk = (node: DirectoryNode): void => {
      for (const child of node.children.values()) {
        if (child instanceof FileNode) total += child.bytes.length;
        else walk(child);
      }
    };
    walk(this.#root);
    return total;
  }

  #refuseBeyondQuota(growth: number): void {
    const { quotaBytes } = this.#options;
    if (quotaBytes !== undefined && this.#held() + growth > quotaBytes) {
      throw refusal('The simulated storage is full.', 'QuotaExceededError');
    }
  }

  #directory(node: DirectoryNode): SyncDirectory {
    return {
      directory: async (name, create) => {
        await turn();
        this.#refuse('directory', name);
        const child = node.children.get(name);
        if (child instanceof DirectoryNode) return this.#directory(child);
        if (child !== undefined) throw refusal(`${name} is a file.`, 'TypeMismatchError');
        if (!create) throw refusal(`${name} is not there.`, 'NotFoundError');
        const made = new DirectoryNode();
        node.children.set(name, made);
        return this.#directory(made);
      },
      file: async (name, create) => {
        await turn();
        this.#refuse('file', name);
        const child = node.children.get(name);
        if (child instanceof FileNode) return this.#file(child, name);
        if (child !== undefined) throw refusal(`${name} is a directory.`, 'TypeMismatchError');
        if (!create) throw refusal(`${name} is not there.`, 'NotFoundError');
        const made = new FileNode();
        node.children.set(name, made);
        return this.#file(made, name);
      },
      remove: async (name) => {
        await turn();
        this.#refuse('remove', name);
        const child = node.children.get(name);
        if (child === undefined) throw refusal(`${name} is not there.`, 'NotFoundError');
        if (holdsOpen(child)) {
          throw refusal(`${name} has a file open.`, 'NoModificationAllowedError');
        }
        node.children.delete(name);
      },
      entries: async function* () {
        // Newest first, so a handler that did not sort would be seen not to.
        const listed: TreeEntry[] = [...node.children].map(([name, child]) => ({
          name,
          kind: child instanceof FileNode ? 'file' : 'directory',
        }));
        for (const entry of listed.reverse()) {
          await turn();
          yield entry;
        }
      },
    };
  }

  #file(node: FileNode, name: string): SyncFileEntry {
    return {
      snapshot: async (): Promise<FileSnapshot> => {
        await turn();
        this.#refuse('snapshot', name);
        const bytes = node.bytes.slice();
        return {
          size: bytes.length,
          read: async (offset, length) => {
            await turn();
            return bytes.slice(offset, offset + length);
          },
        };
      },
      open: async () => {
        await turn();
        await turn();
        await turn();
        this.#refuse('open', name);
        if (node.open) throw refusal(`${name} is already open.`, 'NoModificationAllowedError');
        node.open = true;
        return this.#access(node, name);
      },
    };
  }

  #access(node: FileNode, name: string): SyncFile {
    let closed = false;
    const usable = (operation: SyncOperation): void => {
      if (closed) throw refusal('The access handle is closed.', 'InvalidStateError');
      this.#refuse(operation, name);
    };
    return {
      write: async (bytes, at) => {
        // A task rather than a turn, as a disk takes, so the page's next
        // message arrives before this write lands.
        await new Promise((resolve) => setTimeout(resolve, 0));
        usable('write');
        const end = at + bytes.length;
        this.#refuseBeyondQuota(Math.max(0, end - node.bytes.length));
        if (end > node.bytes.length) {
          const grown = new Uint8Array(end);
          grown.set(node.bytes);
          node.bytes = grown;
        }
        node.bytes.set(bytes, at);
        return bytes.length;
      },
      truncate: async (size) => {
        await turn();
        usable('truncate');
        this.#refuseBeyondQuota(Math.max(0, size - node.bytes.length));
        const resized = new Uint8Array(size);
        resized.set(node.bytes.subarray(0, Math.min(size, node.bytes.length)));
        node.bytes = resized;
      },
      flush: async () => {
        await turn();
        usable('flush');
      },
      close: async () => {
        await turn();
        this.#refuse('close', name);
        closed = true;
        node.open = false;
      },
    };
  }
}
