/**
 * What the page's export is, as the commands, the dialog and the progress
 * surface see it (ADR-0092): where the person chose to deliver, what they
 * asked for, how far it has got, and what they may do with it.
 *
 * An export runs as a batch of jobs, one file at a time, each rendered,
 * encoded, staged and only then delivered. A delivery refused, for permission
 * or a file the person chose to keep, keeps its file staged: the batch goes on
 * without it, and once every job has settled the person may retry the delivery
 * or choose another destination, with no new render, or give the file up.
 * Nothing here holds a project: each call that records into one is given the
 * session of the project the export was made from.
 */

import type { AssetId, DomainResult } from '@audiogubbins/domain';
import type {
  CollisionPolicy,
  ExportBatch,
  ExportContext,
  ExportSettings,
  PlannedFile,
} from '@audiogubbins/import-export';
import type { ProjectState } from '@audiogubbins/project-format';
import type { CollisionReply } from '@audiogubbins/storage';
import type { RemoteProjectSession } from '@audiogubbins/storage-runtime';

import type { EditorAsset } from '../assets/editor-asset.js';
import type { Observable } from '../state/observable.js';

/**
 * Where the person chose to deliver an export: a file a save dialog gave, a
 * folder they chose or keep trusted, each with what to do with a taken name,
 * or a download, where this browser has no dialog (REQ-GODOT-046). Each handle
 * was granted inside the person's gesture; a trusted folder is named by the
 * key it is kept under, and found again as it is delivered into.
 */
export type ExportDestinationChoice =
  | { readonly kind: 'file'; readonly handle: FileSystemFileHandle }
  | {
      readonly kind: 'folder';
      readonly handle: FileSystemDirectoryHandle;
      readonly policy: CollisionPolicy;
    }
  | { readonly kind: 'trusted-folder'; readonly key: string; readonly policy: CollisionPolicy }
  | { readonly kind: 'download' };

/** An export the person asked for: the asset it renders, as the settings set it, and where it goes. */
export interface ExportStart {
  readonly asset: AssetId;

  /** The settings, the range among them, which the project keeps as its last before the export starts. */
  readonly settings: ExportSettings;
  readonly destination: ExportDestinationChoice;
}

/** A batch under way or done, and the file each of its jobs writes, by the job's id. */
interface ExportRun {
  readonly batch: ExportBatch;
  readonly files: ReadonlyMap<string, PlannedFile>;

  /** The settings every file of the batch is made by. */
  readonly settings: ExportSettings;

  /** Where each job's file goes, by its id: where the person chose, or where they asked it delivered instead. */
  readonly destinations: ReadonlyMap<string, ExportDestinationChoice>;
}

/**
 * Where the page's export is.
 *
 * - `idle`: none has started since the page opened.
 * - `running`: a job of the batch has yet to settle. `asking` is the name of
 *   the taken file the person is being asked about, as the folder lists it,
 *   while they are, and the batch waits for their answer.
 * - `held`: every job has settled, and at least one is staged with its
 *   delivery refused (its state `staged`, with the reason as `refused`),
 *   waiting for a retry, another destination or the batch cancelled.
 * - `ended`: every job has ended, delivered, failed or cancelled; `said` is
 *   the sentence saying what came of it, which `start` answered.
 *
 * The batch's progress is `batchProgress` of its batch, never kept beside it.
 */
export type ExportRunState =
  | { readonly kind: 'idle' }
  | (ExportRun & { readonly kind: 'running'; readonly asking: string | undefined })
  | (ExportRun & { readonly kind: 'held' })
  | (ExportRun & { readonly kind: 'ended'; readonly said: string });

/**
 * The page's one export at a time, observed by its surfaces (see the module
 * comment). Every answer that is a sentence is what the person is told, and a
 * refusal is the reason; nothing here says either itself.
 */
export interface ExportControl extends Observable<ExportRunState> {
  /**
   * Plans `start`, checks that the codec writes here and that the storage
   * has room for the staged file, and runs the batch, recorded in the
   * history of the project `session` writes. Refused, before anything is
   * rendered or stored, where an export is running or held, where the
   * settings cannot be planned, where the codec is unavailable here (naming
   * the codecs that serve instead), or where the storage has too little room
   * (naming the room needed and the room free). Otherwise answers once every
   * job has settled: the `ended` state's sentence, or, where a delivery was
   * refused, the sentence saying which files wait and why.
   */
  start(session: RemoteProjectSession, start: ExportStart): Promise<DomainResult<string>>;

  /**
   * Cancels every job of the batch not yet ended, and gives up the files they
   * staged, so the destination is left as it was; a held file is given up the
   * same way. Answers whether there was a batch to cancel.
   */
  cancel(): boolean;

  /**
   * Answers the collision the person is being asked about: the reply, or
   * `undefined` where they dismissed the question, which skips the file.
   * Answers whether a question was waiting.
   */
  answerCollision(reply: CollisionReply | undefined): boolean;

  /**
   * Delivers the held file of `job` again, to the destination it was refused
   * at, with no new render. Refused where the export is not `held` or the job
   * holds no file, or where `session` is not of the project the export was
   * made from. Answers as `start` does once the delivery settles; refused
   * again, the file stays held.
   */
  retry(session: RemoteProjectSession, job: string): Promise<DomainResult<string>>;

  /**
   * Delivers the held file of `job` to `destination` instead, with no new
   * render; refused, and answered, as `retry` is.
   */
  deliverElsewhere(
    session: RemoteProjectSession,
    job: string,
    destination: ExportDestinationChoice,
  ): Promise<DomainResult<string>>;
}

/**
 * What an export of `asset`'s audio is planned against in `state`: the asset
 * described, at the layout its racks give the audio heard, with the precision
 * its source needs and its regions in timeline order, and the codec registry.
 * Pure, so the dialog asks it on every change; refused with the reason where
 * the asset is not in `state`.
 */
export type ExportContextOf = (
  asset: EditorAsset,
  state: ProjectState,
) => DomainResult<ExportContext>;
