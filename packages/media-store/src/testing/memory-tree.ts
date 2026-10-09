/**
 * A {@link StorageTree} held in memory, faithful to what the port promises and
 * to what it does not, for the tests of everything stored through it.
 *
 * Faithful, because a fake kinder than the platform proves nothing: a file
 * exists from the moment it is created and grows as it is written, so a crash
 * leaves it torn; creating a file replaces any there; a directory exists while
 * anything is in it; a listing is sorted; removal takes a directory whole; a
 * read of a file that has since shrunk or gone comes back short; and a path of
 * an invalid segment is refused as a programmer error.
 *
 * Two failures can be injected. A crash at the operation numbered `crashAt`
 * (counted from 1 over every call, each sink write and each range read
 * included) tears that operation, so a write keeps half its bytes, and every
 * operation after it throws {@link SimulatedCrash};
 * {@link MemoryStorageTree.restarted} is the tree as the storage would be found
 * on the next start. A whole-file write tears as `tornWrite` says: cut short,
 * or at its full length with zeros after the half written, as the browser's
 * tree leaves one it sizes before writing. A sink's write always tears short,
 * since a sink's file only grows. A quota refuses, with the tree's `quota`
 * failure and before writing anything, any write that would take what the tree
 * holds past it.
 */

import {
  TreeFailure,
  TreeFailureKind,
  compareCodeUnits,
  isTreePath,
  type ByteSink,
  type ByteSource,
  type StorageTree,
  type TreeEntry,
} from '@audiogubbins/project-format';

/** What a crash injected into the tree throws, from the operation it tears on. */
export class SimulatedCrash extends Error {
  constructor() {
    super('The simulated storage crashed.');
    this.name = 'SimulatedCrash';
  }
}

/** How a torn whole-file write is left: cut short, or at its full length. */
export type TornWrite = 'short' | 'full-length';

/** The failures to inject. */
export interface MemoryTreeOptions {
  /** The operation, counted from 1, at which the tree crashes. */
  readonly crashAt?: number;

  /** How a whole-file write the crash tears is left: `short` where not given. */
  readonly tornWrite?: TornWrite;

  /** The most bytes the tree holds, across every file. */
  readonly quotaBytes?: number;
}

/** A file's bytes, grown in place as a sink writes them. */
class FileBody {
  bytes = new Uint8Array(0);
  length = 0;

  static of(bytes: Uint8Array): FileBody {
    const body = new FileBody();
    body.append(bytes);
    return body;
  }

  append(chunk: Uint8Array): void {
    if (this.length + chunk.length > this.bytes.length) {
      const grown = new Uint8Array(Math.max(this.length + chunk.length, this.bytes.length * 2));
      grown.set(this.bytes.subarray(0, this.length));
      this.bytes = grown;
    }
    this.bytes.set(chunk, this.length);
    this.length += chunk.length;
  }

  slice(start: number, end: number): Uint8Array<ArrayBuffer> {
    return this.bytes.slice(Math.min(start, this.length), Math.min(end, this.length));
  }
}

/** A storage tree in memory (see the module comment). */
export class MemoryStorageTree implements StorageTree {
  private readonly files: Map<string, FileBody>;
  private readonly options: MemoryTreeOptions;
  private count = 0;
  private crashed = false;

  constructor(options: MemoryTreeOptions = {}, files: ReadonlyMap<string, Uint8Array> = new Map()) {
    this.options = options;
    this.files = new Map([...files].map(([path, bytes]) => [path, FileBody.of(bytes)]));
  }

  /** The operations called so far. */
  get operations(): number {
    return this.count;
  }

  /** What the tree holds, as a new tree with the given failures and none of this one's. */
  restarted(options: MemoryTreeOptions = {}): MemoryStorageTree {
    return new MemoryStorageTree(options, this.snapshot());
  }

  /** Every file's path, sorted. */
  paths(): readonly string[] {
    return [...this.files.keys()].sort(compareCodeUnits);
  }

  /** Every file and its bytes, copied. */
  snapshot(): ReadonlyMap<string, Uint8Array<ArrayBuffer>> {
    return new Map([...this.files].map(([path, body]) => [path, body.slice(0, body.length)]));
  }

  async readFile(path: string): Promise<Uint8Array<ArrayBuffer> | undefined> {
    checkedFilePath(path);
    await this.step();
    const body = this.files.get(path);
    return body?.slice(0, body.length);
  }

