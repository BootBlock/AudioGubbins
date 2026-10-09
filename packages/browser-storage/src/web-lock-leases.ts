/**
 * The storage's {@link LeaseCoordinator} over Web Locks and a broadcast channel
 * per project: at most one writer per project across the windows of a browser
 * profile (REQ-STOR-098, ADR-0020).
 *
 * The lock named `audiogubbins.project.<id>` is the lease. It is taken without
 * waiting, so a second window opens read-only at once, and taken with `steal`
 * only after the person decided to, which rejects the holder's lock request
 * with an `AbortError` and makes its lease lost. The channel of the same name
 * carries what the lock cannot: the holder answers who it is, hears requests
 * for the project, and hears that a window is about to take it.
 *
 * A requester learns a transfer was granted by the lock coming free, since that
 * is what granting means and it also covers a holder that closed the project or
 * went away, and learns a refusal from the holder's answer. A request that no
 * channel can carry is unreachable at once, and one the holder has not answered
 * by the time the asker's signal aborts is unreachable then.
 *
 * The channel also tells every window watching a project that a window took it,
 * that its writer let it go once the lock is free, and that the writer wrote a
 * checkpoint; watchers in this window hear the same from it directly, since a
 * window never hears its own channel.
 *
 * A window that takes a project says so before it steals the lock, but the
 * browser delivers a channel's message and a lock's steal in no set order, so
 * the holder may lose the lock before the notice comes. It then asks who holds
 * the project now, and reports the loss with the first name it hears, the late
 * notice's or the taker's answer, or unnamed once the patience runs out. The
 * wait is safe because the epoch fencing keeps a late writer's work from
 * counting, and short because the taker answers as soon as it holds the lock.
 *
 * Nothing here decides for the person: a busy project is reported with its
 * owner where the owner answers, and a lock the browser refuses is reported as
 * unavailable, which opens the project read-only, never writable.
 */

import type { Logger } from '@audiogubbins/diagnostics';
import type {
  LeaseAcquisition,
  LeaseCoordinator,
  LeaseOwner,
  OwnershipEvent,
  StorageLockMode,
  StorageLocking,
  TransferAnswer,
  TransferOutcome,
  TransferRequest,
} from '@audiogubbins/storage';

import { HeldLease, type ProjectId } from './held-lease.js';
import { ownershipEventOf, type LeaseMessage } from './lease-messages.js';
import { ProjectChannels, type OpenLeaseChannel } from './project-channels.js';
import type { LeaseLocks } from './lock-manager.js';
import { askOwner, type OwnerAsking } from './owner-questions.js';
import { LIBRARY_LOCK, STORAGE_LOCK, takeLock } from './storage-lock.js';

/** What a window coordinates its leases with, each made once by the composition root. */
export interface WebLeaseServices {
  /** The profile's lock manager, `StoragePlatform.locks`. */
  readonly locks: LeaseLocks | undefined;

  /** Opens a broadcast channel, `StoragePlatform.openBroadcastChannel`. */
  readonly openChannel: OpenLeaseChannel | undefined;

  /** This window's opaque instance, which names its questions and requests. */
  readonly instance: string;

  /**
   * Settles once a question put to the other windows has waited long enough for
   * an answer, after which the window that holds a project and has not answered
   * is taken to be one that cannot be described.
   */
  readonly patience: () => Promise<void>;
  readonly logger: Logger;
}

type Taking = 'held' | 'busy' | 'refused';

/** The name of a project's lock and of its channel. */
function lockNameOf(project: ProjectId): string {
  return `audiogubbins.project.${project}`;
}

/**
 * The coordinator of a window, or `undefined` where the browser has no Web
 * Locks, so every project opens read-only: a channel alone cannot make one
 * writer certain.
 */
export function createLeaseCoordinator(services: WebLeaseServices): LeaseCoordinator | undefined {
  return services.locks === undefined ? undefined : new WebLockLeases(services.locks, services);
}

class WebLockLeases implements LeaseCoordinator {
  readonly #locks: LeaseLocks;
  readonly #services: WebLeaseServices;
  readonly #channels: ProjectChannels;
  readonly #asking: OwnerAsking;
  readonly #held = new Map<ProjectId, HeldLease>();
  readonly #watchers = new Map<ProjectId, Set<(event: OwnershipEvent) => void>>();

  /** This window's own requests waiting for an answer, by identifier. */
  readonly #waiting = new Map<string, (answer: TransferAnswer) => void>();
  #asked = 0;

  constructor(locks: LeaseLocks, services: WebLeaseServices) {
    this.#locks = locks;
    this.#services = services;
    this.#channels = new ProjectChannels(services.openChannel, services.logger);
    this.#asking = { channels: this.#channels, patience: services.patience };
  }

