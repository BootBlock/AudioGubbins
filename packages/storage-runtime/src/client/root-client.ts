/**
 * The storage root, as the page asks the storage worker for it: opening it,
 * and wiping data of another schema once the person confirmed it
 * (REQ-STOR-052, REQ-EXEC-216).
 */

import type { DomainResult } from '@audiogubbins/domain';
import type { StorageRootOpening, WipeConfirmation } from '@audiogubbins/storage';

import type { ClientChannel } from '../protocol/storage-operations.js';

/** The storage root, and the wipe the compatibility screen offers. */
export interface RootClient {
  /** Opens the root, initialising an empty storage, and says what it found. */
  open(signal?: AbortSignal): Promise<DomainResult<StorageRootOpening>>;

  /**
   * Removes everything the storage holds and initialises this build's schema,
   * where the storage still holds what the person confirmed.
   */
  wipe(confirmation: WipeConfirmation, signal?: AbortSignal): Promise<DomainResult<void>>;
}

/** The storage root, over the page's end of the port. */
export function rootClient(channel: ClientChannel): RootClient {
  return {
    open: (signal) => channel.call('root.open', undefined, { signal }),
    wipe: (confirmation, signal) => channel.call('root.wipe', confirmation, { signal }),
  };
}
