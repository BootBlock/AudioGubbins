/**
 * The storage root, served to the page: opening it, which initialises an empty
 * storage and says whether the stored data is of this build's schema, and
 * wiping data of another schema once the person has confirmed what they were
 * shown (REQ-STOR-052, REQ-EXEC-216).
 */

import { openStorageRoot, wipeStorage } from '@audiogubbins/storage';

import type { AreaHandlers } from '../protocol/storage-operations.js';
import type { HostServices } from './host-services.js';

/** The storage root's operations, over the worker's tree. */
export function rootHandlers({ tree, digest }: HostServices): AreaHandlers<'root'> {
  return {
    'root.open': (_nothing, { signal }) => openStorageRoot(tree, digest, signal),
    'root.wipe': (confirmation, { signal }) => wipeStorage(tree, digest, confirmation, signal),
  };
}
