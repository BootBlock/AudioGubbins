/**
 * The codecs of this page, made of the browser's parts: the codec worker,
 * which Vite builds as a module of its own and the page starts under its
 * policy; the modules the build carries, a chunk imported only when the
 * worker is first needed; and the browser's own compiler of WebAssembly.
 */

import codecWorkerUrl from '@audiogubbins/codec-runtime/threads/codec-worker.ts?worker&url';
import type { Logger } from '@audiogubbins/diagnostics';

import { moduleWorkerClass } from '../module-worker.js';
import type { CodecWorkerPort } from './codec-client.js';
import { CodecThread, type BundledModule, type BundledModules } from './codec-thread.js';

/** The codec worker, its errors handled by the client rather than reported again by the page. */
function codecWorker(): CodecWorkerPort {
  const worker = new (moduleWorkerClass())(codecWorkerUrl, 'AudioGubbins codecs');
  return {
    post: (message, transfer) => {
      worker.postMessage(message, [...transfer]);
    },
    listen: (onMessage, onFault) => {
      worker.addEventListener('message', (event) => {
        onMessage(event.data);
      });
      worker.addEventListener('messageerror', () => {
        onFault('A message from the codec worker could not be read.');
      });
      worker.addEventListener('error', (event) => {
        // Handled by the client, which fails what the worker was serving with
        // the reason, rather than reported again as an error of the page.
        event.preventDefault();
        onFault(event.message === '' ? 'The codec worker could not run.' : event.message);
      });
    },
    terminate: () => {
      worker.terminate();
    },
  };
}

/** The modules the build carries, as `bundled-codec-modules.ts` gives them. */
interface Bundled {
  readonly CODEC_MODULE: BundledModule;
  readonly MP3_MODULE: BundledModule;
  readonly VORBIS_MODULE: BundledModule;
}

/** The modules the build carries, loaded together when the worker is first needed. */
function bundled(): Promise<Bundled> {
  return import('./bundled-codec-modules.js');
}

const BUNDLED_MODULES: BundledModules = {
  codec: async () => (await bundled()).CODEC_MODULE,
  mp3: async () => (await bundled()).MP3_MODULE,
  vorbis: async () => (await bundled()).VORBIS_MODULE,
};

/**
 * The page's codecs, joined to the storage worker by `join` where this
 * browser keeps projects.
 */
export function browserCodecs(options: {
  readonly webAssembly: boolean;
  readonly join: ((port: MessagePort) => Promise<void>) | undefined;
  readonly logger: Logger;
}): CodecThread {
  return new CodecThread({
    ...options,
    startWorker: codecWorker,
    modules: BUNDLED_MODULES,
    compile: (bytes) => WebAssembly.compile(bytes),
  });
}
