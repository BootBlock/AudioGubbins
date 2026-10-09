/**
 * The detection worker as the browser runs it: the page's end of the one
 * worker that analyses audio for the assistants (ADR-0062), so the page never
 * reads a sample to find a fault.
 *
 * The bundler builds the worker's module on its own, as it does the engine's
 * threads, and the host makes the worker when the first detection is asked
 * for, so a page that analyses nothing starts no worker. It is connected to
 * the preview worker as it starts, so a racked sound is analysed from its
 * render (ADR-0061).
 */

import { CachePurpose } from '@audiogubbins/audio-engine';
import type { PreviewHost } from '@audiogubbins/audio-runtime';
import {
  ToDetectionWorkerKind,
  type DetectionWorkerPort,
  type ToDetectionWorker,
} from '@audiogubbins/detection-runtime';
import detectionWorkerUrl from '@audiogubbins/detection-runtime/threads/detection-worker.ts?worker&url';

import type { ModelServices } from '../ml/model-services.js';

/**
 * A new detection worker connected to `previews` and to the models a chain
 * runs by `models`, and the port the host talks to it through.
 */
export function browserDetectionWorker(
  previews: PreviewHost,
  models: Pick<ModelServices, 'startChainWorker'>,
): DetectionWorkerPort {
  const worker = models.startChainWorker(detectionWorkerUrl);
  const connection = previews.connect(CachePurpose.Analysis);
  const connect: ToDetectionWorker = {
    kind: ToDetectionWorkerKind.Previews,
    port: connection.port,
  };
  worker.postMessage(connect, [connection.port]);
  return {
    post: (message, transfer) => {
      worker.postMessage(message, [...transfer]);
    },
    listen: (onMessage, onFault) => {
      worker.addEventListener('message', (event) => {
        onMessage(event.data);
      });
      worker.addEventListener('messageerror', () => {
        onFault('A message from the detection worker could not be read.');
      });
      worker.addEventListener('error', (event) => {
        // Handled here, where the host fails every detection with the reason,
        // rather than reported again as an error of the page.
        event.preventDefault();
        onFault(event.message === '' ? 'The detection worker could not run.' : event.message);
      });
    },
    terminate: () => {
      worker.terminate();
      connection.disconnect();
    },
  };
}
