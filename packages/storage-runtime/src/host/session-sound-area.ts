/**
 * The sounds the session holds and no project does, served to the page
 * (ADR-0090): each decoded by the codec worker the page joined to this one into
 * the staging (`session-sounds.ts` in the storage), and answered as a file of
 * its own, the WAV header and the data in the staging together, which a thread
 * reads in ranges where the data lies; and each let go when the session is done
 * with it.
 */

import { FailureKind, fail, failure, succeed, type DomainFailure } from '@audiogubbins/domain';
import { SessionSounds, mediaSharingOf, type AudioImportServices } from '@audiogubbins/storage';

import type { AreaHandlers, HostChannel } from '../protocol/storage-operations.js';
import type { CodecWorkerLink } from './codec-worker-link.js';
import type { HostServices } from './host-services.js';
import { pageFile } from './remote-page-ports.js';

/** A sound decoded whose data the staging no longer gives, as storage pressure may take it. */
function soundMissing(): DomainFailure {
  return failure(
    'import.sound-missing',
    FailureKind.Unrecoverable,
    'The decoded sound was given up by the storage before it could be opened, so it was not kept.',
  );
}

/** The operations of the session's sounds, over the worker's staging, its room and the codec worker. */
export function sessionSoundHandlers(
  services: HostServices,
  importing: Pick<AudioImportServices, 'room'>,
  channel: HostChannel,
  codecs: CodecWorkerLink,
): Pick<AreaHandlers<'imports'>, 'imports.holdSound' | 'imports.letGoSound'> {
  const sounds = new SessionSounds({
    tree: services.tree,
    nextToken: services.nextToken,
    room: importing.room,
    sharing: mediaSharingOf(services.coordinator),
  });
  return {
    'imports.holdSound': async ({ file }, { signal }) => {
      const held = await sounds.decode(
        pageFile(channel, file),
        codecs.decoding(file.bytes),
        signal,
      );
      if (!held.ok) return held;
      const { token, dataPath, header, ...sound } = held.value;
      const data = await services.fileAt(dataPath);
      if (data === undefined) {
        await sounds.discard(token);
        return fail(soundMissing());
      }
      // The header and the data as one file, which a thread reads in ranges
      // where the data lies, holding neither.
      return succeed({ token, file: new Blob([header, data]), ...sound });
    },
    'imports.letGoSound': async ({ token }) => {
      await sounds.discard(token);
      return undefined;
    },
  };
}
