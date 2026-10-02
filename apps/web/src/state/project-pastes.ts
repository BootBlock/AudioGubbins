/**
 * Running a paste the clipboard planned in the open project (ADR-0053): the
 * storage worker shows that the media each record brings is there before
 * anything changes, finding a linked file through the handle AudioGubbins kept
 * for it without asking the person, so a missing or changed source refuses the
 * paste and leaves the project as it was. Every paste goes this one way, a
 * paste within one project with no records to bring as much as one from
 * another.
 */

import type { DomainResult } from '@audiogubbins/domain';
import type { AudioPaste, ChangeOutcome } from '@audiogubbins/storage';
import type { MediaClient, PageLocate, RemoteProjectSession } from '@audiogubbins/storage-runtime';

import { absenceOf, type LinkedFilesPort } from '../io/linked-files.js';
import type { OpenProjectStore } from './open-project-store.js';

/** Runs pastes in the open project. */
export class ProjectPastes {
  private readonly media: Pick<MediaClient, 'paste'>;
  private readonly project: OpenProjectStore;
  private readonly locate: PageLocate;

  constructor(
    media: Pick<MediaClient, 'paste'>,
    project: OpenProjectStore,
    linkedFiles: LinkedFilesPort,
  ) {
    this.media = media;
    this.project = project;
    this.locate = async (_asset, identity) => {
      const access = await linkedFiles.look(identity);
      return access.kind === 'available'
        ? { kind: 'found', file: access.file }
        : { kind: 'absent', reason: absenceOf(access) };
    };
  }

  /** Runs `paste` in the project `session` writes, as one change, given up with the project. */
  readonly paste = (
    session: RemoteProjectSession,
    paste: AudioPaste,
  ): Promise<DomainResult<ChangeOutcome>> =>
    this.media.paste(session, paste, this.locate, this.project.scope());
}
