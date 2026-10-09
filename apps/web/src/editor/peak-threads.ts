/**
 * The peak worker as the browser runs it: the page's end of the one worker
 * that makes every source's waveform peaks (ADR-0043), so the page never
 * reads a sample to draw one (the packet's forbidden shortcut).
 *
 * The bundler builds the worker's module on its own, as it does the audio
 * engine's threads, and the host makes the worker when a view first asks for
 * peaks, so a page that opens no asset starts no worker. It is connected to
 * the preview worker as it starts, so a racked sound's peaks are drawn from
 * its render (ADR-0061).
 */

import { CachePurpose } from '@audiogubbins/audio-engine';
import type { PreviewHost } from '@audiogubbins/audio-runtime';
import { ToPeakWorkerKind, type PeakWorkerPort, type ToPeakWorker } from '@audiogubbins/waveform';
import peakWorkerUrl from '@audiogubbins/waveform/threads/peak-worker.ts?worker&url';

import type { ModelServices } from '../ml/model-services.js';

/**
 * A new peak worker connected to `previews` and to the models a chain runs by
 * `models`, and the port the host talks to it through.
 */
export function browserPeakWorker(
  previews: PreviewHost,
  models: Pick<ModelServices, 'startChainWorker'>,
): PeakWorkerPort {
  const worker = models.startChainWorker(peakWorkerUrl);
  const connection = previews.connect(CachePurpose.Waveform);
  const connect: ToPeakWorker = { kind: ToPeakWorkerKind.Previews, port: connection.port };
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
        onFault('A message from the peak worker could not be read.');
      });
      worker.addEventListener('error', (event) => {
        // Handled here, where the host fails every job with the reason, rather
        // than reported again as an error of the page.
        event.preventDefault();
        onFault(event.message === '' ? 'The peak worker could not run.' : event.message);
      });
    },
    terminate: () => {
      worker.terminate();
      connection.disconnect();
    },
  };
}
