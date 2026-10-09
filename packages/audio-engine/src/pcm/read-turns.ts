/**
 * The turns a source that keeps state between reads gives its readers.
 *
 * A processed stream holds a chain's run and where it has got to, a
 * conversion its resampler's position, and every reader of a plan the
 * scratch it reads segments into. One source is read by more than one reader
 * at once (the peak worker's build and a view's request for samples), and a
 * read awaits its input part way through, so two reads left to run together
 * advance one run for each other and write into each other's scratch. Each
 * read therefore waits for the one before it to settle, answered or failed,
 * and runs alone, in the order the reads were made.
 *
 * A read cancelled while it waits rejects at once, as the signal's reason,
 * and never runs; the read after it still waits for the one running, which
 * owns the state until it settles.
 */

import {
  cancellationReason,
  throwIfCancelled,
  type CancellationSignal,
} from '@audiogubbins/domain';

/** A source's reads, taken one at a time in the order they were made. */
export class ReadTurns {
  /** Settles once every read taken so far has settled or been skipped. */
  #last: Promise<void> = Promise.resolve();

  /** Runs `read` once every read taken before it has settled, unless `signal` cancels it first. */
  take<T>(read: () => Promise<T>, signal?: CancellationSignal): Promise<T> {
    const turn = this.#last.then(() => {
      throwIfCancelled(signal);
      return read();
    });
    // The next read waits for this one however it ends; its outcome is the
    // caller's, handed back below, so it is not reported here a second time.
    this.#last = turn.then(
      () => undefined,
      () => undefined,
    );
    return signal === undefined ? turn : untilCancelled(turn, signal);
  }
}

/** `turn`'s outcome, or the signal's reason as soon as it cancels, whichever comes first. */
function untilCancelled<T>(turn: Promise<T>, signal: CancellationSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => {
      reject(cancellationReason(signal));
    };
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    turn.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
