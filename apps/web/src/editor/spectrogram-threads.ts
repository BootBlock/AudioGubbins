/**
 * The spectrogram worker as the browser runs it: the page's end of the one
 * worker that analyses every sound's spectrogram tiles (ADR-0080), so the page
 * never computes a spectrum (REQ-ARCH-037).
 *
 * The bundler builds the worker's module on its own, as it does the peak
 * worker's, and the host makes the worker when a view first shows a
 * spectrogram, so a page that shows none starts no worker. Before anything else
 * the worker is given the page's DSP module, the delivery a render worker
 * takes, so it runs the WebAssembly module where one is compiled and the
 * reference where none is, and its channel to the preview worker, which a
 * racked sound is read through (ADR-0061). The module is compiled on first use,
 * so what the host posts meanwhile waits, in order, behind the two.
 */

import { CachePurpose, deliveredAs } from '@audiogubbins/audio-engine';
import type { PreviewConnection, PreviewHost } from '@audiogubbins/audio-runtime';
import {
  ToSpectrogramWorkerKind,
  type SpectrogramWorkerPort,
  type ToSpectrogramWorker,
} from '@audiogubbins/spectral-analysis';
import spectrogramWorkerUrl from '@audiogubbins/spectral-analysis/threads/spectrogram-worker.ts?worker&url';

import type { PageDsp } from '../audio/page-dsp.js';
import type { ModelServices } from '../ml/model-services.js';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The worker's ends the page holds: the worker, and its channel to the preview worker. */
interface Ends {
  readonly worker: Worker;
  readonly connection: PreviewConnection;
}

/**
 * How the host's messages reach the worker once it has been given `dsp` and
 * its channel to the previews, in order, those posted meanwhile kept until
 * then; `fault` is told why where the DSP module cannot be had.
 */
function afterDsp(
  { worker, connection }: Ends,
  dsp: PageDsp,
  fault: (reason: string) => void,
): Pick<SpectrogramWorkerPort, 'post' | 'terminate'> {
  let waiting: [ToSpectrogramWorker, readonly ArrayBuffer[]][] | undefined = [];
  let terminated = false;
  const send = (message: ToSpectrogramWorker, transfer: readonly ArrayBuffer[]): void => {
    worker.postMessage(message, [...transfer]);
  };
  dsp().then(
    (delivery) => {
      if (terminated) return;
      const module = deliveredAs(delivery, (compiled) => compiled.module);
      send({ kind: ToSpectrogramWorkerKind.Dsp, delivery: module }, []);
      const connect: ToSpectrogramWorker = {
        kind: ToSpectrogramWorkerKind.Previews,
        port: connection.port,
      };
      worker.postMessage(connect, [connection.port]);
      for (const [message, transfer] of waiting ?? []) send(message, transfer);
      waiting = undefined;
    },
    (error: unknown) => {
      // The module's chunk could not be fetched: the worker cannot be told
      // which DSP to run, so the host fails each spectrogram it serves.
      if (!terminated) fault(`The DSP module could not be loaded: ${messageOf(error)}`);
    },
  );
  return {
    post: (message, transfer) => {
      if (waiting === undefined) send(message, transfer);
      else waiting.push([message, transfer]);
    },
    terminate: () => {
      terminated = true;
      waiting = undefined;
      worker.terminate();
      connection.disconnect();
    },
  };
}

/**
 * A new spectrogram worker running the page's DSP, `dsp`, connected to
 * `previews` and to the models a chain runs by `models`, and the port the
 * host talks to it through.
 */
export function browserSpectrogramWorker(
  previews: PreviewHost,
  models: Pick<ModelServices, 'startChainWorker'>,
  dsp: PageDsp,
): SpectrogramWorkerPort {
  const worker = models.startChainWorker(spectrogramWorkerUrl);
  let fault: ((reason: string) => void) | undefined;
  const sending = afterDsp(
    { worker, connection: previews.connect(CachePurpose.Spectrogram) },
    dsp,
    (reason) => fault?.(reason),
  );
  return {
    ...sending,
    listen: (onMessage, onFault) => {
      fault = onFault;
      worker.addEventListener('message', (event) => {
        onMessage(event.data);
      });
      worker.addEventListener('messageerror', () => {
        onFault('A message from the spectrogram worker could not be read.');
      });
      worker.addEventListener('error', (event) => {
        // Handled here, where the host fails every job with the reason, rather
        // than reported again as an error of the page.
        event.preventDefault();
        onFault(event.message === '' ? 'The spectrogram worker could not run.' : event.message);
      });
    },
  };
}
