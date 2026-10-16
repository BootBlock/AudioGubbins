/**
 * What the page asks the storage worker of exports (ADR-0092), and the
 * report the worker sends of an export as it is staged.
 *
 * The codec worker writes an export's encoded file to a port the page hands the
 * storage worker, transferred, so no sample and no byte of it passes through
 * the page; the worker stages it, and delivers it on the page's word to a
 * destination the page chose, whose handle crosses as itself: a save dialog's
 * file, or a folder, with the relative folder inside it the file goes into
 * (ADR-0102) and the records of what was exported there before where the page
 * keeps it trusted. Where a name is taken and the rules ask, the worker asks
 * the person through the prompt the page lends and waits for the answer. A
 * download is answered as a file of the staged parts, read where they lie,
 * never copied whole into memory, so its staging stays until the page gives it
 * up.
 */

import type { MetadataPart } from '@audiogubbins/codecs';
import type { DomainFailure, DomainResult } from '@audiogubbins/domain';
import type {
  CollisionAnswer,
  CollisionPolicy,
  ExportFileName,
  ExportedFileRecord,
} from '@audiogubbins/import-export';
import type { ExportCodec, ExportRecord } from '@audiogubbins/project-format';
import type { Delivery, ExportOrigin } from '@audiogubbins/storage';

import type { Operation } from './operations.js';
import type { PagePort } from './page-operations.js';
import type { ProjectHandle } from './project-operations.js';

/** An export staged: the name it is delivered by, and what it is. */
export interface StagedFile {
  readonly token: string;
  readonly bytes: number;

  /** Its SHA-256, in lower-case hexadecimal. */
  readonly sha256: string;

  /** The parts of the metadata its format could not hold. */
  readonly dropped: readonly MetadataPart[];
}

/** Where a staged export is delivered, as it crosses to the worker. */
export type CrossingDestination =
  /** A file a save dialog gave. */
  | { readonly kind: 'file'; readonly handle: FileSystemFileHandle }
  /** A folder, chosen or kept trusted, with the file's folder and name wanted and the collision rules. */
  | {
      readonly kind: 'folder';
      readonly handle: FileSystemDirectoryHandle;

      /**
       * The folders inside `handle`'s the file goes into, outermost first,
       * each checked by the worker before anything is written; none is the
       * folder itself.
       */
      readonly path: readonly string[];
      readonly wanted: ExportFileName;
      readonly policy: CollisionPolicy;
      readonly remembered: CollisionAnswer | undefined;

      /**
       * What was exported to the folder before, where the page keeps it
       * trusted, each file named by its path from the folder.
       */
      readonly trusted: readonly ExportedFileRecord[] | undefined;
    }
  /** A download, where no dialog or folder can be written. */
  | { readonly kind: 'download'; readonly name: string; readonly mediaType: string };

/** How a delivery ended: written into a destination, refused, or answered as a download. */
export type DeliveryAnswer =
  | Delivery
  | {
      readonly kind: 'download';
      readonly file: Blob;
      readonly record: ExportRecord;
      readonly unrecorded?: DomainFailure;
    };

/** A report of an export being staged: the body's bytes written so far. */
export interface StagingReport {
  readonly bytesStaged: number;
}

/** The stream an export's staging is reported on, named by the page. */
export type StagingStream = `staging:${string}`;

/** The name of the stream the staging named `report` is reported on. */
export function stagingStream(report: string): StagingStream {
  return `staging:${report}`;
}

/** The operations of exports. */
export type ExportOperations = {
  /**
   * Stages the export of the project open under `handle` the codec worker
   * writes to `stream`, transferred, made as `origin` says, reporting on the
   * stream `report` names. Called off, it keeps nothing.
   */
  'exports.stage': Operation<
    {
      readonly handle: ProjectHandle;
      readonly stream: MessagePort;
      readonly origin: ExportOrigin;
      readonly report: string;
    },
    DomainResult<StagedFile>
  >;

  /**
   * Delivers the export staged as `token` to `destination`, asking through
   * `prompt` where a name is taken and the rules ask, and records it in the
   * history of the project open under `handle` as written by `encoder`, which
   * the codec worker named once it had encoded the file. Fails only where it
   * is no longer staged; a refused delivery keeps it staged.
   */
  'exports.deliver': Operation<
    {
      readonly handle: ProjectHandle;
      readonly token: string;
      readonly encoder: ExportCodec;
      readonly destination: CrossingDestination;
      readonly prompt?: PagePort;
    },
    DomainResult<DeliveryAnswer>
  >;

  /** Gives up the export staged as `token`, delivered as a download or no longer wanted. */
  'exports.discard': Operation<{ readonly token: string }, undefined>;
};
