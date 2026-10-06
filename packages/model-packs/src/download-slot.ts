/**
 * The bound on pack downloads across the application: one pack downloads at a
 * time (ADR-0062).
 *
 * A pack is tens to hundreds of megabytes over the one link the device has, so
 * two at once finish no sooner together and each later than alone: one at a
 * time makes the pack asked for first usable first, gives the storage one
 * stream of writes, and has a full storage refuse one download rather than
 * leave several part way. A pack's own files already arrive one at a time
 * (`pack-download.ts`), so the one turn bounds what is in flight to one file.
 *
 * Turns are given in the order they were asked for. A wait gives up as soon as
 * its signal aborts, taking no turn, so a queued download that is paused or
 * cancelled leaves the queue at once and the next one moves up. The version
 * waiting is in the install state machine's `queued` state meanwhile, so the
 * queue is never the only record of what waits.
 */

/** Gives the turn back, to the next waiter or to nobody. */
export type ReleaseTurn = () => void;

/** One download waiting, and how its turn is handed to it. */
interface Waiter {
  readonly grant: (release: ReleaseTurn) => void;
}

/** The one turn to download (see the module comment). */
export class DownloadSlot {
  private held = false;
  private readonly waiting: Waiter[] = [];

  /** The turn, where nobody holds it; otherwise `undefined`, and nothing waits. */
  tryTake(): ReleaseTurn | undefined {
    if (this.held) return undefined;
    this.held = true;
    return this.releaser();
  }

  /**
   * Waits for the turn, after everyone who asked first, and answers how to give
   * it back; answers `undefined`, holding nothing, where `signal` aborts first.
   */
  async take(signal: AbortSignal): Promise<ReleaseTurn | undefined> {
    if (signal.aborted) return undefined;
    const now = this.tryTake();
    if (now !== undefined) return now;
    return await new Promise<ReleaseTurn | undefined>((resolve) => {
      const waiter: Waiter = {
        grant: (release) => {
          signal.removeEventListener('abort', leave);
          resolve(release);
        },
      };
      const leave = (): void => {
        this.waiting.splice(this.waiting.indexOf(waiter), 1);
        resolve(undefined);
      };
      signal.addEventListener('abort', leave, { once: true });
      this.waiting.push(waiter);
    });
  }

  /** How the holder gives the turn back: to the first waiter, or to nobody. */
  private releaser(): ReleaseTurn {
    return () => {
      const next = this.waiting.shift();
      if (next === undefined) this.held = false;
      else next.grant(this.releaser());
    };
  }
}
