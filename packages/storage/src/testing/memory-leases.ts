/**
 * Write leases held in memory, shared by the simulated windows of one test as
 * Web Locks and a broadcast channel are shared by the tabs of one browser
 * profile: one holder per project, a steal that makes the holder's lease lost,
 * requests for a project answered by its holder, watchers told of each change
 * of writer and each checkpoint, and the storage-wide lock, shared or
 * exclusive. Made to refuse, it refuses every lock as a platform that denies
 * the page its lock manager does.
 */

import type { ProjectId } from '@audiogubbins/domain';

import type {
  LeaseAcquisition,
  LeaseCoordinator,
  LeaseLoss,
  LeaseOwner,
  OwnershipEvent,
  ProjectWriteLease,
  StorageLockMode,
  StorageLocking,
  TransferAnswer,
  TransferOutcome,
  TransferRequest,
} from '../write-lease.js';

interface Holding {
  readonly owner: LeaseOwner;
  readonly lose: (loss: LeaseLoss) => void;
  readonly listeners: Set<(request: TransferRequest) => void>;
}

interface Waiting {
  readonly project: ProjectId;
  readonly settle: (outcome: TransferOutcome) => void;
}

/** Leases for the windows of one test. */
export class MemoryLeaseCoordinator implements LeaseCoordinator {
  private readonly holdings = new Map<ProjectId, Holding>();
  private readonly waiting = new Map<string, Waiting>();
  private readonly watchers = new Map<ProjectId, Set<(event: OwnershipEvent) => void>>();
  private readonly refuses: boolean;
  private requests = 0;
  private shared = 0;
  private exclusive = false;
  private readonly sharing: (() => void)[] = [];

  constructor(options: { readonly refuses?: boolean } = {}) {
    this.refuses = options.refuses ?? false;
  }

  acquire(
    project: ProjectId,
    options: { readonly steal: boolean; readonly owner: LeaseOwner },
  ): Promise<LeaseAcquisition> {
    if (this.refuses) return Promise.resolve({ kind: 'unavailable' });
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
      announceCheckpoint: () => {
        if (this.holdings.get(project) === holding) this.tell(project, { kind: 'checkpointed' });
      },
      release: () => {
        if (this.holdings.get(project) !== holding) return Promise.resolve();
        this.holdings.delete(project);
        // Letting the project go is what granting means, so a request its
        // holder never answered is granted by it.
        for (const [id, waiting] of this.waiting) {
          if (waiting.project === project) this.settleRequest(id, 'granted');
        }
        this.tell(project, { kind: 'released' });
        return Promise.resolve();
      },
    };
    this.tell(project, { kind: 'acquired', owner: options.owner });
    return Promise.resolve({ kind: 'held', lease });
  }

  ownerOf(project: ProjectId): Promise<LeaseOwner | undefined> {
    return Promise.resolve(this.holdings.get(project)?.owner);
  }

  requestTransfer(
    project: ProjectId,
    from: LeaseOwner,
    signal?: AbortSignal,
  ): Promise<TransferOutcome> {
    const holding = this.holdings.get(project);
    if (holding === undefined) return Promise.resolve('granted');
    if (holding.listeners.size === 0 || signal?.aborted === true) {
      return Promise.resolve('unreachable');
    }
    this.requests += 1;
    const request: TransferRequest = { id: `request-${String(this.requests)}`, from };
    return new Promise((resolve) => {
      this.waiting.set(request.id, { project, settle: resolve });
      signal?.addEventListener(
        'abort',
        () => {
          this.settleRequest(request.id, 'unreachable');
        },
        { once: true },
      );
      for (const listener of holding.listeners) listener(request);
    });
  }

  answerTransfer(
    _project: ProjectId,
    request: TransferRequest,
    answer: TransferAnswer,
  ): Promise<void> {
    this.settleRequest(request.id, answer);
    return Promise.resolve();
  }

  watchOwnership(project: ProjectId, listener: (event: OwnershipEvent) => void): () => void {
    const watching = this.watchers.get(project) ?? new Set();
    this.watchers.set(project, watching);
    watching.add(listener);
    return () => {
      watching.delete(listener);
    };
  }

  lockStorage(
    mode: StorageLockMode,
    options: { readonly wait: boolean; readonly signal?: AbortSignal },
  ): Promise<StorageLocking> {
    if (this.refuses) return Promise.resolve({ kind: 'unavailable' });
    if (mode === 'exclusive') {
      if (this.exclusive || this.shared > 0) return Promise.resolve({ kind: 'busy' });
      this.exclusive = true;
      return Promise.resolve({ kind: 'held', release: () => this.releaseExclusive() });
    }
    if (!this.exclusive) return Promise.resolve(this.heldShared());
    if (!options.wait) return Promise.resolve({ kind: 'busy' });
    options.signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      const grant = (): void => {
        resolve(this.heldShared());
      };
      this.sharing.push(grant);
      options.signal?.addEventListener(
        'abort',
        () => {
          const index = this.sharing.indexOf(grant);
          if (index < 0) return;
          this.sharing.splice(index, 1);
          reject(abortReason(options.signal));
        },
        { once: true },
      );
    });
  }

  private heldShared(): StorageLocking {
    this.shared += 1;
    let released = false;
    return {
      kind: 'held',
      release: () => {
        if (!released) this.shared -= 1;
        released = true;
        return Promise.resolve();
      },
    };
  }

  private releaseExclusive(): Promise<void> {
    this.exclusive = false;
    for (const grant of this.sharing.splice(0)) grant();
    return Promise.resolve();
  }

  private settleRequest(id: string, outcome: TransferOutcome): void {
    this.waiting.get(id)?.settle(outcome);
    this.waiting.delete(id);
  }

  private tell(project: ProjectId, event: OwnershipEvent): void {
    for (const listener of [...(this.watchers.get(project) ?? [])]) listener(event);
  }
}

/** Why a wait was called off: the signal's reason, where it gave one that is an error. */
function abortReason(signal: AbortSignal | undefined): Error {
  const reason: unknown = signal?.reason;
  return reason instanceof Error ? reason : new Error('The wait was called off.');
}
