/**
 * The messages to and from the inference worker.
 *
 * The page starts the worker with the runtime's setup and connects it to each
 * thread that runs models, by a channel of the thread's own
 * (`ToInferenceThread`), and lets a thread's channels go once the thread has
 * gone. Over each channel the thread opens sessions and runs them by call
 * (`ToInferenceWorker`): a session is known by the call that opened it. The
 * worker answers every call but an open the thread cancelled, whose session it
 * lets go instead; the thread has answered a cancelled call itself, and passes
 * over a late answer to it, letting go a session that opened before the cancel
 * arrived. Tensors cross as their floats and dimensions, their buffers
 * transferred rather than copied. Every message is read field by field on
 * arrival (`inference-message-reading.ts`).
 */

import type { DomainFailure } from '@audiogubbins/domain';

import type { ChannelEnd } from '../channel-end.js';
import type { InferenceExecution, InferenceOptions, RuntimeSetup } from '../inference-options.js';
import type { ModelBytes } from '../inference-port.js';
import type { Tensor, TensorInfo } from '../tensor.js';

/** A tensor with the name of the input or output it is. */
export interface NamedTensor extends Tensor {
  readonly name: string;
}

/** The kinds of message the page sends the inference worker's own scope. */
export const ToInferenceThreadKind = {
  Start: 'start',
  Connect: 'connect',
  Disconnect: 'disconnect',
} as const;

/** A message the page sends the inference worker's own scope. */
export type ToInferenceThread =
  | {
      /** The first message: what the worker's runtime is started with. */
      readonly kind: typeof ToInferenceThreadKind.Start;
      readonly setup: RuntimeSetup;
    }
  | {
      /**
       * A channel to a thread that runs models, which the worker serves
       * sessions over; `client` names the thread, so its channels can be let
       * go together.
       */
      readonly kind: typeof ToInferenceThreadKind.Connect;
      readonly client: number;
      readonly port: ChannelEnd;
    }
  | {
      /** The thread `client` has gone: every session its channels held is let go. */
      readonly kind: typeof ToInferenceThreadKind.Disconnect;
      readonly client: number;
    };

/** The kinds of message the inference worker is sent over a thread's channel. */
export const ToInferenceWorkerKind = {
  Open: 'open',
  Run: 'run',
  Cancel: 'cancel',
  Release: 'release',
} as const;

/** A message the inference worker is sent over a thread's channel. */
export type ToInferenceWorker =
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
      /** The thread has answered the call as cancelled, and wants no answer. */
      readonly kind: typeof ToInferenceWorkerKind.Cancel;
      readonly call: number;
    }
  | {
      readonly kind: typeof ToInferenceWorkerKind.Release;
      readonly session: number;
    };

/** The kinds of message the inference worker sends over a thread's channel. */
export const FromInferenceWorkerKind = {
  Opened: 'opened',
  Ran: 'ran',
  Failed: 'failed',
  Refused: 'refused',
} as const;

/** Every reason a call failed, at least one, as a structured clone carries them. */
export type InferenceFailures = readonly [DomainFailure, ...DomainFailure[]];

/** A message the inference worker sends over a thread's channel. */
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
       * was: the thread cannot trust the conversation after it.
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
