/**
 * Importing audio files, served to the page (ADR-0052, ADR-0090): the
 * services every import works with, made once from the worker's own, and a
 * batch of files run one at a time, each decoded by the codec worker the page
 * joins to this one where it needs it, with each report sent as it is made.
 */

import {
  addAssetInvocation,
  addMarkerInvocation,
  addRegionInvocation,
} from '@audiogubbins/project-commands';
import { importBatch, type AudioImportServices } from '@audiogubbins/storage';

import { importStream } from '../protocol/import-operations.js';
import type { AreaHandlers, HostChannel } from '../protocol/storage-operations.js';
import type { HostServices } from './host-services.js';
import type { OpenProjects } from './open-projects.js';
import { pageDecoding, pageFile } from './remote-page-ports.js';

/**
 * What an import works with, from the worker's services: the room left is
 * the browser's estimate of the quota less what this origin keeps, where it
 * gives both.
 */
export function importServices(services: HostServices): AudioImportServices {
  return {
    store: services.store,
    digest: services.digest,
    yieldToHost: services.yieldToHost,
    commands: {
      addAsset: addAssetInvocation,
      addRegion: addRegionInvocation,
      addMarker: addMarkerInvocation,
    },
    tree: services.tree,
    ids: services.ids,
    nextToken: services.nextToken,
    room: async () => {
      const estimate = await services.estimate();
      return estimate === undefined ? undefined : Math.max(0, estimate.quota - estimate.usage);
    },
    ...(services.coordinator === undefined ? {} : { coordinator: services.coordinator }),
  };
}

/** The operations of importing many files, over the worker's open projects and the page's files. */
export function importHandlers(
  services: HostServices,
  projects: OpenProjects,
  channel: HostChannel,
): AreaHandlers<'imports'> {
  const importing = importServices(services);
  return {
    'imports.run': async ({ handle, files, choice, importedAt, decoder, report }, { signal }) =>
      await importBatch(
        projects.session(handle),
        {
          files: files.map(({ file, assetId }, index) => ({
            file: pageFile(channel, file),
            assetId,
            decode: pageDecoding(channel, decoder, index),
          })),
          choice,
          importedAt,
        },
        importing,
        (job, index, event) => {
          channel.emit(importStream(report), { job, index, event });
        },
        signal,
      ),
  };
}
