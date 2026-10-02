/**
 * Turns given to the host during long work over data of any size, so a cancel
 * or a call waiting behind the work is heard mid-way (REQ-EXEC-216).
 *
 * A loop that only computes, such as reading a million records of a ZIP
 * directory or checksumming an entry whose reads resolve at once, never lets
 * the host run however long it takes, and a cancel posted to it is read only
 * once the work is done. So such a loop takes its turns through the
 * {@link YieldToHost} port its host injects, which decides how often to really
 * yield: the storage worker's gives a turn only once a slice of time has run.
 * Asking costs an await, so a light step asks once every `STEPS_PER_TURN`
 * steps, and a heavy one, such as a mebibyte checksummed, every time. The
 * signal is checked at every step, so work given up stops between two steps.
 */

/** Lets the host run whatever it has waiting, resolving when the work may go on. */
export type YieldToHost = () => Promise<void>;

/** How many light steps are taken between two asks for a turn. */
const STEPS_PER_TURN = 128;

/** The turns of one piece of work, and the signal it is given up by. */
export class Turns {
  readonly signal: AbortSignal | undefined;
  readonly #yieldToHost: YieldToHost;
  #steps = 0;

  constructor(yieldToHost: YieldToHost, signal?: AbortSignal) {
    this.#yieldToHost = yieldToHost;
    this.signal = signal;
  }

  /** After a light step, such as one record read. */
  async afterStep(): Promise<void> {
    this.signal?.throwIfAborted();
    this.#steps += 1;
    if (this.#steps < STEPS_PER_TURN) return;
    this.#steps = 0;
    await this.afterHeavyStep();
  }

  /** After a step that costs about as much as many light ones, such as a chunk checksummed. */
  async afterHeavyStep(): Promise<void> {
    this.signal?.throwIfAborted();
    await this.#yieldToHost();
    this.signal?.throwIfAborted();
  }
}
