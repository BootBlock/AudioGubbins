/**
 * The inference worker's end of a thread's channel to it.
 *
 * A thread that runs models talks to the inference worker over a channel of
 * its own rather than through the page, so a tensor crosses once. A channel's
 * other end closing says nothing to this one: a thread that is terminated
 * closes no port. So the page, which made the thread, says when it has gone,
 * and when the worker at the other end has failed (`WorkerInference.failed`).
 */

import type { ChannelEnd } from './channel-end.js';
import type { InferenceWorkerPort } from './worker-inference.js';

/** The inference worker on the other end of `end` (see the module comment). */
export function channelWorkerPort(end: ChannelEnd): InferenceWorkerPort {
  let closed = false;
  return {
    post: (message, transfer) => {
      if (!closed) end.postMessage(message, transfer);
    },
    listen: (onMessage, onFault) => {
      end.addEventListener('message', (event) => {
        if (!closed) onMessage(event.data);
      });
      // A message that could not be deserialised names no call, so the
      // conversation cannot be trusted after it.
      end.addEventListener('messageerror', () => {
        if (!closed) onFault('A message from the inference worker could not be received.');
      });
      end.start();
    },
    terminate: () => {
      closed = true;
      end.close();
    },
  };
}
