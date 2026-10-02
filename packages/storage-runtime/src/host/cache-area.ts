/**
 * The disposable caches, served to the page: reading one whole, keeping one,
 * and giving up every cache of a scope (REQ-STOR-027).
 *
 * A cache is read whole and its buffer moved to the page rather than copied,
 * since the page takes the whole of it, as a waveform's kept peaks are. The
 * bytes the page keeps arrive moved likewise.
 */

import { succeed } from '@audiogubbins/domain';

import { Transferring } from '../protocol/operations.js';
import type { AreaHandlers } from '../protocol/storage-operations.js';
import type { HostServices } from './host-services.js';

/**
 * Bytes that are the whole of their buffer, so moving the buffer moves them
 * and nothing beside them: a view on part of a larger buffer is copied once.
 */
function wholeBuffer(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes
    : bytes.slice();
}

/** The caches' operations, over the worker's cache store. */
export function cacheHandlers({ caches }: HostServices): AreaHandlers<'caches'> {
  return {
    'caches.read': async (key, { signal }) => {
      const opened = await caches.open(key, signal);
      if (!opened.ok) return opened;
      const source = opened.value;
      if (source === undefined) return succeed(undefined);
      const bytes = wholeBuffer(await source.read(0, source.size, signal));
      return new Transferring(succeed(bytes), [bytes.buffer]);
    },
    'caches.put': ({ key, bytes }, { signal }) => caches.put(key, bytes, signal),
    'caches.evictScope': ({ category, scope }) => caches.evictScope(category, scope),
  };
}
