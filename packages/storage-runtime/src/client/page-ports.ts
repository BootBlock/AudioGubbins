/**
 * The ports the page lends the storage worker, and the page's service of the
 * worker's calls on them (ADR-0022).
 *
 * A port is lent for one call to the worker: the call's facade lends what it
 * passes, the worker calls it back by number while it works, and the port is
 * let go once the call settles, as are the sinks and sources the worker opened
 * through it meanwhile, so nothing the page lent outlives the call. A sink let
 * go before it was closed or abandoned is abandoned then, so a call the page
 * gave up on, whose worker may still be writing, leaves no torn file. A call
 * on a port no longer lent fails as the defect it is. A file the page holds is
 * not lent at all: it crosses as itself (`page-operations.ts`).
 */

import type { AssetId } from '@audiogubbins/domain';
import type { AbsenceReason, ExternalFile } from '@audiogubbins/media-store';
import type { ByteSink, ByteSource, ExternalSourceIdentity } from '@audiogubbins/project-format';
import type { DirectoryReader, DirectoryWriter } from '@audiogubbins/storage';

import { Transferring, type Handlers } from '../protocol/operations.js';
import type {
  CrossingBytes,
  CrossingFile,
  CrossingFolder,
  FolderFile,
  HeldFile,
  PageOperations,
  PagePort,
} from '../protocol/page-operations.js';
import type { ClientChannel, StorageOperations } from '../protocol/storage-operations.js';

/** Bytes the page offers: a file it holds, or a source it reads for the worker. */
export type PageBytes = HeldFile | { readonly kind: 'source'; readonly source: ByteSource };

/** A file the person chose, its bytes as the page offers them. */
export type PageFile = Omit<ExternalFile, 'source'> & { readonly bytes: PageBytes };

/** A folder to read: the files a folder input gave, or one the page reads for the worker. */
export type PageFolder =
  | { readonly kind: 'files'; readonly files: readonly FolderFile[] }
  | { readonly kind: 'reader'; readonly reader: DirectoryReader };

/** The file a linked asset was recorded from, where the page can read it, or why not. */
export type PageLocated =
  | { readonly kind: 'found'; readonly file: PageFile }
  | { readonly kind: 'absent'; readonly reason: AbsenceReason };

/** Finds the file a linked asset was recorded from, without asking the person. */
export type PageLocate = (
  asset: AssetId,
  identity: ExternalSourceIdentity,
  signal?: AbortSignal,
) => Promise<PageLocated>;

/** What a call lends the worker, each by the number it gets. */
export interface Lender {
  sink(sink: ByteSink): PagePort;
  bytes(bytes: PageBytes): CrossingBytes;
  file(file: PageFile): CrossingFile;
  folder(folder: PageFolder): CrossingFolder;
  writer(writer: DirectoryWriter): PagePort;
  locate(locate: PageLocate): PagePort;
}

type PageObject =
  | { readonly kind: 'sink'; readonly sink: ByteSink }
  | { readonly kind: 'source'; readonly source: ByteSource }
  | { readonly kind: 'reader'; readonly reader: DirectoryReader }
  | { readonly kind: 'writer'; readonly writer: DirectoryWriter }
  | { readonly kind: 'locate'; readonly locate: PageLocate };

type ObjectOf<TKind extends PageObject['kind']> = Extract<PageObject, { readonly kind: TKind }>;

function isOf<TKind extends PageObject['kind']>(
  object: PageObject,
  kind: TKind,
): object is ObjectOf<TKind> {
  return object.kind === kind;
}

/** The ports one call lent, let go together once it settled. */
interface Call {
  readonly ports: PagePort[];
  settled: boolean;
}

/** Why a sink let go unclosed is abandoned. */
const LET_GO = 'The call the sink was lent for settled before the sink was closed.';

/** The ports lent to the worker, and their service (see the module comment). */
export class PagePorts {
  readonly #lent = new Map<PagePort, { readonly object: PageObject; readonly call: Call }>();
  readonly #unclosed = new Set<PagePort>();
  #next: PagePort = 0;

  /** How many ports are lent now: none while no call is under way. */
  get lent(): number {
    return this.#lent.size;
  }

