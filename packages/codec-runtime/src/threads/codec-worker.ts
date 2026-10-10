/**
 * The codec worker: a module the browser loads as a dedicated worker, where
 * every file is analysed, decoded and encoded, never on the page (ADR-0090).
 *
 * It only connects the worker's global scope to `CodecWorkerCore`, which holds
 * everything the worker does, so that behaviour is tested without a worker.
 * What the scope offers the codecs is read through the capabilities package,
 * the one place the browser is asked (REQ-EXEC-136.4); the core is handed that,
 * the scope's synchronous file reader, and the factory that opens each export's
 * encoder. It is compiled again, with everything it imports, by
 * `scopes/dedicated-worker`, against a worker's definitions alone.
 */

import { probeCodecs, readCodecPlatform } from '@audiogubbins/capabilities';
import { FailureKind, fail, failure } from '@audiogubbins/domain';

import type { FileReaderSyncLike } from '../files/sync-file-bytes.js';
import type { OpenExportEncoder } from '../worker/encode-job.js';
import type { FromCodecWorker } from '../worker/codec-worker-messages.js';
import { CodecWorkerCore } from '../worker/codec-worker-core.js';

/** The part of a dedicated worker's global scope this module uses. */
interface CodecWorkerScope {
  postMessage(message: FromCodecWorker, options: { transfer: Transferable[] }): void;
  addEventListener(type: 'message' | 'messageerror', listener: (event: MessageEvent) => void): void;
  reportError(error: unknown): void;
}

/**
 * A dedicated worker's synchronous file reader, which the page's definitions
 * this package is compiled with do not declare; declared by the member used.
 */
declare const FileReaderSync: new () => FileReaderSyncLike;

const scope: CodecWorkerScope = self;

/**
 * A yield to the worker's event loop between blocks, so a `cancel` or a
 * stream's credit that arrived while a block decoded is read before the next.
 * A message to itself through a channel rather than a timer, which a browser
 * clamps at this depth; the channel is made once and each yield answered by
 * one message, in order.
 */
const turns = new MessageChannel();
const waiting: (() => void)[] = [];
turns.port1.onmessage = () => {
  waiting.shift()?.();
};

function yieldToHost(): Promise<void> {
  return new Promise<void>((resolve) => {
    waiting.push(resolve);
    turns.port2.postMessage(undefined);
  });
}

/**
 * The encoders of this build, by format: none is registered with the worker
 * here, so every export is refused with the format it named, and every other
 * request is served.
 */
const openExportEncoder: OpenExportEncoder = (request) =>
  Promise.resolve(
    fail(
      failure(
        'codec-runtime.encoder-unavailable',
        FailureKind.Rejected,
        `No encoder of ${request.target.formatName} is registered with the codec worker.`,
        { details: { format: request.encoding.format } },
      ),
    ),
  );

const platform = readCodecPlatform(self);

const core = new CodecWorkerCore({
  post: (message, transfer) => {
    scope.postMessage(message, { transfer });
  },
  yieldToHost,
  platform,
  probe: () => probeCodecs(platform),
  fileReader: new FileReaderSync(),
  openExportEncoder,
  reportFault: (error) => {
    scope.reportError(error);
  },
});

scope.addEventListener('message', (event) => {
  core.receive(event.data);
});
// A message that could not be deserialised arrives as this rather than as a
// message, and the page would otherwise wait on its request for ever.
scope.addEventListener('messageerror', () => {
  core.messageFailed();
});
