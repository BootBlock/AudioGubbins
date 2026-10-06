/**
 * A whole pass over audio: the one contract for whatever must hear all of
 * its input before it can answer (ADR-0061, ADR-0062), a processor's
 * measurer and a detector's detection alike.
 *
 * A pass is given its input a chunk at a time, and whoever feeds it awaits
 * each chunk before reading the next, so a pass that runs slow work per
 * chunk, as a model run in a worker does, holds the reading back rather than
 * letting the stream queue in memory. A canonical pass works synchronously
 * and answers at once. Its answer may fail, since an inference can be
 * refused, and a failure refuses whatever depends on it: work that ran as if
 * the pass had answered nothing would sound like success and be wrong.
 */

import type { CancellationSignal, DomainResult } from '@audiogubbins/domain';

/** One pass over audio, heard in order, in chunks of any size. */
export interface WholePass<TResult> {
  /**
   * Hears the next `frames` frames of `input`, one array per channel. The
   * feeder reuses the arrays once the answer settles, so a pass that needs the
   * audio later copies what it needs before then.
   */
  add(input: readonly Float32Array[], frames: number, signal?: CancellationSignal): Promise<void>;
  /**
   * The answer over everything heard, the audio being done, or why there is
   * none. A pass that has answered answers the same again.
   */
  result(signal?: CancellationSignal): Promise<DomainResult<TResult>>;
  /**
   * Frees what it works with, whether or not it answered: a pass can be
   * cancelled, fail to read, or fail, part way.
   */
  release(): void;
}

/**
 * What a processor's whole pass measures, written into its node for its
 * kernel: numbers the kernel works out its processing from, or samples it
 * plays back, as a model's output over the whole stream is. Each kernel
 * takes one kind and refuses the other.
 */
export type Measurement = readonly number[] | Float32Array;

/** What measures a processor's whole input before it can run. */
export type Measurer = WholePass<Measurement>;