  /** Runs a call with what it lends, and lets all of it go once it settles. */
  async lending<TValue>(work: (lender: Lender) => Promise<TValue>): Promise<TValue> {
    const call: Call = { ports: [], settled: false };
    try {
      return await work(this.#lenderFor(call));
    } finally {
      call.settled = true;
      await this.#letGo(call);
    }
  }

  /** The service of the worker's calls on the ports lent. */
  handlers(): Handlers<PageOperations> {
    return {
      'sink.write': async ({ port, chunk }) => {
        await this.#object(port, 'sink').sink.write(chunk);
        return undefined;
      },
      'sink.close': async ({ port }) => {
        await this.#object(port, 'sink').sink.close();
        this.#unclosed.delete(port);
        return undefined;
      },
      'sink.abort': async ({ port, reason }) => {
        // A sink let go unclosed was abandoned as it was let go, so the worker,
        // abandoning it as its own work stops, asks nothing more.
        if (port < this.#next && !this.#lent.has(port)) return undefined;
        const { sink } = this.#object(port, 'sink');
        this.#unclosed.delete(port);
        await sink.abort(reason);
        return undefined;
      },
      'source.read': async ({ port, offset, length }, { signal }) => {
        const bytes = await this.#object(port, 'source').source.read(offset, length, signal);
        // The source may keep the buffer it answered with, so a copy crosses.
        const copy = bytes.slice();
        return new Transferring(copy, [copy.buffer]);
      },
      'folder.list': ({ port }, { signal }) => this.#reader(port).list(signal),
      'folder.open': async ({ port, path }) => {
        const call = this.#callOf(port);
        const source = await this.#reader(port).open(path);
        if (source === undefined) return undefined;
        return this.#lenderFor(call).bytes({ kind: 'source', source });
      },
      'folder.create': async ({ port, path }) => {
        const call = this.#callOf(port);
        const sink = await this.#object(port, 'writer').writer.create(path);
        return await this.#lendOpened(sink, call);
      },
      'folder.remove': async ({ port, path }) => {
        await this.#object(port, 'writer').writer.remove(path);
        return undefined;
      },
      'linkedFiles.locate': async ({ port, asset, identity }, { signal }) => {
        const call = this.#callOf(port);
        const located = await this.#object(port, 'locate').locate(asset, identity, signal);
        if (located.kind === 'absent') return located;
        return { kind: 'found', file: this.#lenderFor(call).file(located.file) };
      },
    };
  }

  #lenderFor(call: Call): Lender {
    const lend = (object: PageObject): PagePort => this.#lend(object, call);
    const bytes = (offered: PageBytes): CrossingBytes =>
      offered.kind === 'file'
        ? offered
        : { kind: 'port', port: lend(offered), size: offered.source.size };
    return {
      sink: (sink) => lend({ kind: 'sink', sink }),
      bytes,
      file: ({ bytes: offered, ...described }) => ({ ...described, bytes: bytes(offered) }),
      folder: (folder) => (folder.kind === 'files' ? folder : { kind: 'port', port: lend(folder) }),
      writer: (writer) => lend({ kind: 'writer', writer }),
      locate: (locate) => lend({ kind: 'locate', locate }),
    };
  }

  /** Lends an object for the rest of `call`, which has not settled. */
  #lend(object: PageObject, call: Call): PagePort {
    if (call.settled) throw new Error('The call the port would be lent for has settled.');
    const port = this.#next;
    this.#next += 1;
    this.#lent.set(port, { object, call });
    call.ports.push(port);
    if (object.kind === 'sink') this.#unclosed.add(port);
    return port;
  }

  /**
   * Lends a sink the worker opened, for the rest of `call`. One opened once
   * the call settled, by a call of the worker's still being served then, is
   * abandoned at once, and the worker told.
   */
  async #lendOpened(sink: ByteSink, call: Call): Promise<PagePort> {
    if (call.settled) await sink.abort(LET_GO);
    return this.#lend({ kind: 'sink', sink }, call);
  }

  async #letGo(call: Call): Promise<void> {
    for (const port of call.ports) {
      const lent = this.#lent.get(port);
      this.#lent.delete(port);
      if (lent?.object.kind === 'sink' && this.#unclosed.delete(port)) {
        await lent.object.sink.abort(LET_GO);
      }
    }
  }

  #callOf(port: PagePort): Call {
    const lent = this.#lent.get(port);
    if (lent === undefined) throw notLent(port);
    return lent.call;
  }

  #object<TKind extends PageObject['kind']>(port: PagePort, kind: TKind): ObjectOf<TKind> {
    const object = this.#lent.get(port)?.object;
    if (object === undefined || !isOf(object, kind)) throw notLent(port, kind);
    return object;
  }

  /** A folder to read, lent to be read or to be written. */
  #reader(port: PagePort): DirectoryReader {
    const object = this.#lent.get(port)?.object;
    if (object?.kind === 'reader') return object.reader;
    if (object?.kind === 'writer') return object.writer;
    throw notLent(port, 'folder');
  }
}

/**
 * Calls one of the worker's operations with the argument made with what it
 * lends, which is let go once the call settles.
 */
export type LendingCall = <TName extends keyof StorageOperations>(
  operation: TName,
  argument: (lender: Lender) => StorageOperations[TName]['argument'],
  signal?: AbortSignal,
) => Promise<StorageOperations[TName]['answer']>;

/** The calls that lend through `ports`, over the page's end of the port. */
export function lendingCall(channel: ClientChannel, ports: PagePorts): LendingCall {
  return async (operation, argument, signal) =>
    await ports.lending(
      async (lender) => await channel.call(operation, argument(lender), { signal }),
    );
}

function notLent(port: PagePort, kind = 'port'): Error {
  return new Error(`No ${kind} is lent as port ${String(port)}.`);
}
