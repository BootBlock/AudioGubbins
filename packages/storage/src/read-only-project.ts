/**
 * A project open to read and not to write: in a window without the write lease,
 * on a platform that cannot coordinate writers, or where the person asked for
 * it (REQ-STOR-098).
 *
 * It has no operation that could change the project or write a byte, so a
 * window that does not hold the lease cannot write by mistake: the type offers
 * nothing to call. It can ask the window that holds the project to hand it
 * over; once that is granted, the application opens the project again to write,
 * which loads the latest state the other window left.
 */

import { fail, succeed, type DomainResult, type ProjectId } from '@audiogubbins/domain';

import type { ProjectModel } from './project-model.js';
import {
  SnapshotPublisher,
  type ProjectSnapshot,
  type ReadOnlyReason,
} from './project-snapshot.js';
import { noCoordination } from './storage-failures.js';
import type { LeaseCoordinator, LeaseOwner, TransferAnswer } from './write-lease.js';

/** A project open to read (see the module comment). */
export class ReadOnlyProject {
  readonly project: ProjectId;
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => ProjectSnapshot;

  private readonly coordinator: LeaseCoordinator | undefined;
  private readonly owner: LeaseOwner;

  constructor(
    project: ProjectId,
    model: ProjectModel,
    reason: ReadOnlyReason,
    coordination: { readonly coordinator?: LeaseCoordinator; readonly owner: LeaseOwner },
  ) {
    this.project = project;
    this.coordinator = coordination.coordinator;
    this.owner = coordination.owner;
    const publisher = new SnapshotPublisher({
      project,
      model,
      save: { kind: 'saved' },
      access: { kind: 'read-only', reason },
    });
    this.subscribe = publisher.subscribe;
    this.getSnapshot = publisher.getSnapshot;
  }

  /**
   * Asks the window writing the project to hand it over, settling with its
   * answer. Refused where the platform cannot coordinate writers.
   */
  readonly requestTransfer = async (): Promise<DomainResult<TransferAnswer>> =>
    this.coordinator === undefined
      ? fail(noCoordination())
      : succeed(await this.coordinator.requestTransfer(this.project, this.owner));
}
