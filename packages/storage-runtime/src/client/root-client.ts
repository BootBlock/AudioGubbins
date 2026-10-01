/**
 * The storage root, as the page asks the storage worker for it: opening it,
 * taking every file out as it is, into a sink the person chose, and wiping
 * data of another schema once the person confirmed it (REQ-STOR-052,
 * REQ-EXEC-216).
 */

import type { DomainResult } from '@audiogubbins/domain';
import type { ByteSink, ZipWritten } from '@audiogubbins/project-format';
import type { StorageRootOpening, WipeConfirmation } from '@audiogubbins/storage';

import type { ClientChannel } from '../protocol/storage-operations.js';
import type { LendingCall } from './page-ports.js';

/** The storage root, and the wipe the compatibility screen offers. */
export interface RootClient {
  /** Opens the root, initialising an empty storage, and says what it found. */
  open(signal?: AbortSignal): Promise<DomainResult<StorageRootOpening>>;

  /**
   * Writes every file the storage holds into a ZIP in `sink`, and closes it:
   * the copy the person may keep before wiping data this build cannot read.
   */
  exportRaw(sink: ByteSink, signal?: AbortSignal): Promise<DomainResult<ZipWritten>>;

  /**
   * Removes everything the storage holds and initialises this build's schema,
   * where the storage still holds what the person confirmed.
   */
  wipe(confirmation: WipeConfirmation, signal?: AbortSignal): Promise<DomainResult<void>>;
}

/** The storage root, over the page's end of the port and calls that lend its ports. */
export function rootClient(channel: ClientChannel, call: LendingCall): RootClient {
  return {
    open: (signal) => channel.call('root.open', undefined, { signal }),
    exportRaw: (sink, signal) =>
      call('root.exportRaw', (lend) => ({ sink: lend.sink(sink) }), signal),
    wipe: (confirmation, signal) => channel.call('root.wipe', confirmation, { signal }),
  };
}
