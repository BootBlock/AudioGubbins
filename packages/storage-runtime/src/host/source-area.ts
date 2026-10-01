/**
 * The files linked assets were recorded from, served to the page: looking at
 * one again to say whether it is the file the project recorded (REQ-STOR-104,
 * REQ-STOR-053).
 *
 * The page finds the file, since the browser asks the person for leave to read
 * it there, and passes it; the worker reads it, samples it and, where the
 * recorded identity knows the content, hashes it whole, with the worker's
 * digest and its turns, so the page spends nothing on a long file.
 */

import { examineFile } from '@audiogubbins/media-store';

import type { AreaHandlers, HostChannel } from '../protocol/storage-operations.js';
import type { HostServices } from './host-services.js';
import { pageFile } from './remote-page-ports.js';

/** The operations of linked files, over the worker's digest and the files the page passes. */
export function sourceHandlers(
  services: HostServices,
  channel: HostChannel,
): AreaHandlers<'sources'> {
  return {
    'sources.examine': ({ recorded, file }, { signal }) =>
      examineFile(recorded, pageFile(channel, file), services, signal),
  };
}
