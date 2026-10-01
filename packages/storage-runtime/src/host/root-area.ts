/**
 * The storage root, served to the page: opening it, which initialises an empty
 * storage and says whether the stored data is of this build's schema, taking
 * every file it holds out as it is, into a sink the page lent, and wiping data
 * of another schema once the person has confirmed what they were shown
 * (REQ-STOR-052, REQ-EXEC-216).
 */

import { exportRawStorage, openStorageRoot, wipeStorage } from '@audiogubbins/storage';

import type { AreaHandlers, HostChannel } from '../protocol/storage-operations.js';
import type { HostServices } from './host-services.js';
import { pageSink } from './remote-page-ports.js';

/** The storage root's operations, over the worker's tree and the sinks the page lends. */
export function rootHandlers(
  { tree, digest }: HostServices,
  channel: HostChannel,
): AreaHandlers<'root'> {
  return {
    'root.exportRaw': ({ sink }, { signal }) =>
      exportRawStorage(tree, pageSink(channel, sink), { signal }),
    'root.open': (_nothing, { signal }) => openStorageRoot(tree, digest, signal),
    'root.wipe': (confirmation, { signal }) => wipeStorage(tree, digest, confirmation, signal),
  };
}
