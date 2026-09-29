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
 * nothing that counts.
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
    };

/** How a holder answered a request for its project. */
export type TransferAnswer = 'granted' | 'declined';

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
   * answer. Granted means the holder has let the project go.
   */
  requestTransfer(project: ProjectId, from: LeaseOwner): Promise<TransferAnswer>;

  /**
   * Answers a request for a project this window holds. The holder lets its
   * lease go before it grants one.
   */
  answerTransfer(
    project: ProjectId,
    request: TransferRequest,
    answer: TransferAnswer,
  ): Promise<void>;
}
