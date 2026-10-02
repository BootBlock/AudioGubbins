/**
 * What the interface reads of an open project, and how it hears of a change
 * (ADR-0011, REQ-STOR-021, REQ-STOR-098).
 *
 * An open project publishes one immutable snapshot at a time: the project, the
 * save status and the access this window has to it. The interface subscribes
 * and reads the latest snapshot, as `useSyncExternalStore` expects, through
 * members that are properties, so a reader never holds an unbound method.
 */

import type { ProjectId } from '@audiogubbins/domain';

import type { ProjectModel } from './project-model.js';
import type { LeaseLoss, LeaseOwner, TransferRequest } from './write-lease.js';
import type { SaveStatus } from './write-queue.js';

/** Why a project is open to read and not to write. */
export type ReadOnlyReason =
  /** The person asked for it read-only. */
  | { readonly kind: 'requested' }
  /** Another window holds the write lease. */
  | { readonly kind: 'busy'; readonly owner?: LeaseOwner }
  /** The window that wrote the project let it go, and none writes it now. */
  | { readonly kind: 'released' }
  /** The platform cannot coordinate writers, so none may write (REQ-STOR-098). */
  | { readonly kind: 'no-coordination' };

/** What this window may do with an open project. */
export type ProjectAccess =
  /** It holds the write lease; other windows may be asking for it. */
  | { readonly kind: 'writable'; readonly transferRequests: readonly TransferRequest[] }
  | { readonly kind: 'read-only'; readonly reason: ReadOnlyReason }
  /**
   * It lost the lease: it writes nothing more, and the changes not yet written
   * are lost with it. The person may reopen the project read-only.
   */
  | { readonly kind: 'lost'; readonly loss: LeaseLoss; readonly unsaved: number }
  /** It handed the project to another window that asked for it. */
  | { readonly kind: 'handed-over' }
  /** It closed the project. */
  | { readonly kind: 'closed' };

/** One moment of an open project, as the interface reads it. */
export interface ProjectSnapshot {
  readonly project: ProjectId;
  readonly model: ProjectModel;
  readonly save: SaveStatus;
  readonly access: ProjectAccess;
}

/** Holds the latest snapshot and tells subscribers when it changes. */
export class SnapshotPublisher {
  private readonly listeners = new Set<() => void>();
  private current: ProjectSnapshot;

  constructor(initial: ProjectSnapshot) {
    this.current = initial;
  }

  /** Calls `listener` after each change until the returned function is called. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** The latest snapshot: the same value until something changes. */
  readonly getSnapshot = (): ProjectSnapshot => this.current;

  /** Makes `next` the latest snapshot and tells every subscriber. */
  publish(next: ProjectSnapshot): void {
    this.current = next;
    for (const listener of [...this.listeners]) listener();
  }
}
