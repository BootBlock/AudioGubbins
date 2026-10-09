/**
 * A numeric parameter changed while a sound plays, reaching the chains that
 * run it as it is heard (REQ-AUDIO-019).
 *
 * The change is the project's first: a command sets the value, and the page
 * hands playback the value the command left, so playback follows the project
 * and never the other way round. Each edited source a reading makes registers
 * here, and a change reaches the stream it names in every one of them; a shared
 * chain is heard in each stream that names it, each changed by a change of its
 * own. A chain heard from a render cannot take a change running, as the render
 * was made with the old value: the change is refused with the reason, and the
 * page loads the sound again, which makes the render again with the new one.
 */

import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DomainFailure,
  type DomainResult,
  type ParameterId,
  type ProcessorId,
} from '@audiogubbins/domain';

/** A numeric parameter of one processor instance, and its new value. */
export interface ParameterChange {
  /**
   * The place in the plan of the stream whose chain runs the processor: a
   * chain a paste carries keeps the identifiers of the chain it was copied
   * from, which may be playing beside it, so a processor is one stream's.
   */
  readonly stream: number;
  readonly processor: ProcessorId;
  readonly parameter: ParameterId;
  readonly value: number;
}

/** What hears a change: an edited source, for every chain its plan names. */
export interface ParameterTarget {
  /**
   * Takes the change into every chain of its plan that holds the processor,
   * answering whether it holds it at all, or why it cannot take the change
   * running.
   */
  setParameter(change: ParameterChange): DomainResult<boolean>;
}

/** The chains one reading runs as it is heard, by the edited sources that hold them. */
export class RunningParameters {
  readonly #targets = new Set<ParameterTarget>();

  /** Hears changes until the answer is called. */
  add(target: ParameterTarget): () => void {
    this.#targets.add(target);
    return () => {
      this.#targets.delete(target);
    };
  }

  /**
   * Gives the change to every source, or says why it was not heard running:
   * a source that refuses it, or no source that holds the processor.
   */
  apply(change: ParameterChange): DomainResult<void> {
    const refusals: DomainFailure[] = [];
    let held = false;
    for (const target of this.#targets) {
      const taken = target.setParameter(change);
      if (taken.ok) held ||= taken.value;
      else refusals.push(...taken.failures);
    }
    const [first, ...rest] = refusals;
    if (first !== undefined) return fail(first, ...rest);
    return held
      ? succeed(undefined)
      : fail(
          failure(
            'playback.parameter-not-heard',
            FailureKind.Rejected,
            'The processor is not in anything playing, so there is nothing running to change.',
          ),
        );
  }
}
