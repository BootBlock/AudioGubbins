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
 *
 * Where the platform coordinates writers, it watches the project, and loads the
 * project again from storage and publishes it whenever a window takes the
 * project to write, whenever the writer lets it go, and whenever the writer
 * writes a checkpoint: each is a moment storage holds a newer authoritative
 * state, and a takeover may also have fenced records it had read. The reason it
 * reads rather than writes follows the writer: another window's name once one
 * takes it, and that none writes it once it is let go. Loads run one at a time,
 * and an event heard during one loads once more after it; a load that fails
 * keeps the state last loaded, logged, until the next event.
 */

import type { Logger } from '@audiogubbins/diagnostics';
import { fail, succeed, type DomainResult, type ProjectId } from '@audiogubbins/domain';

import type { ProjectModel } from './project-model.js';
import {
  SnapshotPublisher,
  type ProjectSnapshot,
  type ReadOnlyReason,
} from './project-snapshot.js';
import { noCoordination } from './storage-failures.js';
import type {
  LeaseCoordinator,
  LeaseOwner,
  OwnershipEvent,
  TransferOutcome,
} from './write-lease.js';

/** What a project open to read works with. */
export interface ReadOnlyServices {
  /** The coordination to watch the writer and ask it with, absent where writers are not coordinated. */
  readonly coordinator?: LeaseCoordinator;
  readonly owner: LeaseOwner;
  readonly logger: Logger;

  /** Rebuilds the project from storage as it is now. */
  readonly reload: (signal: AbortSignal) => Promise<DomainResult<ProjectModel>>;
}

/** A project open to read (see the module comment). */
export class ReadOnlyProject {
  readonly project: ProjectId;
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => ProjectSnapshot;

  private readonly services: ReadOnlyServices;
  private readonly publisher: SnapshotPublisher;
  private readonly closing = new AbortController();
  private readonly stopWatching: () => void;
  private loading: Promise<void> | undefined;
  private loadAgain = false;

  constructor(
    project: ProjectId,
    model: ProjectModel,
    reason: ReadOnlyReason,
    services: ReadOnlyServices,
  ) {
    this.project = project;
    this.services = services;
    this.publisher = new SnapshotPublisher({
      project,
      model,
      save: { kind: 'saved' },
      access: { kind: 'read-only', reason },
    });
    this.subscribe = this.publisher.subscribe;
    this.getSnapshot = this.publisher.getSnapshot;
    this.stopWatching =
      services.coordinator?.watchOwnership(project, (event) => {
        this.hear(event);
      }) ?? (() => undefined);
  }

  /**
   * Asks the window writing the project to hand it over, settling with its
   * answer, or `unreachable` where it cannot be asked or has not answered by
   * the time `signal` aborts. Refused where the platform cannot coordinate
   * writers.
   */
  readonly requestTransfer = async (
    signal?: AbortSignal,
  ): Promise<DomainResult<TransferOutcome>> =>
    this.services.coordinator === undefined
      ? fail(noCoordination())
      : succeed(
          await this.services.coordinator.requestTransfer(
            this.project,
            this.services.owner,
            signal,
          ),
        );

  /** Stops watching the project and calls off a load in progress. */
  readonly close = (): void => {
    this.stopWatching();
    this.closing.abort();
  };

  private hear(event: OwnershipEvent): void {
    const { access } = this.getSnapshot();
    if (access.kind === 'read-only' && access.reason.kind !== 'requested') {
      const reason = reasonAfter(event, access.reason);
      if (reason !== access.reason) this.publish({ access: { kind: 'read-only', reason } });
    }
    this.load();
  }

  /** Loads the project again, or once more after the load in progress. */
  private load(): void {
    if (this.loading !== undefined) {
      this.loadAgain = true;
      return;
    }
    this.loading = this.loadUntilCurrent().finally(() => {
      this.loading = undefined;
    });
  }

  private async loadUntilCurrent(): Promise<void> {
    const { signal } = this.closing;
    this.loadAgain = false;
    do {
      if (signal.aborted) return;
      const loaded = await this.services.reload(signal).catch((error: unknown) => {
        // Closing aborts the load, which rejects with the signal's reason; any
        // other rejection is a fault, left to surface as one.
        if (signal.aborted) return undefined;
        throw error;
      });
      if (loaded === undefined) return;
      if (loaded.ok) this.publish({ model: loaded.value });
      else {
        this.services.logger.warning('A project open to read could not be loaded again.', {
          code: loaded.failures[0].code,
        });
      }
    } while (this.takeLoadAgain());
  }

  /** Whether an event was heard since the load began, forgetting it once told. */
  private takeLoadAgain(): boolean {
    const again = this.loadAgain;
    this.loadAgain = false;
    return again;
  }

  private publish(change: Partial<Pick<ProjectSnapshot, 'model' | 'access'>>): void {
    this.publisher.publish({ ...this.getSnapshot(), ...change });
  }
}

/** Why a project is read after its writer changed, where it follows the writer. */
function reasonAfter(event: OwnershipEvent, reason: ReadOnlyReason): ReadOnlyReason {
  switch (event.kind) {
    case 'acquired':
      return event.owner === undefined ? { kind: 'busy' } : { kind: 'busy', owner: event.owner };
    case 'released':
      return { kind: 'released' };
    case 'checkpointed':
      return reason;
  }
}
