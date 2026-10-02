/**
 * The order an open project's writes reach storage in, and what happens when
 * storage refuses one (REQ-STOR-021, REQ-STOR-106, REQ-EXEC-136.15).
 *
 * Writes run one at a time in the order they were queued, so a later journal
 * record is never written before an earlier one. When the tree refuses a write
 * (full, unreachable, or failing for a reason of its own) the queue pauses with
 * that write at its head, and every write waiting is reported not saved with
 * the cause; the project in memory is untouched. The next write queued, or a
 * retry, resumes from the refused write, in order. Anything else a write
 * throws, a defect or a crash of the platform, stops the queue for good and is
 * passed to everyone waiting: the state of storage is then unknown, and writing
 * more could only make it worse.
 */

import type { DomainFailure, DomainResult } from '@audiogubbins/domain';
import { TreeFailure } from '@audiogubbins/project-format';

import { storageRefused } from './storage-failures.js';

/** Whether an open project's changes are in storage. */
export type SaveStatus =
  | { readonly kind: 'saved' }
  | { readonly kind: 'saving'; readonly pending: number }
  | { readonly kind: 'not-saved'; readonly pending: number; readonly cause: DomainFailure }
  | { readonly kind: 'stopped'; readonly unsaved: number };

/** What became of one write, as far as its caller need wait. */
export type WriteOutcome =
  | { readonly kind: 'written' }
  | { readonly kind: 'not-saved'; readonly cause: DomainFailure }
  | { readonly kind: 'stopped' };

/**
 * One write. It rejects with the tree's refusal where the tree refuses it, and
 * fails with a designed failure where it finds for itself that it cannot be
 * made now, such as a record that did not read back as written; either pauses
 * the queue with the write at its head.
 */
export type Write = () => Promise<DomainResult<void>>;

/** One write, and how to tell its caller what became of it. */
interface Queued {
  readonly write: Write;
  readonly settle: (outcome: WriteOutcome) => void;
  readonly reject: (error: unknown) => void;
}

/** Writes run one at a time, in order (see the module comment). */
export class WriteQueue {
  private readonly pending: Queued[] = [];
  private readonly onChange: () => void;
  private running: Promise<void> = Promise.resolve();
  private draining = false;
  private refusal: DomainFailure | undefined;
  private stoppedWith: number | undefined;

  /** `onChange` is called whenever {@link WriteQueue.status} may have changed. */
  constructor(onChange: () => void) {
    this.onChange = onChange;
  }

  get status(): SaveStatus {
    if (this.stoppedWith !== undefined) return { kind: 'stopped', unsaved: this.stoppedWith };
    if (this.refusal !== undefined) {
      return { kind: 'not-saved', pending: this.pending.length, cause: this.refusal };
    }
    return this.pending.length === 0
      ? { kind: 'saved' }
      : { kind: 'saving', pending: this.pending.length };
  }

  /**
   * Queues a write, resuming a paused queue, and settles once the write is
   * done, or once the queue pauses or stops before it is.
   */
  async enqueue(write: Write): Promise<WriteOutcome> {
    if (this.stoppedWith !== undefined) return { kind: 'stopped' };
    const outcome = new Promise<WriteOutcome>((settle, reject) => {
      this.pending.push({ write, settle, reject });
    });
    this.resume();
    return await outcome;
  }

  /** Resumes a paused queue, and settles with the status once it pauses or empties. */
  async retry(): Promise<SaveStatus> {
    this.resume();
    await this.running;
    return this.status;
  }

  /** Settles with the status once nothing is running. */
  async settled(): Promise<SaveStatus> {
    await this.running;
    return this.status;
  }

  /**
   * Stops the queue for good, dropping every write not yet done, and gives how
   * many were dropped.
   */
  stop(): number {
    if (this.stoppedWith !== undefined) return this.stoppedWith;
    const dropped = this.pending.splice(0);
    this.stoppedWith = dropped.length;
    for (const queued of dropped) queued.settle({ kind: 'stopped' });
    this.onChange();
    return dropped.length;
  }

  private resume(): void {
    this.refusal = undefined;
    // The flag, not the promise, says whether a drain runs: a drain with
    // nothing to do finishes before its promise could be stored.
    if (!this.draining) {
      this.draining = true;
      this.running = this.drain();
    }
    this.onChange();
  }

  private async drain(): Promise<void> {
    try {
      for (let head = this.pending[0]; head !== undefined; head = this.pending[0]) {
        if (this.stoppedWith !== undefined) return;
        let written: DomainResult<void>;
        try {
          written = await head.write();
        } catch (error) {
          this.fail(error);
          return;
        }
        // A stop while the write ran emptied the queue and told the caller.
        if (this.pending[0] !== head) return;
        if (!written.ok) {
          this.pause(written.failures[0]);
          return;
        }
        this.pending.shift();
        head.settle({ kind: 'written' });
        this.onChange();
      }
    } finally {
      this.draining = false;
    }
  }

  /**
   * Handles what a write threw. The tree's refusal, before or while writing,
   * pauses the queue with the write at its head to be made again, since nothing
   * already stored was harmed. Anything else stops the queue and is passed to
   * every caller waiting.
   */
  private fail(error: unknown): void {
    if (error instanceof TreeFailure) {
      this.pause(storageRefused(error));
      return;
    }
    const dropped = this.pending.splice(0);
    this.stoppedWith = dropped.length;
    for (const queued of dropped) queued.reject(error);
    this.onChange();
  }

  private pause(cause: DomainFailure): void {
    this.refusal = cause;
    for (const queued of this.pending) queued.settle({ kind: 'not-saved', cause });
    this.onChange();
  }
}
