/**
 * The messages between the page and the inference worker.
 *
 * One discriminated union each way, each message read field by field on
 * arrival (`inference-message-reading.ts`). The page starts the worker with
 * the runtime's setup, then opens sessions and runs them by call: a session is
 * known by the call that opened it. The worker answers every call but an open
 * the page cancelled, whose session it lets go instead; the page has answered
 * a cancelled call itself, and passes over a late answer to it, letting go a
 * session that opened before the cancel arrived. Tensors cross as their floats
 * and dimensions, their buffers transferred rather than copied.
 */

import type { DomainFailure } from '@audiogubbins/domain';

import type { InferenceExecution, InferenceOptions, RuntimeSetup } from '../inference-options.js';
import type { ModelBytes } from '../inference-port.js';
import type { Tensor, TensorInfo } from '../tensor.js';

/** A tensor with the name of the input or output it is. */
export interface NamedTensor extends Tensor {
  readonly name: string;
}

/** The kinds of message the inference worker is sent. */
export const ToInferenceWorkerKind = {
  Start: 'start',
  Open: 'open',
  Run: 'run',
  Cancel: 'cancel',
  Release: 'release',
} as const;

/** A message the inference worker is sent. */
export type ToInferenceWorker =
  | {
      /** The first message: what the worker's runtime is started with. */
      readonly kind: typeof ToInferenceWorkerKind.Start;
      readonly setup: RuntimeSetup;
    }
  | {
      readonly kind: typeof ToInferenceWorkerKind.Open;
      readonly call: number;
      readonly model: ModelBytes;
      readonly options: InferenceOptions;
    }
  | {
      readonly kind: typeof ToInferenceWorkerKind.Run;
      readonly call: number;
      /** The call that opened the session. */
      readonly session: number;
      readonly inputs: readonly NamedTensor[];
    }
  | {
      /** The page has answered the call as cancelled, and wants no answer. */
      readonly kind: typeof ToInferenceWorkerKind.Cancel;
      readonly call: number;
    }
  | {
      readonly kind: typeof ToInferenceWorkerKind.Release;
      readonly session: number;
    };

/** The kinds of message the inference worker sends. */
export const FromInferenceWorkerKind = {
  Opened: 'opened',
  Ran: 'ran',
  Failed: 'failed',
  Refused: 'refused',
} as const;

/** Every reason a call failed, at least one, as a structured clone carries them. */
export type InferenceFailures = readonly [DomainFailure, ...DomainFailure[]];

/** A message the inference worker sends. */
export type FromInferenceWorker =
  | {
      /** A session is open, known from now on by the call that opened it. */
      readonly kind: typeof FromInferenceWorkerKind.Opened;
      readonly call: number;
      readonly inputs: readonly TensorInfo[];
      readonly outputs: readonly TensorInfo[];
      readonly execution: InferenceExecution;
    }
  | {
      readonly kind: typeof FromInferenceWorkerKind.Ran;
      readonly call: number;
      readonly outputs: readonly NamedTensor[];
    }
  | {
      readonly kind: typeof FromInferenceWorkerKind.Failed;
      readonly call: number;
      readonly failures: InferenceFailures;
    }
  | {
      /**
       * A message the worker could not read, which cannot say which call it
       * was: the page cannot trust the conversation after it.
       */
      readonly kind: typeof FromInferenceWorkerKind.Refused;
      readonly failures: InferenceFailures;
    };

/**
 * The buffers of `tensors`, once each, to transfer with the message that
 * carries them. Each tensor's data spans its buffer: one that did not would
 * move the memory around it too.
 */
export function tensorTransfers(tensors: readonly Tensor[]): readonly ArrayBuffer[] {
  return [...new Set(tensors.map((one) => one.data.buffer))];
}

/**
 * A tensor whose data spans its buffer, so the buffer can be transferred alone:
 * the same tensor where it does, a copy of its values where it does not.
 */
export function movable(one: NamedTensor): NamedTensor {
  const { data } = one;
  return data.byteOffset === 0 && data.byteLength === data.buffer.byteLength
    ? one
    : { name: one.name, data: data.slice(), dims: one.dims };
}
