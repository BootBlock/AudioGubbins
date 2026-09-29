/**
 * Write leases held in memory, shared by the simulated windows of one test as
 * Web Locks and a broadcast channel are shared by the tabs of one browser
 * profile: one holder per project, a steal that makes the holder's lease lost,
 * and requests for a project answered by its holder.
 */

import type { ProjectId } from '@audiogubbins/domain';

import type {
  LeaseAcquisition,
  LeaseCoordinator,
  LeaseLoss,
  LeaseOwner,
  ProjectWriteLease,
  TransferAnswer,
  TransferRequest,
} from '../write-lease.js';

interface Holding {
  readonly owner: LeaseOwner;
  readonly lose: (loss: LeaseLoss) => void;
  readonly listeners: Set<(request: TransferRequest) => void>;
}

/** Leases for the windows of one test. */
export class MemoryLeaseCoordinator implements LeaseCoordinator {
  private readonly holdings = new Map<ProjectId, Holding>();
  private readonly waiting = new Map<string, (answer: TransferAnswer) => void>();
  private requests = 0;

  acquire(
    project: ProjectId,
    options: { readonly steal: boolean; readonly owner: LeaseOwner },
  ): Promise<LeaseAcquisition> {
    const current = this.holdings.get(project);
    if (current !== undefined && !options.steal) {
      return Promise.resolve({ kind: 'busy', owner: current.owner });
    }
    if (current !== undefined) {
      this.holdings.delete(project);
      current.lose({ kind: 'taken', by: options.owner });
    }

    let lose: (loss: LeaseLoss) => void = () => undefined;
    const lost = new Promise<LeaseLoss>((resolve) => {
      lose = resolve;
    });
    const holding: Holding = { owner: options.owner, lose, listeners: new Set() };
    this.holdings.set(project, holding);
    const lease: ProjectWriteLease = {
      project,
      lost,
      onTransferRequest: (listener) => {
        holding.listeners.add(listener);
        return () => {
          holding.listeners.delete(listener);
        };
      },
      release: () => {
        if (this.holdings.get(project) === holding) this.holdings.delete(project);
        return Promise.resolve();
      },
    };
    return Promise.resolve({ kind: 'held', lease });
  }

  ownerOf(project: ProjectId): Promise<LeaseOwner | undefined> {
    return Promise.resolve(this.holdings.get(project)?.owner);
  }

  requestTransfer(project: ProjectId, from: LeaseOwner): Promise<TransferAnswer> {
    const holding = this.holdings.get(project);
    if (holding === undefined) return Promise.resolve('granted');
    this.requests += 1;
    const request: TransferRequest = { id: `request-${String(this.requests)}`, from };
    return new Promise((resolve) => {
      this.waiting.set(request.id, resolve);
      for (const listener of holding.listeners) listener(request);
    });
  }

  answerTransfer(
    _project: ProjectId,
    request: TransferRequest,
    answer: TransferAnswer,
  ): Promise<void> {
    this.waiting.get(request.id)?.(answer);
    this.waiting.delete(request.id);
    return Promise.resolve();
  }
}
