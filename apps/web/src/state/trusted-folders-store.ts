/**
 * The folders the person keeps trusted for exports, as the settings list them
 * and the export delivers into them (ADR-0092, REQ-ARCH-054).
 *
 * In a trusted folder, a file AudioGubbins exported there earlier, unchanged
 * since, is replaced without asking, and any other taken name falls to the
 * export's policy. The folders and the records of what was exported into each
 * belong to this browser on this machine, kept beside the handles of linked
 * files (`TrustedFolders`), never in a project or the person's preferences.
 * Where the browser keeps no handles, or gives no folder to write into, there
 * are none, and the settings say why.
 */

import type { TrustedFolders } from '@audiogubbins/browser-storage';
import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DomainFailure,
  type DomainResult,
} from '@audiogubbins/domain';
import { quoted } from '@audiogubbins/text';

import { observable, type Observable } from './observable.js';

/** A folder kept trusted, as the person knows it. */
export interface KeptTrustedFolder {
  /** The key it is kept under, which the commands and the export name it by. */
  readonly key: string;
  readonly name: string;
}

/** The trusted folders, as the settings show them. */
export type TrustedFoldersState =
  /** This browser keeps no folder, and why. */
  | { readonly kind: 'unavailable'; readonly reason: string }
  | { readonly kind: 'reading' }
  | { readonly kind: 'read'; readonly folders: readonly KeptTrustedFolder[] }
  /** The list could not be read, and why. */
  | { readonly kind: 'failed'; readonly reason: string };

/** Why no folder can be kept trusted in a browser that keeps no handles or gives no folders. */
const NO_TRUSTED_FOLDERS =
  'This browser cannot keep a folder for AudioGubbins to write into, so no folder can be trusted here.';

const UNAVAILABLE = failure(
  'export.trusted-folders-unavailable',
  FailureKind.Rejected,
  NO_TRUSTED_FOLDERS,
);

/** A failure of the handle database, as the person is told it. */
function unkept(what: string, error: unknown): DomainFailure {
  return failure(
    'export.trusted-folders-unreadable',
    FailureKind.Retryable,
    `${what}: ${error instanceof Error ? error.message : 'the browser gave no reason'}.`,
  );
}

/** The trusted folders (see the module comment). */
export class TrustedFoldersStore implements Observable<TrustedFoldersState> {
  /** Where the folders are kept, which an export delivers into; absent where none can be. */
  readonly folders: TrustedFolders | undefined;
  readonly #state: ReturnType<typeof observable<TrustedFoldersState>>;
  readonly get: () => TrustedFoldersState;
  readonly subscribe: (listener: () => void) => () => void;

  constructor(folders: TrustedFolders | undefined) {
    this.folders = folders;
    this.#state = observable<TrustedFoldersState>(
      folders === undefined
        ? { kind: 'unavailable', reason: NO_TRUSTED_FOLDERS }
        : { kind: 'reading' },
    );
    this.get = this.#state.get;
    this.subscribe = this.#state.subscribe;
  }

  /** Reads the list again, as the settings open. */
  async refresh(): Promise<void> {
    const { folders } = this;
    if (folders === undefined) return;
    try {
      const kept = await folders.list();
      this.#state.set({
        kind: 'read',
        folders: kept.map(({ key, folder }) => ({ key, name: folder.name })),
      });
    } catch (error) {
      // The database refused the read: the list says so, rather than showing none.
      this.#state.set({
        kind: 'failed',
        reason: unkept('The trusted folders could not be read', error).summary,
      });
    }
  }

  /** Keeps `folder` trusted, answering what is said of it. */
  async trust(folder: FileSystemDirectoryHandle): Promise<DomainResult<string>> {
    const { folders } = this;
    if (folders === undefined) return fail(UNAVAILABLE);
    try {
      await folders.trust(folder);
    } catch (error) {
      return fail(unkept(`${quoted(folder.name)} could not be kept trusted`, error));
    }
    await this.refresh();
    return succeed(
      `${quoted(folder.name)} is trusted: an export there replaces a file it exported before, while that file is unchanged, without asking.`,
    );
  }

  /** Stops trusting the folder kept under `key`, answering what is said of it. */
  async forget(key: string): Promise<DomainResult<string>> {
    const { folders } = this;
    if (folders === undefined) return fail(UNAVAILABLE);
    const state = this.#state.get();
    const name =
      state.kind === 'read' ? state.folders.find((one) => one.key === key)?.name : undefined;
    if (name === undefined) {
      return fail(
        failure(
          'export.trusted-folder-unknown',
          FailureKind.Rejected,
          'No such folder is trusted.',
        ),
      );
    }
    try {
      await folders.forget(key);
    } catch (error) {
      return fail(unkept(`${quoted(name)} could not be let go`, error));
    }
    await this.refresh();
    return succeed(`${quoted(name)} is no longer trusted; nothing in it was changed.`);
  }
}
