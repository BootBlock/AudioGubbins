/**
 * Audio files, served to the page (ADR-0052): importing one into an open
 * project in the worker, where the read contract opens it before anything is
 * stored, answering a stored object's file for the audio threads, and running a
 * paste with the media it brings.
 */

import { fail, succeed } from '@audiogubbins/domain';
import { objectMissing } from '@audiogubbins/media-store';
import { addAssetInvocation, applyInvocation } from '@audiogubbins/project-commands';
import { importAudio, pasteAudio } from '@audiogubbins/storage';

import type { AreaHandlers, HostChannel } from '../protocol/storage-operations.js';
import type { HostServices } from './host-services.js';
import type { OpenProjects } from './open-projects.js';
import { pageFile, pageLocate } from './remote-page-ports.js';

/** The operations of audio files, over the worker's store, its open projects and the page's files. */
export function mediaHandlers(
  services: HostServices,
  projects: OpenProjects,
  channel: HostChannel,
): AreaHandlers<'media'> {
  const importing = {
    store: services.store,
    digest: services.digest,
    yieldToHost: services.yieldToHost,
    invocation: addAssetInvocation,
  };
  return {
    'media.import': ({ handle, file, ...request }, { signal }) =>
      importAudio(
        projects.session(handle),
        { file: pageFile(channel, file), ...request },
        importing,
        signal,
      ),
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
