/**
 * The codec worker's core, driven as the page and the storage worker drive
 * it, for a test: files in memory read through a stand-in `FileReaderSync`,
 * the codec module compiled as the page compiles it, and each stream's
 * receiving end played by the test over a real message channel, granting
 * credit as the test says and recording every message it was sent.
 */

import type { CodecPlatform, CodecProbes } from '@audiogubbins/capabilities';
import {
  readDecodedStreamMessage,
  type DecodedStreamMessage,
  type StreamReceiverMessage,
} from '@audiogubbins/import-export';

import type { BlobLike, FileReaderSyncLike } from '../files/sync-file-bytes.js';
import type { MessagePortLike, PortMessage } from '../streams/stream-port.js';
import { CodecWorkerCore } from '../worker/codec-worker-core.js';
import type {
  FromCodecWorker,
  ModuleSource,
  ToCodecWorker,
} from '../worker/codec-worker-messages.js';
import type { OpenExportEncoder } from '../worker/encode-job.js';
import { codecModuleBytes } from './codec-module.js';

/** The bytes of each file in memory, by the stand-in that names it. */
const FILES = new WeakMap<BlobLike, Uint8Array>();

/** `bytes` as a chosen file, sliced as a `Blob` is. */
export function memoryFile(bytes: Uint8Array): BlobLike {
  const file: BlobLike = {
    size: bytes.length,
    slice: (start, end) => memoryFile(bytes.subarray(start, end)),
  };
  FILES.set(file, bytes);
  return file;
}

/** A stand-in for `FileReaderSync` over files in memory. */
export const MEMORY_READER: FileReaderSyncLike = {
  readAsArrayBuffer: (blob) => {
    const bytes = FILES.get(blob);
    if (bytes === undefined) throw new DOMException('Not a file in memory.', 'NotReadableError');
    return bytes.slice().buffer;
  },
};

/** One end of a channel in Node or a browser, as both offer it. */
interface ChannelPair {
  readonly port1: MessagePortLike;
  readonly port2: MessagePortLike;
}

/** A message channel of the host the test runs in. */
export function messageChannel(): ChannelPair {
  const Channel: unknown = Reflect.get(globalThis, 'MessageChannel');
  if (typeof Channel !== 'function') throw new Error('The test host has no MessageChannel.');
  const pair: unknown = Reflect.construct(Channel, []);
  const port1: unknown =
    typeof pair === 'object' && pair !== null ? Reflect.get(pair, 'port1') : undefined;
  const port2: unknown =
    typeof pair === 'object' && pair !== null ? Reflect.get(pair, 'port2') : undefined;
  if (!isPort(port1) || !isPort(port2)) throw new Error('The test host has no message ports.');
  return { port1, port2 };
}

function isPort(value: unknown): value is MessagePortLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'postMessage') === 'function'
  );
}

/** A browser that offers what a test says, probed as a test says. */
export interface HarnessOptions {
  readonly platform?: Partial<CodecPlatform>;
  readonly probes?: Partial<CodecProbes>;
  readonly codecModule?: ModuleSource;
  readonly openExportEncoder?: OpenExportEncoder;
}

/** A configured core and everything it posted to the page. */
export interface Harness {
  readonly core: CodecWorkerCore;
  readonly posted: FromCodecWorker[];
  /** The message that ends `request`, waiting for it. */
  answer(request: string): Promise<FromCodecWorker>;
  /** Every progress message posted for `request`. */
  progress(request: string): readonly number[];
}

const NO_ENCODER: OpenExportEncoder = () => Promise.reject(new Error('No encoder in this test.'));

/** The core over the real codec module, configured as the page configures it. */
export async function workerHarness(options: HarnessOptions = {}): Promise<Harness> {
  const posted: FromCodecWorker[] = [];
  const waiting: (() => void)[] = [];
  const faults: unknown[] = [];
  const platform: CodecPlatform = {
    webAssembly: true,
    decoding: undefined,
    encoding: undefined,
    browser: { name: 'Chrome', majorVersion: '131' },
    ...options.platform,
  };
  const probes: CodecProbes = {
    webAssembly: true,
    browserDecoders: new Set(),
    browserEncoders: new Set(),
    ...options.probes,
  };
  const core = new CodecWorkerCore({
    post: (message) => {
      posted.push(message);
      for (const wake of waiting.splice(0)) wake();
    },
    yieldToHost: () =>
      new Promise((resolve) => {
        setTimeout(resolve, 0);
      }),
    platform,
    probe: () => Promise.resolve(probes),
    fileReader: MEMORY_READER,
    openExportEncoder: options.openExportEncoder ?? NO_ENCODER,
    reportFault: (error) => {
      faults.push(error);
    },
  });
  const module =
    options.codecModule ??
    ({ kind: 'compiled', module: await WebAssembly.compile(codecModuleBytes()) } as const);
  core.receive({
    kind: 'configure',
    codecModule: module,
    prebuiltEncoders: {
      mp3: { kind: 'unavailable', reason: 'No MP3 encoder in this test.' },
      vorbis: { kind: 'unavailable', reason: 'No Vorbis encoder in this test.' },
    },
  });
  const ends = new Set(['analysed', 'decoded', 'encoded', 'failed', 'cancelled']);
  const endOf = (request: string): FromCodecWorker | undefined =>
    posted.find(
      (message) => ends.has(message.kind) && 'request' in message && message.request === request,
    );
  return {
    core,
    posted,
    answer: async (request) => {
      for (;;) {
        if (faults.length > 0) throw faults[0];
        const end = endOf(request);
        if (end !== undefined) return end;
        await new Promise<void>((resolve) => waiting.push(resolve));
      }
    },
    progress: (request) =>
      posted.flatMap((message) =>
        message.kind === 'progress' && message.request === request ? [message.frames] : [],
      ),
  };
}

