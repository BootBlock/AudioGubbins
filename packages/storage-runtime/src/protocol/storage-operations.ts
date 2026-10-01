/**
 * What the page and the storage worker offer each other: the operations the
 * page calls on the worker and the streams the worker sends it, and what the
 * page offers the worker in turn (ADR-0022).
 *
 * Each operation is the storage's own, its argument and answer the values the
 * storage takes and gives, so a failure the storage answers crosses as the
 * `DomainResult` it is, and a refusal of the tree crosses as its kind. Each is
 * grouped by the area of the page's client that calls it: the library of
 * projects, the storage root, the caches, the usage and its cleanup, and who
 * writes each project. The values all clone: none is a class with behaviour,
 * and a cache's bytes are moved rather than copied.
 */

import type { LogRecord, PerformanceRecord } from '@audiogubbins/diagnostics';
import type { DomainResult, ProjectId } from '@audiogubbins/domain';
import type { ProjectState } from '@audiogubbins/project-format';
import type {
  CacheCategory,
  CacheKey,
  CacheScope,
  CatalogueEntry,
  CleanupConfirmation,
  CleanupPlan,
  CleanupSelection,
  ForkRequest,
  LeaseOwner,
  NewProject,
  OwnershipEvent,
  PressureRelief,
  ProjectHeader,
  PurgeProjectConfirmation,
  StepOutcome,
  StorageRootOpening,
  StorageUsage,
  WipeConfirmation,
} from '@audiogubbins/storage';

import type { Handlers, Operation, Stream } from './operations.js';
import type { PortChannel } from './port-channel.js';

/** The operations the page calls on the storage worker, by area. */
export type StorageOperations = {
  /** Every project, deleted ones among them, in the order of their identifiers. */
  'library.list': Operation<undefined, readonly CatalogueEntry[]>;
  'library.create': Operation<NewProject, DomainResult<ProjectHeader>>;
  'library.softDelete': Operation<ProjectId, DomainResult<ProjectHeader>>;
  'library.restore': Operation<ProjectId, DomainResult<ProjectHeader>>;
  'library.purge': Operation<
    { readonly project: ProjectId; readonly confirmation: PurgeProjectConfirmation },
    DomainResult<void>
  >;
  'library.fork': Operation<ForkRequest, DomainResult<ProjectHeader>>;

  'root.open': Operation<undefined, DomainResult<StorageRootOpening>>;
  'root.wipe': Operation<WipeConfirmation, DomainResult<void>>;

  /** A cache's whole bytes, where it is kept whole. */
  'caches.read': Operation<CacheKey, DomainResult<Uint8Array<ArrayBuffer> | undefined>>;
  'caches.put': Operation<
    { readonly key: CacheKey; readonly bytes: Uint8Array<ArrayBuffer> },
    DomainResult<void>
  >;
  'caches.evictScope': Operation<
    { readonly category: CacheCategory; readonly scope: CacheScope },
    DomainResult<void>
  >;

  /**
   * The storage's usage, the projects open taken as `live` holds them rather
   * than as they were last written.
   */
  'usage.measure': Operation<
    { readonly live: readonly ProjectState[] },
    DomainResult<StorageUsage>
  >;
  'usage.planCleanup': Operation<CleanupSelection, DomainResult<CleanupPlan>>;
  'usage.runCleanup': Operation<
    { readonly plan: CleanupPlan; readonly confirmation?: CleanupConfirmation },
    DomainResult<readonly StepOutcome[]>
  >;

  /** Gives every cache up, in the order storage pressure gives them up. */
  'usage.relievePressure': Operation<undefined, DomainResult<PressureRelief>>;

  /** The window writing a project, where one does and can be told. */
  'ownership.ownerOf': Operation<ProjectId, LeaseOwner | undefined>;

  /**
   * Starts sending the changes of who writes a project on its stream, for one
   * more listener, until that listener unsubscribes.
   */
  'ownership.subscribe': Operation<ProjectId, undefined>;
  'ownership.unsubscribe': Operation<ProjectId, undefined>;
};

/** A record made by one of the worker's loggers, or a measurement one took. */
export type LogEntry =
  | { readonly kind: 'record'; readonly record: LogRecord }
  | { readonly kind: 'performance'; readonly record: PerformanceRecord };

/** The stream of a project's changes of writer. */
export type OwnershipStream = `ownership:${string}`;

/** The name of the stream a project's changes of writer are sent on. */
export function ownershipStream(project: ProjectId): OwnershipStream {
  return `ownership:${project}`;
}

/** What the storage worker serves the page, and the streams it sends it. */
export type StorageWorkerSide = {
  readonly operations: StorageOperations;
  readonly streams: {
    /** Every record the worker's loggers make, for the page's diagnostics to admit. */
    readonly log: Stream<LogEntry>;
    readonly [project: OwnershipStream]: Stream<OwnershipEvent>;
  };
};

/**
 * What the page serves the storage worker, and sends it: nothing yet. The
 * ports only the page can serve, a sink the person chose among them, arrive
 * with the transfers that write to them.
 */
export type StoragePageSide = {
  readonly operations: Readonly<Record<string, never>>;
  readonly streams: Readonly<Record<string, never>>;
};

/** The handlers of one area's operations, named `<area>.<verb>`. */
export type AreaHandlers<TArea extends string> = Handlers<
  Pick<StorageOperations, Extract<keyof StorageOperations, `${TArea}.${string}`>>
>;

/** The worker's end of the port. */
export type HostChannel = PortChannel<StoragePageSide, StorageWorkerSide>;

/** The page's end of the port. */
export type ClientChannel = PortChannel<StorageWorkerSide, StoragePageSide>;
