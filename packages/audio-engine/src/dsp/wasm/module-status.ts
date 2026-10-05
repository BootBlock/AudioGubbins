/**
 * What the DSP module's answers mean to the engine: a status other than done
 * thrown as the fault it names, and a creation refused as a failure. Each is
 * a fault in the engine or the module, never in audio, because the engine
 * checks a call's settings and shape before it is made.
 */

import { failure, FailureKind, fail, type DomainResult } from '@audiogubbins/domain';

import { DspStatus } from './dsp-exports.js';

/**
 * Throws what a status other than done says went wrong in a call on `object`.
 * Each is a fault in the engine or the module, never in audio: the engine
 * checked the call's shape before it was made.
 */
export function throwUnlessDone(
  status: number,
  object: string,
  refusal = 'input after its end',
): void {
  switch (status) {
    case DspStatus.Done:
      return;
    case DspStatus.BadHandle:
      throw new Error(`The DSP module lost ${object} it made.`);
    case DspStatus.TooSmall:
      throw new Error(`The DSP module was given a buffer too small for a call on ${object}.`);
    case DspStatus.Refused:
      throw new Error(`The DSP module refused a call on ${object}: ${refusal}.`);
    default:
      throw new Error(
        `The DSP module answered a status this engine does not know: ${String(status)}.`,
      );
  }
}

/** The failure of a creation the module refused, naming `what` it was asked to make. */
export function refusedByModule(what: string): DomainResult<never> {
  return fail(
    failure(
      'dsp.module-refused',
      FailureKind.Unrecoverable,
      `The DSP module refused to make ${what}.`,
    ),
  );
}
