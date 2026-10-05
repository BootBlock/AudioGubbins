/**
 * Bringing an audio file into the open project (REQ-STOR-025, REQ-AUDIO-220,
 * ADR-0052): the file is asked for first, in the handler of the person's
 * gesture, since a browser opens no chooser outside one, and one dismissed
 * brings nothing and says nothing. It is copied or linked as the person's
 * setting for bringing files in says. A link keeps no protected copy, since
 * taking no room is what a link is chosen for: the person is asked when its
 * file changes, and can copy it into the project at any time.
 *
 * The storage worker reads the file and refuses it, naming what it is, before
 * anything is stored, and adds the asset as one change undo reverses. One file
 * is brought in at a time, and the person can call it off, which keeps
 * nothing; letting the project go calls it off too.
 */

import type { Clock } from '@audiogubbins/diagnostics';
import {
  FailureKind,
  fail,
  failure,
  succeed,
  type AssetId,
  type DomainResult,
} from '@audiogubbins/domain';
import { SourceHandling, type ImportChoice } from '@audiogubbins/media-store';
import type { ImportedAudio } from '@audiogubbins/storage';
import type { MediaClient, PageFile, RemoteProjectSession } from '@audiogubbins/storage-runtime';

import type { TransferFiles } from '../io/transfer-files.js';
import { abandonment, isAbandoned, within } from './abandoning.js';
import { observable, type Observable } from './observable.js';
import type { OpenProjectStore } from './open-project-store.js';
import type { ProjectPreferencesStore } from './project-preferences-store.js';

/** Whether a file is being brought in. */
export type AudioImportState =
  { readonly kind: 'idle' } | { readonly kind: 'importing'; readonly fileName: string };

/** What an import the person started came to. */
export type AudioImportOutcome =
  | { readonly kind: 'imported'; readonly imported: ImportedAudio }
  | { readonly kind: 'dismissed' }
  | { readonly kind: 'cancelled'; readonly fileName: string };

const IDLE: AudioImportState = { kind: 'idle' };

/** Why a second file is refused while one is being imported. */
export const ONE_AT_A_TIME = failure(
  'import.one-at-a-time',
  FailureKind.Conflict,
  'A file is being imported already. Wait for it, or cancel it.',
);

/** The reason an import the person called off is given up with. */
const CANCELLED = abandonment('The import was cancelled.');

/** What the person's setting makes of a file brought in. */
function choiceOf(handling: SourceHandling): ImportChoice {
  return handling === SourceHandling.Link
    ? { mode: SourceHandling.Link, keepProtectedCopy: false }
    : { mode: SourceHandling.Copy };
}

/** Brings audio files into the open project, one at a time. */
export class AudioImports implements Observable<AudioImportState> {
  private readonly media: Pick<MediaClient, 'importFile'>;
  private readonly files: TransferFiles;
  private readonly project: OpenProjectStore;
  private readonly preferences: ProjectPreferencesStore;
  private readonly state = observable<AudioImportState>(IDLE);
  private running: AbortController | undefined;

  readonly get = this.state.get;
  readonly subscribe = this.state.subscribe;

  constructor(
    media: Pick<MediaClient, 'importFile'>,
    files: TransferFiles,
    project: OpenProjectStore,
    preferences: ProjectPreferencesStore,
  ) {
    this.media = media;
    this.files = files;
    this.project = project;
    this.preferences = preferences;
  }

  /**
   * Asks for a file and brings it into the project `session` writes as the
   * asset `assetId`, at the time `clock` gives once the file is chosen.
   */
  readonly importAudio = async (
    session: RemoteProjectSession,
    assetId: AssetId,
    clock: Clock,
  ): Promise<DomainResult<AudioImportOutcome>> => {
    // Refused before the chooser opens, so no file is asked for in vain. A
    // chooser the person leaves open blocks nothing, since one the browser
    // never settles must not stop every later import.
    if (this.busy()) return fail(ONE_AT_A_TIME);
    const file = await this.files.chooseMediaFile();
    if (file === undefined) return succeed({ kind: 'dismissed' });
    return await this.importChosen(session, file, assetId, clock);
  };

  /**
   * Brings `file`, which the person chose already, into the project `session`
   * writes as the asset `assetId`, at the time `clock` gives: the one path
   * Quick Edit shares, which chooses the file before it makes the project.
   */
  readonly importChosen = async (
    session: RemoteProjectSession,
    file: PageFile,
    assetId: AssetId,
    clock: Clock,
  ): Promise<DomainResult<Exclude<AudioImportOutcome, { readonly kind: 'dismissed' }>>> => {
    if (this.busy()) return fail(ONE_AT_A_TIME);
    const controller = new AbortController();
    const unfollow = within(controller, this.project.scope());
    this.running = controller;
    this.state.set({ kind: 'importing', fileName: file.fileName });
    try {
      const imported = await this.media.importFile(
        session,
        {
          file,
          choice: choiceOf(this.preferences.get().sourceHandling),
          assetId,
          importedAt: clock.now(),
        },
        controller.signal,
      );
      return imported.ok ? succeed({ kind: 'imported', imported: imported.value }) : imported;
    } catch (error) {
      // Called off by the person, the worker kept nothing. Given up with the
      // project, the rejection stands, as every abandoned call's does.
      if (isAbandoned(error) && controller.signal.reason === CANCELLED) {
        return succeed({ kind: 'cancelled', fileName: file.fileName });
      }
      throw error;
    } finally {
      unfollow();
      this.running = undefined;
      this.state.set(IDLE);
    }
  };

  /** Whether an import runs, read afresh after each wait. */
  private busy(): boolean {
    return this.running !== undefined;
  }

  /** Calls off the import running, where one is; answers whether one was. */
  readonly cancel = (): boolean => {
    if (this.running === undefined) return false;
    this.running.abort(CANCELLED);
    return true;
  };
}
