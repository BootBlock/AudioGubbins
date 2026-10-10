/**
 * Audio files, served to the page (ADR-0052): answering a stored object's file
 * for the audio threads, and running a paste with the media it brings.
 */

import { fail, succeed } from '@audiogubbins/domain';
import { objectMissing } from '@audiogubbins/media-store';
import { addAssetInvocation, applyInvocation } from '@audiogubbins/project-commands';
import { pasteAudio } from '@audiogubbins/storage';

import type { AreaHandlers, HostChannel } from '../protocol/storage-operations.js';
import type { HostServices } from './host-services.js';
import type { OpenProjects } from './open-projects.js';
import { importServices } from './import-area.js';
import { pageLocate } from './remote-page-ports.js';

/** The operations of audio files, over the worker's store, its open projects and the page's files. */
export function mediaHandlers(
  services: HostServices,
  projects: OpenProjects,
  channel: HostChannel,
): AreaHandlers<'media'> {
  const importing = importServices(services);
  return {
    'media.file': async (contentId) => {
      const path = await services.store.locate(contentId);
      if (!path.ok) return path;
      const file = await services.fileAt(path.value);
      return file === undefined ? fail(objectMissing(contentId)) : succeed(file);
    },
    'media.paste': ({ handle, paste, locate }, { signal }) =>
      pasteAudio(
        projects.session(handle),
        paste,
        {
          ...importing,
          locate: pageLocate(channel, locate),
          addAsset: addAssetInvocation,
          applyEdit: applyInvocation,
        },
        signal,
      ),
  };
}