/**
 * The codec worker as the page sees it, over the core: what the page posts
 * reaches the core a turn later and in order, a chosen file read into memory
 * first, since no test host reads a `Blob` synchronously; and what the core
 * posts reaches the page's listener a turn later, as a thread's message does.
 * A test raises a fault of the worker as the browser would.
 */
export interface PageWorker {
  post(message: ToCodecWorker, transfer: readonly unknown[]): void;
  listen(onMessage: (data: unknown) => void, onFault: (reason: string) => void): void;
  terminate(): void;
  /** Every message the page posted, in order. */
  readonly sent: readonly ToCodecWorker[];
  /** Whether the page terminated the worker. */
  readonly terminated: () => boolean;
  /** Raises a fault of the worker, as its `error` event does. */
  fault(reason: string): void;
}

/** The message `message` is once its chosen file, if it names one, is read into memory. */
async function inMemory(message: ToCodecWorker): Promise<ToCodecWorker> {
  if (message.kind !== 'analyse' && message.kind !== 'decode') return message;
  const { file } = message;
  if (file.kind !== 'file' || !(file.file instanceof Blob)) return message;
  const bytes = new Uint8Array(await file.file.arrayBuffer());
  return { ...message, file: { kind: 'file', file: memoryFile(bytes) } };
}

/** The core, unconfigured, as the page that starts the worker meets it. */
export function pageWorker(options: Omit<HarnessOptions, 'codecModule'> = {}): PageWorker {
  const sent: ToCodecWorker[] = [];
  let hear: (data: unknown) => void = () => undefined;
  let faulted: (reason: string) => void = () => undefined;
  let terminated = false;
  const core = new CodecWorkerCore({
    post: (message) => {
      setTimeout(() => {
        if (!terminated) hear(message);
      }, 0);
    },
    yieldToHost: () =>
      new Promise((resolve) => {
        setTimeout(resolve, 0);
      }),
    platform: {
      webAssembly: true,
      decoding: undefined,
      encoding: undefined,
      browser: { name: 'Chrome', majorVersion: '131' },
      ...options.platform,
    },
    probe: () =>
      Promise.resolve({
        webAssembly: true,
        browserDecoders: new Set(),
        browserEncoders: new Set(),
        ...options.probes,
      }),
    fileReader: MEMORY_READER,
    openExportEncoder: options.openExportEncoder ?? NO_ENCODER,
    reportFault: (error) => {
      faulted(error instanceof Error ? error.message : String(error));
    },
  });
  // Each message is read into memory before the next is handed over, so the
  // core receives them in the order the page sent them.
  let delivered = Promise.resolve();
  return {
    post: (message) => {
      sent.push(message);
      delivered = delivered.then(async () => {
        const arrived = await inMemory(message);
        if (!terminated) core.receive(arrived);
      });
    },
    listen: (onMessage, onFault) => {
      hear = onMessage;
      faulted = onFault;
    },
    terminate: () => {
      terminated = true;
    },
    sent,
    terminated: () => terminated,
    fault: (reason) => {
      setTimeout(() => {
        faulted(reason);
      }, 0);
    },
  };
}

/** How the test's receiver grants credit: all at once, or a window refilled per message taken. */
export type CreditPolicy = { readonly window: number };

/** The storage worker's side of a decoded stream, played by the test. */
export interface DecodedReceiver {
  /** The port the worker sends the stream over. */
  readonly port: MessagePortLike;
  readonly messages: DecodedStreamMessage[];
  /** The most messages the worker ever sent past the credit granted: 0 where it never ran ahead. */
  readonly overdrawn: () => number;
  /** Resolves when the stream has ended, its last message `end` or `failed`. */
  readonly ended: Promise<DecodedStreamMessage>;
  /** Ends the stream from the receiver's side. */
  refuse(message: StreamReceiverMessage): void;
  /** Stops granting credit until resumed. */
  pause(): void;
  resume(): void;
  close(): void;
}

/** A receiver that grants `window` messages of credit, and one more for each message it takes. */
export function decodedReceiver(policy: CreditPolicy): DecodedReceiver {
  const { port1, port2 } = messageChannel();
  const messages: DecodedStreamMessage[] = [];
  let granted = 0;
  let received = 0;
  let mostOutstanding = 0;
  let paused = false;
  let owed = 0;
  let finish: (message: DecodedStreamMessage) => void = () => undefined;
  const ended = new Promise<DecodedStreamMessage>((resolve) => {
    finish = resolve;
  });
  const grant = (credit: number): void => {
    if (paused) {
      owed += credit;
      return;
    }
    granted += credit;
    const ready: StreamReceiverMessage = { kind: 'ready', credit };
    port2.postMessage(ready, []);
  };
  port2.addEventListener('message', (event: PortMessage) => {
    received += 1;
    mostOutstanding = Math.max(mostOutstanding, received - granted);
    const read = readDecodedStreamMessage(event.data);
    if (!read.ok) throw new Error(read.failures[0].summary);
    messages.push(read.value);
    if (read.value.kind === 'end' || read.value.kind === 'failed') finish(read.value);
    // Credit is granted a turn after a message is taken, as a write takes its
    // time, so a sender that ran ahead of it would be seen to.
    else
      setTimeout(() => {
        grant(1);
      }, 1);
  });
  port2.start();
  grant(policy.window);
  return {
    port: port1,
    messages,
    overdrawn: () => mostOutstanding,
    ended,
    refuse: (message) => {
      port2.postMessage(message, []);
    },
    pause: () => {
      paused = true;
    },
    resume: () => {
      paused = false;
      const credit = owed;
      owed = 0;
      if (credit > 0) grant(credit);
    },
    close: () => {
      port2.close();
    },
  };
}
