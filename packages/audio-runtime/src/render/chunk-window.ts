/**
 * The chunks a render worker has sent and the main thread has not yet taken.
 *
 * A worker renders faster than a slow sink writes, and every chunk it posts
 * is memory until the main thread has written it. The window holds the chunks
 * in flight to a fixed number: a sink's write waits for a slot, which the
 * main thread's `chunk-taken` frees, so a slow main thread slows the render
 * rather than growing a queue of audio without limit (`CLAUDE.md` G4).
 *
 * Two, so the worker renders the next chunk while the main thread writes the
 * last: one would leave either side idle while the other works.
 */

import { cancellationReason, type CancellationSignal } from '@audiogubbins/audio-engine';

/** The most chunks sent and not yet taken. */
const CHUNKS_IN_FLIGHT = 2;

/** A count of chunks in flight, and the one write waiting for a slot. */
export class ChunkWindow {
  #inFlight = 0;

  /** The renderer writes one chunk at a time, so at most one write waits. */
  #waiting: (() => void) | undefined;

  /**
   * Waits for a slot and takes it, or rejects with the signal's reason if the
   * render is cancelled first.
   */
  async claim(signal: CancellationSignal): Promise<void> {
    while (this.#inFlight >= CHUNKS_IN_FLIGHT) await this.#slotFreed(signal);
    this.#inFlight += 1;
  }

  /** The main thread took a chunk, which frees its slot. */
  taken(): void {
    // A second answer for one chunk would open a slot nothing holds, and let
    // the worker send past the bound; there is nothing to free.
    if (this.#inFlight === 0) return;
    this.#inFlight -= 1;
    const wake = this.#waiting;
    this.#waiting = undefined;
    wake?.();
  }

  #slotFreed(signal: CancellationSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(cancellationReason(signal));
        return;
      }
      const abandon = (): void => {
        this.#waiting = undefined;
        reject(cancellationReason(signal));
      };
      signal.addEventListener('abort', abandon, { once: true });
      this.#waiting = () => {
        signal.removeEventListener('abort', abandon);
        resolve();
      };
    });
  }
}