  async acquire(
    project: ProjectId,
    options: { readonly steal: boolean; readonly owner: LeaseOwner },
  ): Promise<LeaseAcquisition> {
    const name = lockNameOf(project);
    if (options.steal) {
      this.#held.get(project)?.noteTaking(options.owner);
      this.#channels.post(name, { kind: 'taking', by: options.owner });
    }
    const lease = new HeldLease(project, options.owner, () => {
      this.#announce(project, { kind: 'checkpointed' });
    });
    const taking = await this.#take(lease, options.steal);
    if (taking === 'held') {
      this.#hold(lease);
      this.#announce(project, { kind: 'acquired', owner: options.owner });
      return { kind: 'held', lease };
    }
    if (taking === 'refused') return { kind: 'unavailable' };
    const owner = await this.ownerOf(project);
    return owner === undefined ? { kind: 'busy' } : { kind: 'busy', owner };
  }

  async ownerOf(project: ProjectId): Promise<LeaseOwner | undefined> {
    const held = this.#held.get(project);
    if (held !== undefined) return held.owner;
    const name = lockNameOf(project);
    if (!(await this.#isHeld(name))) return undefined;
    const owner = await askOwner(this.#asking, name, this.#nextId(), () => undefined);
    if (owner === undefined) {
      this.#services.logger.debug('The window writing a project did not say who it is.');
    }
    return owner;
  }

  async requestTransfer(
    project: ProjectId,
    from: LeaseOwner,
    signal?: AbortSignal,
  ): Promise<TransferOutcome> {
    const name = lockNameOf(project);
    const holder = this.#held.get(project);
    if (holder === undefined && !(await this.#isHeld(name))) return 'granted';
    if (signal?.aborted === true) return 'unreachable';
    const request: TransferRequest = { id: this.#nextId(), from };
    const watch = new AbortController();
    let stop: () => void = () => undefined;
    const outcome = await new Promise<TransferOutcome>((resolve) => {
      this.#waiting.set(request.id, resolve);
      stop = this.#channels.listen(name, (message) => {
        if (message.kind === 'transfer-answer' && message.request === request.id) {
          resolve(message.answer);
        }
      });
      void this.#watchFree(name, watch.signal).then((free) => {
        if (free) resolve('granted');
      });
      signal?.addEventListener(
        'abort',
        () => {
          resolve('unreachable');
        },
        { once: true },
      );
      if (holder !== undefined) holder.hearRequest(request);
      else if (!this.#channels.post(name, { kind: 'transfer-request', request })) {
        this.#services.logger.warning('A request for a project could not reach its writer.');
        resolve('unreachable');
      }
    });
    watch.abort();
    stop();
    this.#waiting.delete(request.id);
    return outcome;
  }

  answerTransfer(
    project: ProjectId,
    request: TransferRequest,
    answer: TransferAnswer,
  ): Promise<void> {
    const local = this.#waiting.get(request.id);
    if (local !== undefined) local(answer);
    else {
      this.#channels.post(lockNameOf(project), {
        kind: 'transfer-answer',
        request: request.id,
        answer,
      });
    }
    return Promise.resolve();
  }

