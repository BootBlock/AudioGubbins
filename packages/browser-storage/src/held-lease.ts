/**
 * A project's write lease while this window holds its Web Lock (REQ-STOR-098).
 *
 * The lock is held for as long as the promise its callback returns is pending,
 * so the lease keeps that promise and settles it to let the project go. The
 * lock request's own promise settles once the lock is no longer held: fulfilled
 * where this window let it go, rejected where the lock was taken from it, which
 * with a steal is an `AbortError`. That settling is what the lease learns it
 * ended by, whatever ended it.
 */

import type {
  LeaseLoss,
  LeaseOwner,
  ProjectWriteLease,
  TransferRequest,
} from '@audiogubbins/storage';

/**
 * A project's identifier, as the storage's lease contract carries it, which
 * spares this package a dependency on the domain for one type.
 */
export type ProjectId = ProjectWriteLease['project'];

/** A write lease over a held Web Lock (see the module comment). */
export class HeldLease implements ProjectWriteLease {
  readonly project: ProjectId;
  readonly owner: LeaseOwner;
  readonly lost: Promise<LeaseLoss>;

  /** Pending while the lock is to be held; the lock callback returns it. */
  readonly kept: Promise<void>;

  readonly #listeners = new Set<(request: TransferRequest) => void>();
  readonly #announceCheckpoint: () => void;
  readonly #ended: Promise<void>;
  #over = false;
  #letGo: () => void = () => undefined;
  #lose: (loss: LeaseLoss) => void = () => undefined;
  #end: () => void = () => undefined;
  #takenBy: LeaseOwner | undefined;

  constructor(project: ProjectId, owner: LeaseOwner, announceCheckpoint: () => void) {
    this.project = project;
    this.owner = owner;
    this.#announceCheckpoint = announceCheckpoint;
    this.kept = new Promise((resolve) => {
      this.#letGo = resolve;
    });
    this.lost = new Promise((resolve) => {
      this.#lose = resolve;
    });
    this.#ended = new Promise((resolve) => {
      this.#end = resolve;
    });
  }

  onTransferRequest(listener: (request: TransferRequest) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** Tells the watching windows of a checkpoint, while this window still writes the project. */
  announceCheckpoint(): void {
    if (!this.#over) this.#announceCheckpoint();
  }

  /** Lets the lock go, settling once the browser no longer holds it for this window. */
  async release(): Promise<void> {
    this.#letGo();
    await this.#ended;
  }

  /** Passes another window's request for the project to whoever listens. */
  hearRequest(request: TransferRequest): void {
    for (const listener of this.#listeners) listener(request);
  }

  /**
   * Notes the window about to take the project, which says so first, so the
   * loss can name it. A notice that arrives after the lock was taken is too
   * late to name it, and the loss says only that it was taken.
   */
  noteTaking(by: LeaseOwner): void {
    this.#takenBy = by;
  }

  /** Records that the lock was let go, as {@link release} asked. */
  ended(): void {
    this.#over = true;
    this.#end();
  }

  /** Records that the lock was taken from this window, which stops writing at once. */
  taken(): void {
    this.#over = true;
    this.#lose(
      this.#takenBy === undefined ? { kind: 'taken' } : { kind: 'taken', by: this.#takenBy },
    );
    this.#end();
  }
}
