/**
 * The page of the machine-learning goldens' harness (ADR-0062): it composes
 * local inference as the application's page does (`model-services.ts` of the
 * application) and offers the browser spec one call, `renderGolden(name)`,
 * which runs that golden (`ml-goldens.ts`) in a thread connected to the real
 * inference worker and answers the samples made and their SHA-256.
 *
 * The packs are read where the application downloads them from: the
 * catalogue the server configures, through the model packs' own HTTP source,
 * each file hashed as it arrives, since a browser without the private file
 * system the application keeps installed packs in (WebKit on Windows) must
 * run the goldens too. Every worker starts under the page's policy, as the
 * application's do (`module-worker.ts`).
 */

import {
  FailureKind,
  fail,
  failure,
  succeed,
  type CancellationSignal,
  type DomainResult,
} from '../../../packages/domain/src/index.js';
import {
  InferenceHost,
  ModelThreads,
  type InferenceThreadPort,
  type ModelFileRead,
} from '@audiogubbins/ml-runtime';
import inferenceWorkerUrl from '@audiogubbins/ml-runtime/threads/inference-worker.ts?worker&url';
import { HttpPackSource, nobleSha256, type ModelPackManifest } from '@audiogubbins/model-packs';
import {
  INFERENCE_RUNTIME_PATH,
  INFERENCE_RUNTIME_SHA256,
} from 'virtual:audiogubbins/inference-runtime';
import { PACK_CATALOGUE } from 'virtual:audiogubbins/model-packs';

import { moduleWorkerClass } from '../../../apps/web/src/module-worker.js';
import { mlGolden } from '../../../packages/processors/src/testing/ml-goldens.js';
import { isHarnessAnswer, type FromHarnessThread } from './harness-messages.js';
import harnessWorkerUrl from './harness-worker.ts?worker&url';

/** The catalogue's URL on this page's origin. */
const CATALOGUE =
  PACK_CATALOGUE.kind === 'absolute'
    ? PACK_CATALOGUE.url
    : new URL(PACK_CATALOGUE.path, location.origin).href;

const SOURCE = new HttpPackSource(CATALOGUE);

/** The catalogue's packs, read once. */
let listed: Promise<DomainResult<readonly ModelPackManifest[]>> | undefined;

/** How the packs are made, said where one is missing. */
const HOW =
  'Build the packs with `pnpm packs:build` and start the suite with AUDIOGUBBINS_PACK_CACHE naming the cache it used.';

/** The manifest of `pack` at `version` in the catalogue, or why there is none. */
async function manifestOf(pack: string, version: string): Promise<DomainResult<ModelPackManifest>> {
  listed ??= SOURCE.catalogue();
  const packs = await listed;
  if (!packs.ok) {
    const why = packs.failures.map((one) => one.code).join(', ');
    return fail(
      failure(
        'golden.catalogue-unread',
        FailureKind.Rejected,
        `The catalogue at ${CATALOGUE} could not be read (${why}). ${HOW}`,
      ),
    );
  }
  const manifest = packs.value.find((one) => one.id === pack && one.version === version);
  return manifest === undefined
    ? fail(
        failure(
          'golden.pack-missing',
          FailureKind.Rejected,
          `The catalogue served holds no ${pack} ${version}. ${HOW}`,
        ),
      )
    : succeed(manifest);
}

/** A file of a pack, read from the catalogue, with its SHA-256 taken as it arrives. */
async function packFile(
  pack: string,
  version: string,
  path: string,
  signal: CancellationSignal,
): Promise<DomainResult<ModelFileRead>> {
  const manifest = await manifestOf(pack, version);
  if (!manifest.ok) return manifest;
  const file = manifest.value.files.find((one) => one.path === path);
  if (file === undefined) {
    return fail(
      failure('golden.file-missing', FailureKind.Rejected, `${pack} ${version} has no ${path}.`),
    );
  }
  const bytes = new Uint8Array(file.bytes);
  const hash = nobleSha256();
  let received = 0;
  const stop = new AbortController();
  signal.addEventListener(
    'abort',
    () => {
      stop.abort();
    },
    { once: true },
  );
  const read = await SOURCE.read(
    { pack: manifest.value, file, offset: 0 },
    async (chunk) => {
      bytes.set(chunk, received);
      received += chunk.length;
      await hash.update(chunk);
      return succeed(undefined);
    },
    stop.signal,
  );
  if (!read.ok) return read;
  const digest = await hash.digest();
  return succeed({
    bytes,
    sha256: [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
  });
}

/** An inference worker, its errors told to the host rather than reported by the page. */
function inferenceWorker(): InferenceThreadPort {
  const worker = new (moduleWorkerClass())(inferenceWorkerUrl, 'AudioGubbins inference');
  return {
    postMessage: (message, transfer) => {
      worker.postMessage(
        message,
        transfer.filter((one): one is MessagePort => one instanceof MessagePort),
      );
    },
    addEventListener: (_type, listener) => {
      worker.addEventListener('error', (event) => {
        event.preventDefault();
        listener({ message: event.message });
      });
    },
    terminate: () => {
      worker.terminate();
    },
  };
}

const capabilities = { fixedWidthSimd: true };

let host: InferenceHost | undefined;

/** What a thread sent that the page could not read, which fails the render it came in. */
const faults: string[] = [];

const threads = new ModelThreads({
  inference: () =>
    Promise.resolve(
      (host ??= new InferenceHost({
        createWorker: inferenceWorker,
        setup: {
          filesBase: new URL(INFERENCE_RUNTIME_PATH, location.origin).href,
          webAssemblySha256: INFERENCE_RUNTIME_SHA256,
          capabilities,
        },
      })),
    ),
  capabilities,
  versions: async (pack, version) => {
    const manifest = await manifestOf(pack, version);
    return manifest.ok ? succeed(undefined) : manifest;
  },
  files: packFile,
  createChannel: () => new MessageChannel(),
  reportFault: (summary) => {
    faults.push(summary);
  },
});

/**
 * Renders the golden named `name` in a thread of its own, connected as a
 * chain worker is, once its pack is found in the catalogue: a missing pack
 * is said here, where its reason can be, rather than as the failed channel
 * the thread would hear of.
 */
async function renderGolden(name: string): Promise<FromHarnessThread> {
  const { pack, version } = mlGolden(name).model.identity;
  const found = await manifestOf(pack, version);
  if (!found.ok) {
    return { kind: 'failed', name, reason: found.failures.map((one) => one.summary).join(' ') };
  }
  return await renderedInThread(name);
}

/** The answer of a thread of its own that renders the golden named `name`. */
function renderedInThread(name: string): Promise<FromHarnessThread> {
  const thread = new (moduleWorkerClass())(harnessWorkerUrl, 'AudioGubbins golden');
  const disconnect = threads.connect(thread);
  return new Promise<FromHarnessThread>((resolve) => {
    const finish = (answer: FromHarnessThread) => {
      thread.terminate();
      disconnect();
      const unread = faults.splice(0);
      resolve(unread.length === 0 ? answer : { kind: 'failed', name, reason: unread.join(' ') });
    };
    thread.addEventListener('message', (event: MessageEvent) => {
      if (isHarnessAnswer(event.data)) finish(event.data);
    });
    thread.addEventListener('error', (event) => {
      event.preventDefault();
      finish({ kind: 'failed', name, reason: event.message });
    });
    thread.postMessage({ kind: 'render', name });
  });
}

Object.assign(window, { renderGolden });