  watchOwnership(project: ProjectId, listener: (event: OwnershipEvent) => void): () => void {
    const watching = this.#watchers.get(project) ?? new Set();
    this.#watchers.set(project, watching);
    watching.add(listener);
    const stop = this.#channels.listen(lockNameOf(project), (message) => {
      const event = ownershipEventOf(message);
      if (event !== undefined) listener(event);
    });
    return () => {
      watching.delete(listener);
      stop();
    };
  }

  lockStorage(
    mode: StorageLockMode,
    options: { readonly wait: boolean; readonly signal?: AbortSignal },
  ): Promise<StorageLocking> {
    return takeLock(this.#locks, STORAGE_LOCK, mode, options, this.#services.logger);
  }

  lockLibrary(options: { readonly signal?: AbortSignal }): Promise<StorageLocking> {
    return takeLock(
      this.#locks,
      LIBRARY_LOCK,
      'exclusive',
      { wait: true, ...options },
      this.#services.logger,
    );
  }

  /** Tells the watchers of this window and of every other of a change to a project. */
  #announce(project: ProjectId, event: OwnershipEvent): void {
    for (const listener of [...(this.#watchers.get(project) ?? [])]) listener(event);
    this.#channels.post(lockNameOf(project), event);
  }

  /** Asks for the lock, holding it until the lease lets it go or it is taken. */
  #take(lease: HeldLease, steal: boolean): Promise<Taking> {
    const name = lockNameOf(lease.project);
    return new Promise<Taking>((resolve, reject) => {
      let granted = false;
      let request: Promise<void>;
      try {
        request = this.#locks.request(
          name,
          steal ? { steal: true } : { ifAvailable: true },
          async (lock) => {
            if (lock === null) {
              resolve('busy');
              return;
            }
            granted = true;
            resolve('held');
            await lease.kept;
          },
        );
      } catch (error) {
        // The browser refuses with a `DOMException`, such as a `SecurityError`
        // in a sandboxed frame; anything else is a fault, not a refusal.
        if (!(error instanceof DOMException)) throw error;
        resolve(this.#refused(error));
        return;
      }
      request.then(
        () => {
          lease.ended();
          this.#announce(lease.project, { kind: 'released' });
        },
        (error: unknown) => {
          if (granted) this.#lost(lease, error);
          else if (error instanceof DOMException) resolve(this.#refused(error));
          else if (error instanceof Error) reject(error);
          else reject(new Error('The lock request failed.', { cause: error }));
        },
      );
    });
  }

  /** Answers the other windows about a held project until its lease ends. */
  #hold(lease: HeldLease): void {
    const name = lockNameOf(lease.project);
    this.#held.set(lease.project, lease);
    const stop = this.#channels.listen(name, (message) => {
      this.#hearAsHolder(lease, message);
    });
    const forget = (): void => {
      stop();
      if (this.#held.get(lease.project) === lease) this.#held.delete(lease.project);
    };
    void lease.over.then(forget);
    void lease.kept.then(forget);
  }

  #hearAsHolder(lease: HeldLease, message: LeaseMessage): void {
    const name = lockNameOf(lease.project);
    switch (message.kind) {
      case 'who-owns':
        this.#channels.post(name, {
          kind: 'owner',
          question: message.question,
          owner: lease.owner,
        });
        return;
      case 'transfer-request':
        lease.hearRequest(message.request);
        return;
      case 'taking':
        lease.noteTaking(message.by);
        return;
      case 'owner':
      case 'transfer-answer':
        return;
    }
  }

  /**
   * Waits for the lock to come free, answering `true` once it has, and `false`
   * where the wait was called off or the browser refused it.
   */
  async #watchFree(name: string, signal: AbortSignal): Promise<boolean> {
    try {
      await this.#locks.request(name, { signal }, () => Promise.resolve());
      return true;
    } catch (error) {
      if (!(error instanceof DOMException)) throw error;
      // Called off once the request was answered, which is expected; any other
      // refusal leaves the holder's answer to settle the request.
      if (error.name !== 'AbortError') {
        this.#services.logger.warning('The browser refused to watch a project’s lock.', {
          reason: error.name,
        });
      }
      return false;
    }
  }

  /** Whether the lock is held, taken to be where the browser will not say. */
  async #isHeld(name: string): Promise<boolean> {
    try {
      const snapshot = await this.#locks.query();
      return snapshot.held?.some((lock) => lock.name === name) ?? false;
    } catch (error) {
      if (!(error instanceof DOMException)) throw error;
      return true;
    }
  }

  /**
   * Ends a lease whose lock the browser no longer holds for this window. A
   * steal is the designed way to lose one; any other way, such as the browser
   * dropping the lock, ends it all the same, since the lock is what made this
   * window the writer.
   */
  #lost(lease: HeldLease, error: unknown): void {
    lease.taken();
    const stolen = error instanceof DOMException && error.name === 'AbortError';
    if (!stolen) {
      this.#services.logger.warning('The browser let a held project’s lock go.', {
        reason: error instanceof DOMException ? error.name : 'unknown',
      });
      lease.reportLoss(undefined);
    } else if (lease.takenBy !== undefined) lease.reportLoss(lease.takenBy);
    else {
      void this.#taker(lease).then((by) => {
        lease.reportLoss(by);
      });
    }
  }

  /**
   * Learns who took a project from this window before its notice came (see
   * the module comment).
   */
  async #taker(lease: HeldLease): Promise<LeaseOwner | undefined> {
    const name = lockNameOf(lease.project);
    const by = await askOwner(this.#asking, name, this.#nextId(), (message) =>
      message.kind === 'taking' ? message.by : undefined,
    );
    if (by !== undefined) return by;
    this.#services.logger.debug('The window that took a project did not say who it is.');
    return undefined;
  }

  /** Logs a lock the browser refused, which leaves the project read-only. */
  #refused(error: DOMException): Taking {
    this.#services.logger.warning(
      'The browser refused the project’s lock, so this window does not write it.',
      { reason: error.name },
    );
    return 'refused';
  }

  #nextId(): string {
    this.#asked += 1;
    return `${this.#services.instance}.${String(this.#asked)}`;
  }
}
