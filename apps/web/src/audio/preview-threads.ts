/**
 * The preview worker as the browser runs it: the page's end of the one worker
 * that makes and keeps the cached preview renders (ADR-0061), which the
 * feeder, the peak worker and the detection worker each read through a
 * channel of their own.
 *
 * The bundler builds the worker's module on its own, as it does the engine's
 * threads, and the host makes the worker when the first of those is
 * connected, so a page that reads no edited sound starts no worker. How far
 * its renders have come is shown in the engine's view, and each render begun
 * is recorded, so how often a whole pass ran is read back from the log as
 * well as the Transport panel.
 */

import type { Logger } from '@audiogubbins/diagnostics';
import { PreviewHost } from '@audiogubbins/audio-runtime';
import previewWorkerUrl from '@audiogubbins/audio-runtime/threads/preview-worker.ts?worker&url';

import type { ModelServices } from '../ml/model-services.js';
import type { AudioViewStore } from '../state/audio-view-store.js';

/** The page's end of the preview worker, and how to stop it. */
export interface BrowserPreviews {
  readonly host: PreviewHost;
  readonly dispose: () => void;
}

/**
 * The preview worker, made when a worker is first connected to it, reporting
 * to `view`, and connected to the inference workers and installed packs by
 * `models`, since a render runs a chain's models.
 */
export function browserPreviews(
  logger: Logger,
  view: Pick<AudioViewStore, 'showPreviews'>,
  models: Pick<ModelServices, 'startChainWorker'>,
): BrowserPreviews {
  const host = new PreviewHost({
    createWorker: () => models.startChainWorker(previewWorkerUrl),
    createChannel: () => new MessageChannel(),
    logger,
  });
  let begun = 0;
  const stopShowing = host.subscribe((renders) => {
    if (renders.begun > begun) {
      logger.info('A cached preview is being made.', { count: renders.begun });
    }
    begun = renders.begun;
    view.showPreviews(renders);
  });
  return {
    host,
    dispose: () => {
      stopShowing();
      host.dispose();
    },
  };
}
