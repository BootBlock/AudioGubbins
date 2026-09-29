/**
 * What an open project's window may do with it, as its write lease decides:
 * write while it holds the lease, hearing other windows' requests for it; stop
 * at once where the lease is lost; and let it go, handing it over or closing
 * it, only once everything is saved (REQ-STOR-098).
 *
 * The session asks here whether it may write, and every change to the access is
 * told to it to publish. Letting go writes a checkpoint first and is refused
 * while anything is not saved, since the window that takes the project next
 * could not see it.
 */

import type { Logger } from '@audiogubbins/diagnostics';
import { fail, succeed, type DomainResult, type ProjectId } from '@audiogubbins/domain';

import type { ProjectModel } from './project-model.js';
import type { ProjectAccess } from './project-snapshot.js';
import { unsavedChanges } from './session-failures.js';
import type { SessionWriter } from './session-writer.js';
import type {
  LeaseCoordinator,
  LeaseLoss,
  ProjectWriteLease,
  TransferAnswer,
  TransferRequest,
} from './write-lease.js';

/** What an open project's lease works with. */
export interface OwnershipServices {
  readonly project: ProjectId;
  readonly lease: ProjectWriteLease;
  readonly coordinator: LeaseCoordinator;
  readonly writer: SessionWriter;
  readonly logger: Logger;

  /** Called whenever the access changes, to publish it. */
  readonly onChange: () => void;
}

/** An open project's access, under its write lease (see the module comment). */
export class SessionOwnership {
  private readonly services: OwnershipServices;
  private current: ProjectAccess = { kind: 'writable', transferRequests: [] };

  constructor(services: OwnershipServices) {
    this.services = services;
    void services.lease.lost.then((loss) => {
      this.lose(loss);
    });
    services.lease.onTransferRequest((request) => {
      this.hear(request);
    });
  }

  get access(): ProjectAccess {
    return this.current;
  }

  /**
   * Answers another window's request for the project, `model` being the project
   * as it now is. A grant refused for unsaved changes leaves the request
   * waiting, to be granted once they are saved or declined.
   */
  async answer(
    request: TransferRequest,
    answer: TransferAnswer,
    model: ProjectModel,
  ): Promise<DomainResult<void>> {
    if (answer === 'granted') {
      const released = await this.letGo({ kind: 'handed-over' }, model);
      if (!released.ok) return released;
    }
    this.forget(request);
    const { coordinator, project, onChange } = this.services;
    await coordinator.answerTransfer(project, request, answer);
    onChange();
    return succeed(undefined);
  }

  /** Checkpoints `model`, stops writing and lets the lease go, unless something is not saved. */
  async letGo(ended: ProjectAccess, model: ProjectModel): Promise<DomainResult<void>> {
    const { writer, lease, onChange } = this.services;
    const saved = await writer.checkpoint(model);
    if (saved.kind !== 'written') return fail(unsavedChanges(writer.status));
    writer.queue.stop();
    this.current = ended;
    await lease.release();
    onChange();
    return succeed(undefined);
  }

  /** Stops writing at once: the lease is lost, and what was not written is lost with it. */
  lose(loss: LeaseLoss): void {
    if (this.current.kind !== 'writable') return;
    const unsaved = this.services.writer.queue.stop();
    this.current = { kind: 'lost', loss, unsaved };
    this.services.logger.warning('The project was taken by another window; this one stopped.', {
      count: unsaved,
    });
    this.services.onChange();
  }

  private hear(request: TransferRequest): void {
    if (this.current.kind !== 'writable') return;
    const transferRequests = [...this.current.transferRequests, request];
    this.current = { kind: 'writable', transferRequests };
    this.services.onChange();
  }

  private forget(request: TransferRequest): void {
    if (this.current.kind !== 'writable') return;
    const transferRequests = this.current.transferRequests.filter((held) => held.id !== request.id);
    this.current = { kind: 'writable', transferRequests };
  }
}
