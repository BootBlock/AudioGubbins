/**
 * Cancellation, as every package compiled without a host's types reads it.
 *
 * `CLAUDE.md` G4 passes a cancellation down every asynchronous path. The
 * readers, the engine and the workers that run them are compiled without the
 * browser's or Node's type definitions, since they run in an AudioWorklet, a
 * worker and a test alike, so they name the part of an `AbortSignal` they read
 * rather than the host's type. A browser's or Node's `AbortSignal` is one, and
 * so is the source below, for work that must cancel what it started itself.
 * One mechanism serves them all, so work cancelled in one package fails with
 * the same `Cancelled` that the package awaiting it recognises.
 */

/** The part of an `AbortSignal` a cancellable path reads. */
export interface CancellationSignal {
  readonly aborted: boolean;
  readonly reason: unknown;
  addEventListener(type: 'abort', listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}

/** Why work was cancelled, where the signal gave no reason of its own. */
export class Cancelled extends Error {
  constructor(message = 'The work was cancelled.') {
    super(message);
    this.name = 'Cancelled';
  }
}

/**
 * What a cancelled signal's work fails with: its reason where that is an
 * error, so a caller's own reason reaches whoever awaited the work, and
 * `Cancelled` where the signal was aborted with none or with a value that is
 * not one.
 */
export function cancellationReason(signal: CancellationSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Cancelled();
}

/** Throws the signal's reason if it has been cancelled. */
export function throwIfCancelled(signal: CancellationSignal | undefined): void {
  if (signal?.aborted === true) throw cancellationReason(signal);
}

/** A signal the engine can cancel itself, and the means to cancel it. */
export interface CancellationSource {
  readonly signal: CancellationSignal;
  cancel(reason?: unknown): void;
}

/** A new source whose signal is cancelled when `cancel` is called, once. */
export function createCancellationSource(): CancellationSource {
  const listeners = new Set<() => void>();
  const state: { aborted: boolean; reason: unknown } = { aborted: false, reason: undefined };
  const signal: CancellationSignal = {
    get aborted() {
      return state.aborted;
    },
    get reason() {
      return state.reason;
    },
    addEventListener: (_type, listener) => {
      if (!state.aborted) listeners.add(listener);
    },
    removeEventListener: (_type, listener) => {
      listeners.delete(listener);
    },
  };
  return {
    signal,
    cancel: (reason = new Cancelled()) => {
      if (state.aborted) return;
      state.aborted = true;
      state.reason = reason;
      for (const listener of [...listeners]) listener();
      listeners.clear();
    },
  };
}