  async openFile(path: string): Promise<ByteSource | undefined> {
    checkedFilePath(path);
    await this.step();
    const body = this.files.get(path);
    if (body === undefined) return undefined;
    return {
      size: body.length,
      read: async (offset, length, signal) => {
        signal?.throwIfAborted();
        if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0) {
          throw new RangeError('A range is read from a whole offset for a whole length.');
        }
        await this.step();
        return this.files.get(path)?.slice(offset, offset + length) ?? new Uint8Array(0);
      },
    };
  }

  async writeFile(path: string, bytes: Uint8Array): Promise<void> {
    this.checkedWritable(path);
    const torn = await this.tick();
    this.refuseBeyondQuota(bytes.length - (this.files.get(path)?.length ?? 0));
    this.files.set(path, FileBody.of(torn ? this.tornFrom(bytes) : bytes));
    if (torn) throw new SimulatedCrash();
  }

  async createFile(path: string): Promise<ByteSink> {
    this.checkedWritable(path);
    await this.step();
    const body = new FileBody();
    this.files.set(path, body);
    let open = true;
    const whileOpen = (): void => {
      if (!open) throw new Error('A sink cannot be used once it is closed or aborted.');
    };
    return {
      write: async (chunk) => {
        whileOpen();
        const torn = await this.tick();
        this.refuseBeyondQuota(chunk.length);
        body.append(torn ? chunk.subarray(0, chunk.length >> 1) : chunk);
        if (torn) throw new SimulatedCrash();
      },
      close: async () => {
        whileOpen();
        await this.step();
        open = false;
      },
      abort: async () => {
        whileOpen();
        await this.step();
        open = false;
        if (this.files.get(path) === body) this.files.delete(path);
      },
    };
  }

  async remove(path: string): Promise<void> {
    checkedPath(path);
    await this.step();
    for (const file of [...this.files.keys()]) {
      if (path === '' || file === path || file.startsWith(`${path}/`)) this.files.delete(file);
    }
  }

  async list(directory: string): Promise<readonly TreeEntry[]> {
    checkedPath(directory);
    await this.step();
    const prefix = directory === '' ? '' : `${directory}/`;
    const entries = new Map<string, TreeEntry['kind']>();
    for (const file of this.files.keys()) {
      if (!file.startsWith(prefix)) continue;
      const [name = '', ...deeper] = file.slice(prefix.length).split('/');
      entries.set(name, deeper.length > 0 ? 'directory' : 'file');
    }
    return [...entries]
      .map(([name, kind]) => ({ name, kind }))
      .sort((one, other) => compareCodeUnits(one.name, other.name));
  }

  /** What a torn whole-file write of `bytes` leaves. */
  private tornFrom(bytes: Uint8Array): Uint8Array {
    const half = bytes.subarray(0, bytes.length >> 1);
    if (this.options.tornWrite !== 'full-length') return half;
    const sized = new Uint8Array(bytes.length);
    sized.set(half);
    return sized;
  }

  /** Counts an operation that cannot tear, and crashes on the one numbered `crashAt`. */
  private async step(): Promise<void> {
    if (await this.tick()) throw new SimulatedCrash();
  }

  /**
   * Counts an operation, and says whether it is the one numbered `crashAt`,
   * which its caller tears. Asynchronous, as every operation of a real tree
   * is, so no caller can come to rely on one finishing within its call.
   */
  private async tick(): Promise<boolean> {
    await Promise.resolve();
    if (this.crashed) throw new SimulatedCrash();
    this.count += 1;
    if (this.count !== this.options.crashAt) return false;
    this.crashed = true;
    return true;
  }

  private refuseBeyondQuota(growth: number): void {
    const { quotaBytes } = this.options;
    if (quotaBytes === undefined) return;
    let held = 0;
    for (const body of this.files.values()) held += body.length;
    if (held + growth > quotaBytes) {
      throw new TreeFailure(TreeFailureKind.Quota, 'The simulated storage is full.');
    }
  }

  /** A path a file can be written at: not a directory, and under no file. */
  private checkedWritable(path: string): void {
    checkedFilePath(path);
    const segments = path.split('/');
    const underFile = segments.some((_, index) =>
      this.files.has(segments.slice(0, index).join('/')),
    );
    const isDirectory = [...this.files.keys()].some((file) => file.startsWith(`${path}/`));
    if (underFile || isDirectory) {
      throw new TreeFailure(TreeFailureKind.Io, 'A file cannot stand where a directory does.');
    }
  }
}

function checkedPath(path: string): void {
  if (!isTreePath(path)) throw new Error(`Not a tree path: ${path}`);
}

function checkedFilePath(path: string): void {
  if (path === '') throw new Error('The root of the tree is not a file.');
  checkedPath(path);
}
