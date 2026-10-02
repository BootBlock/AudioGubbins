/**
 * The backups folder: a folder on this machine that each backup of a project
 * whose policy asks for it is also written to, as a bundle, where the browser
 * lets AudioGubbins write into one (REQ-STOR-105).
 *
 * The folder belongs to this browser on this machine, not to any project: a
 * project taken elsewhere keeps its policy, and the other machine's browser has
 * a folder of its own, or none. The browser keeps the folder across a reload
 * but lets a page write into it again only once the person says so, which it
 * asks only in answer to their gesture, so after a reload the folder waits for
 * that leave, and a backup made meanwhile is kept in the browser and its copy
 * reported as not written. Nothing in the folder is ever removed: pruning
 * applies to the backups the browser keeps.
 */

import {
  FailureKind,
  fail,
  failure,
  mapResult,
  succeed,
  type DomainFailure,
  type DomainResult,
} from '@audiogubbins/domain';
import { openFileSinkIn, type WritableDirectory } from '@audiogubbins/browser-storage';
import type { Logger } from '@audiogubbins/diagnostics';
import { TreeFailure, TreeFailureKind, type ByteSink } from '@audiogubbins/project-format';
import type { ExternalBackupTarget } from '@audiogubbins/storage';

import type { BackupFolderPort, FolderAccess } from '../io/backup-folder.js';
import { backupFileNameOf } from '../io/file-names.js';
import { observable, type Observable } from './observable.js';

/** The backups folder, as the settings show it. */
export type BackupFolderState =
  /** The browser gives no folder to write into, so backups stay in its own storage. */
  | { readonly kind: 'unsupported' }
  | { readonly kind: 'looking' }
  | { readonly kind: 'none' }
  | {
      readonly kind: 'chosen';
      readonly name: string;
      readonly access: 'granted' | 'permission-needed' | 'denied';
    }
  /** The browser would not say which folder is kept, and why. */
  | { readonly kind: 'failed'; readonly reason: string };

/** Why no folder can be chosen here. */
const UNSUPPORTED = failure(
  'backup-folder.unsupported',
  FailureKind.Rejected,
  'This browser cannot give AudioGubbins a folder to write into, so backups stay in its own storage. Export any of them from the list.',
);

/** Why a folder cannot be let in or let go where none is kept. */
const NONE_KEPT = failure(
  'backup-folder.none',
  FailureKind.Rejected,
  'No backups folder is chosen in this browser.',
);

/** Why the folder cannot be written now, when a backup would be copied into it. */
const NOT_WRITABLE_NOW =
  'The backups folder cannot be written now: none is chosen in this browser, or leave to write to it has not been given since the page loaded.';

/** The failure a refusal of the browser's handle store is said as. */
function keptFolderRefused(refusal: TreeFailure): DomainFailure {
  return failure(
    'backup-folder.refused',
    FailureKind.Retryable,
    `The browser would not keep or find the backups folder. ${refusal.message}`,
  );
}

/** The folder's state from what the port found. */
function stateOf(access: FolderAccess): BackupFolderState {
  switch (access.kind) {
    case 'none':
      return { kind: 'none' };
    case 'available':
      return { kind: 'chosen', name: access.name, access: 'granted' };
    case 'permission-needed':
    case 'denied':
      return { kind: 'chosen', name: access.name, access: access.kind };
  }
}

/** The backups folder (see the module comment). */
export class BackupFolderStore implements Observable<BackupFolderState> {
  private readonly port: BackupFolderPort | undefined;
  private readonly logger: Logger;
  private readonly state = observable<BackupFolderState>({ kind: 'looking' });

  /** The folder to write into, while the browser lets it be written. */
  private writable: WritableDirectory | undefined;

  readonly get = this.state.get;
  readonly subscribe = this.state.subscribe;

  /**
   * Where the backup scheduler copies a backup: a file in the folder, while it
   * may be written, and a refusal of the kind a storage that cannot be reached
   * gives while it may not, which the scheduler reports beside the backup it
   * made.
   */
  readonly target: ExternalBackupTarget = {
    create: async (backup): Promise<ByteSink> => {
      const folder = this.writable;
      if (folder === undefined) {
        throw new TreeFailure(TreeFailureKind.Unavailable, NOT_WRITABLE_NOW);
      }
      return await openFileSinkIn(folder, backupFileNameOf(backup));
    },
  };

  constructor(port: BackupFolderPort | undefined, logger: Logger) {
    this.port = port;
    this.logger = logger;
    if (port === undefined) this.state.set({ kind: 'unsupported' });
  }

  /** Finds the folder kept, without asking for leave, as the page starts. */
  readonly start = async (): Promise<void> => {
    const port = this.port;
    if (port === undefined) return;
    const found = await this.refusing(() => port.look());
    if (found.ok) this.take(found.value);
    else {
      this.logger.warning('The backups folder could not be found again.', {
        code: found.failures[0].code,
      });
    }
  };

  /** Asks the person for a folder, from their gesture, and keeps it in place of the last. */
  readonly choose = async (): Promise<DomainResult<BackupFolderState | undefined>> => {
    const port = this.port;
    if (port === undefined) return fail(UNSUPPORTED);
    const chosen = await this.refusing(() => port.choose());
    return mapResult(chosen, (access) => (access === undefined ? undefined : this.take(access)));
  };

  /** Asks the browser for leave to write into the kept folder, from the person's gesture. */
  readonly allow = async (): Promise<DomainResult<BackupFolderState>> => {
    const port = this.port;
    if (port === undefined) return fail(UNSUPPORTED);
    if (this.state.get().kind !== 'chosen') return fail(NONE_KEPT);
    return mapResult(await this.refusing(() => port.ask()), this.take);
  };

  /** Stops copying backups to the folder, leaving what is in it. */
  readonly forget = async (): Promise<DomainResult<BackupFolderState>> => {
    const port = this.port;
    if (port === undefined) return fail(UNSUPPORTED);
    if (this.state.get().kind !== 'chosen') return fail(NONE_KEPT);
    const forgotten = await this.refusing(() => port.forget());
    return mapResult(forgotten, () => this.take({ kind: 'none' }));
  };

  /** Takes the folder the port left, writing into it while it may be written. */
  private readonly take = (access: FolderAccess): BackupFolderState => {
    this.writable = access.kind === 'available' ? access.folder : undefined;
    const next = stateOf(access);
    this.state.set(next);
    return next;
  };

  /** Runs a step of the port, saying a refusal of the browser's handle store as a failure. */
  private async refusing<TValue>(step: () => Promise<TValue>): Promise<DomainResult<TValue>> {
    try {
      return succeed(await step());
    } catch (error) {
      // The handle store's refusal, such as site data blocked since the page
      // loaded, is the one failure expected here; anything else is a defect.
      if (!(error instanceof TreeFailure)) throw error;
      const refused = keptFolderRefused(error);
      this.state.set({ kind: 'failed', reason: refused.summary });
      return fail(refused);
    }
  }
}
