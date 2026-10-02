/**
 * The single-writer contract: which window may change a project, how another
 * asks for it, and how one takes it after an explicit decision (REQ-STOR-098,
 * ADR-0020).
 *
 * {@link LeaseCoordinator} is the port the platform implements, with Web Locks
 * and a broadcast channel in the browser; a platform with neither has no
 * coordinator, and every project opens read-only there. A held
 * {@link ProjectWriteLease} is what lets a session write, and it can be lost:
 * taken by another window whose person decided to, or handed over on request.
 * The coordinator decides who may write; the epoch fencing in storage
 * (`lease-records.ts`) makes sure a writer that lost the lease late changes
 * nothing that counts. The coordinator also tells a window that reads a project
 * when its writer changes or writes a checkpoint, so the reader can load the
 * latest state, and holds the one lock that spans the whole storage, which
 * keeps a purge or a cleanup in one window from removing what another is
 * writing and has yet to finish (REQ-STOR-102).
 */

import type { ProjectId } from '@audiogubbins/domain';

/** Who holds or asks for a project, as another window can describe them. */
export interface LeaseOwner {
  /** Identifies the application instance, stable for its life. */
  readonly instance: string;

  /** How the person would know the window, such as "Tab opened at 10:42". */
  readonly label: string;
}

/** Why a held lease was lost. */
export type LeaseLoss = {
  readonly kind: 'taken';

  /** The window that took it, where it is known. */
  readonly by?: LeaseOwner;
};

/** Another window's request for a project the holder is writing. */
export interface TransferRequest {
  /** Identifies the request, for the answer. */
  readonly id: string;
  readonly from: LeaseOwner;
}

/** A write lease held on one project. */
export interface ProjectWriteLease {
  readonly project: ProjectId;

  /** Settles when the lease is lost, which a holder must stop writing on at once. */
  readonly lost: Promise<LeaseLoss>;

  /**
   * Calls `listener` with each request another window makes for the project,
   * until the returned function is called.
   */
  onTransferRequest(listener: (request: TransferRequest) => void): () => void;

  /** Tells every window watching the project that a checkpoint of it was written. */
  announceCheckpoint(): void;

  /** Lets the project go, for this window or another to take. */
  release(): Promise<void>;
}

/** What asking for a lease found. */
export type LeaseAcquisition =
  | { readonly kind: 'held'; readonly lease: ProjectWriteLease }
  | {
      readonly kind: 'busy';

      /** The window holding it, where it can be told. */
      readonly owner?: LeaseOwner;
    }
  /**
   * The platform refused the lock, as a sandboxed frame's may: no window can be
   * sure it is the only writer, which is not the same as another writing.
   */
  | { readonly kind: 'unavailable' };

/** How a holder answered a request for its project. */
export type TransferAnswer = 'granted' | 'declined';

/**
 * How a request for a project ended: the holder's answer, or `unreachable`
 * where the request could not be delivered or no writer answered before the
 * asker stopped waiting.
 */
export type TransferOutcome = TransferAnswer | 'unreachable';

/** What a window watching a project hears of its writer. */
export type OwnershipEvent =
  /** A window took the lease, opening the project to write or taking it over. */
  | { readonly kind: 'acquired'; readonly owner?: LeaseOwner }
  /** The writer let the project go, having written everything it held. */
  | { readonly kind: 'released' }
  /** The writer wrote a checkpoint, so storage holds a newer state. */
  | { readonly kind: 'checkpointed' };

/** How a window takes the lock that spans the whole storage (`storage-sharing.ts`). */
export type StorageLockMode =
  /**
   * Held by each window while it writes what is not whole until it finishes:
   * media it has yet to refer to, a project being made or a backup generation,
   * by as many as are writing at once.
   */
  | 'shared'
  /**
   * Held by one window alone, while it removes what may be left over: media
   * nothing refers to, projects never finished and generations left incomplete.
   */
  | 'exclusive';

/** What asking for the storage-wide lock found. */
export type StorageLocking =
  | { readonly kind: 'held'; readonly release: () => Promise<void> }
  /** Another holder keeps it from being taken now; only where the asker would not wait. */
  | { readonly kind: 'busy' }
  /** The platform refused the lock. */
  | { readonly kind: 'unavailable' };

/** The platform's coordination of write leases across windows. */
export interface LeaseCoordinator {
  /**
   * Takes the lease on a project, or reports who holds it. With `steal`, takes
   * it from its holder, whose lease is lost: only after the person decided to,
   * where the holder is unavailable or stale.
   */
  acquire(
    project: ProjectId,
    options: { readonly steal: boolean; readonly owner: LeaseOwner },
  ): Promise<LeaseAcquisition>;

  /** The window holding a project's lease, where one does and can be told. */
  ownerOf(project: ProjectId): Promise<LeaseOwner | undefined>;

  /**
   * Asks the holder of a project's lease to hand it over, settling with its
   * answer. Granted means the holder has let the project go, which is also the
   * answer where no window holds it. Settles `unreachable` at once where the
   * request cannot reach the holder, and once `signal` aborts where the holder
   * has not answered by then: how long to wait is the asker's to say.
   */
  requestTransfer(
    project: ProjectId,
    from: LeaseOwner,
    signal?: AbortSignal,
  ): Promise<TransferOutcome>;

  /**
   * Answers a request for a project this window holds. The holder lets its
   * lease go before it grants one.
   */
  answerTransfer(
    project: ProjectId,
    request: TransferRequest,
    answer: TransferAnswer,
  ): Promise<void>;

  /**
   * Calls `listener` with each change of the project's writer, and each
   * checkpoint it writes, until the returned function is called. A writer that
   * vanishes without a word, as a closed tab may, is not heard of.
   */
  watchOwnership(project: ProjectId, listener: (event: OwnershipEvent) => void): () => void;

  /**
   * Takes the storage-wide lock in `mode`. With `wait`, waits for it, and
   * rejects with the signal's reason where `signal` aborts first; without, is
   * `busy` where it cannot be taken at once. A window that waited for the
   * exclusive lock while it held the shared one would wait for ever, so the
   * exclusive lock is asked for without waiting.
   */
  lockStorage(
    mode: StorageLockMode,
    options: { readonly wait: boolean; readonly signal?: AbortSignal },
  ): Promise<StorageLocking>;
}
