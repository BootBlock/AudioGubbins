/**
 * The ports the page lent the storage worker, as the storage's own ports: a
 * sink, a source, a folder to read or write, the backups folder and the search
 * for a linked file, each calling the page by the number it was lent as
 * (ADR-0022).
 *
 * The storage works through these as through any other, so a refusal the page
 * meets, such as a file system refusing a write, reaches the storage as the
 * refusal of the tree it is and is reported as the storage reports any. A chunk
 * written is copied once, since the writer may keep its buffer, into a batch of
 * small writes or alone, and the copy crosses transferred. A file the page
 * holds crosses as itself and is read here, as the page would read it, so its
 * bytes never cross the port.
 */

import { fileSource, listedFolder } from '@audiogubbins/browser-storage';
import type { ExternalFile } from '@audiogubbins/media-store';
import type { ByteSink, ByteSource } from '@audiogubbins/project-format';
import type {
  ConsolidationServices,
  DirectoryReader,
  DirectoryWriter,
  ExternalBackupTarget,
} from '@audiogubbins/storage';

import type {
  CrossingBytes,
  CrossingFile,
  CrossingFolder,
  PagePort,
} from '../protocol/page-operations.js';
import type { HostChannel } from '../protocol/storage-operations.js';

/**
 * Why a sink was abandoned, as text, which crosses whatever the reason was: an
 * error's message, or a failure's summary, as the storage abandons a sink.
 */
function reasonText(reason: unknown): string | undefined {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === 'string') return reason;
  if (typeof reason !== 'object' || reason === null || !('summary' in reason)) return undefined;
  return typeof reason.summary === 'string' ? reason.summary : undefined;
}

/**
 * How many bytes a sink gathers before it hands them to the page. A ZIP is
 * written in many small pieces, its headers among them, which would each cost
 * a round trip to the page; gathered, they cross together, while a chunk this
 * large crosses alone.
 */
const BATCH_BYTES = 65_536;

/**
 * The sink the page lent as `port`, gathering small writes. A refusal of the
 * page's sink is met by the write or the close that hands it the bytes.
 */
export function pageSink(channel: HostChannel, port: PagePort): ByteSink {
  let batch: Uint8Array<ArrayBuffer> | undefined;
  let filled = 0;
  const send = async (chunk: Uint8Array<ArrayBuffer>): Promise<void> => {
    await channel.call('sink.write', { port, chunk }, { transfer: [chunk.buffer] });
  };
  const flush = async (): Promise<void> => {
    if (batch === undefined || filled === 0) return;
    const gathered = batch.subarray(0, filled);
    batch = undefined;
    filled = 0;
    await send(gathered);
  };
  return {
    write: async (chunk) => {
      if (filled + chunk.length > BATCH_BYTES) await flush();
      if (chunk.length >= BATCH_BYTES) {
        await send(chunk.slice());
        return;
      }
      batch ??= new Uint8Array(BATCH_BYTES);
      batch.set(chunk, filled);
      filled += chunk.length;
    },
    close: async () => {
      await flush();
      await channel.call('sink.close', { port });
    },
    abort: async (reason) => {
      batch = undefined;
      filled = 0;
      await channel.call('sink.abort', { port, reason: reasonText(reason) });
    },
  };
}

/** The bytes the page offered: a file read here, or a source the page reads. */
export function pageBytes(channel: HostChannel, bytes: CrossingBytes): ByteSource {
  if (bytes.kind === 'file') {
    const { file, handle } = bytes;
    return fileSource(file, handle === undefined ? undefined : () => handle.getFile());
  }
  return lentSource(channel, bytes.port, bytes.size);
}

/**
 * How many bytes a small read of a source the page reads asks it for. A bundle
 * is read in many small ranges, its headers among them, which would each cost
 * a round trip to the page; the bytes past a small range are kept for the
 * reads that follow it, while a range this large is asked for alone.
 */
const READ_AHEAD_BYTES = 65_536;

/** The source the page lent as `port`, reading ahead of small ranges. */
function lentSource(channel: HostChannel, port: PagePort, size: number): ByteSource {
  let ahead: { readonly offset: number; readonly bytes: Uint8Array<ArrayBuffer> } | undefined;
  return {
    size,
    read: async (offset, length, signal) => {
      const kept = ahead;
      const from = offset - (kept?.offset ?? 0);
      if (kept !== undefined && from >= 0 && from + length <= kept.bytes.length) {
        return kept.bytes.slice(from, from + length);
      }
      const asked = Math.max(length, Math.min(READ_AHEAD_BYTES, size - offset));
      const bytes = await channel.call('source.read', { port, offset, length: asked }, { signal });
      if (asked === length) return bytes;
      ahead = { offset, bytes };
      return bytes.slice(0, length);
    },
  };
}

/** A file the person chose, as the media store takes it. */
export function pageFile(channel: HostChannel, file: CrossingFile): ExternalFile {
  const { bytes, ...described } = file;
  return { ...described, source: pageBytes(channel, bytes) };
}

function lentFolder(channel: HostChannel, port: PagePort): DirectoryReader {
  return {
    list: (signal) => channel.call('folder.list', { port }, { signal }),
    open: async (path) => {
      const opened = await channel.call('folder.open', { port, path });
      return opened === undefined ? undefined : pageBytes(channel, opened);
    },
  };
}

/** A folder the page offered to read: files read here, or a folder the page reads. */
export function pageFolder(channel: HostChannel, folder: CrossingFolder): DirectoryReader {
  if (folder.kind === 'port') return lentFolder(channel, folder.port);
  return listedFolder(folder.files.map(({ path, file }) => ({ file, relativePath: path })));
}

/** The folder the page lent as `port` to write into. */
export function pageWriter(channel: HostChannel, port: PagePort): DirectoryWriter {
  return {
    ...lentFolder(channel, port),
    create: async (path) => pageSink(channel, await channel.call('folder.create', { port, path })),
    remove: async (path) => {
      await channel.call('folder.remove', { port, path });
    },
  };
}

/** The backups folder the page lent as `port`. */
export function pageBackupFolder(channel: HostChannel, port: PagePort): ExternalBackupTarget {
  return {
    create: async (generation) =>
      pageSink(channel, await channel.call('backupFolder.create', { port, generation })),
  };
}

/** The search for linked files the page lent as `port`. */
export function pageLocate(channel: HostChannel, port: PagePort): ConsolidationServices['locate'] {
  return async (asset, identity, signal) => {
    const located = await channel.call('linkedFiles.locate', { port, asset, identity }, { signal });
    return located.kind === 'absent'
      ? located
      : { kind: 'found', file: pageFile(channel, located.file) };
  };
}
