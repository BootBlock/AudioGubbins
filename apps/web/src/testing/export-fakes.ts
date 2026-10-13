/**
 * The render worker and the codec worker of an export, played on real message
 * channels for a test of the page's export: the render sends blocks under the
 * credit it is given and ends with its frames, and the codec "encodes" what
 * arrives into a file whose body is a byte per frame, sent under the storage
 * worker's credit with a head and a tail, as `stream-messages.ts` has every
 * stream go. Either may be held at a step, refused, or called off, so a test
 * stops an export where it wants to.
 */

import { codecCapability, type CodecEnvironment, type CodecId } from '@audiogubbins/codecs';
import type { ExportEncodeRequest } from '@audiogubbins/codec-runtime';
import {
  FailureKind,
  fail,
  failure,
  sampleCount,
  succeed,
  throwIfCancelled,
  type DomainFailure,
  type DomainResult,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { DspImplementation } from '@audiogubbins/audio-engine';
import type { RenderHost, RenderRequest, RenderRunOptions } from '@audiogubbins/audio-runtime';
import type {
  EncodedStreamMessage,
  RenderedStreamMessage,
  StreamReceiverMessage,
} from '@audiogubbins/import-export';
import type { ExportCodec } from '@audiogubbins/project-format';

import type { RenderRun } from '../audio/render-control.js';
import type { CodecServices, EncodedFile } from '../codecs/codec-services.js';
import { browserExportDestinations, type ExportDestinations } from '../io/export-destinations.js';
import { observable } from '../state/observable.js';

/** Frames a fake render sends in a block. */
const BLOCK_FRAMES = 4_096;

/** The head and tail every fake file has. */
export const FAKE_HEAD = Uint8Array.from([0x41, 0x47]);
export const FAKE_TAIL = Uint8Array.from([0x45, 0x4e, 0x44]);

/** The encoder every fake file names. */
export const FAKE_ENCODER: ExportCodec = {
  id: 'pcm',
  implementation: 'application',
  version: 'AudioGubbins 0.1.0',
};

/** A step a fake waits at until a test lets it go on. */
class Gate {
  #open: (() => void) | undefined;
  #reached: (() => void) | undefined;
  readonly reached: Promise<void>;
  readonly #opened: Promise<void>;

  constructor() {
    this.reached = new Promise((resolve) => {
      this.#reached = resolve;
    });
    this.#opened = new Promise((resolve) => {
      this.#open = resolve;
    });
  }

  /** Waits here, saying it has got here, until opened. */
  async pass(): Promise<void> {
    this.#reached?.();
    await this.#opened;
  }

  open(): void {
    this.#open?.();
  }
}

/** Sends `messages` over `port` as the receiver's credit allows, ending with the last. */
class CreditedSender<T> {
  readonly #port: MessagePort;
  #credit = 0;
  #waiting: (() => void) | undefined;
  refusal: DomainFailure | undefined;

  constructor(port: MessagePort) {
    this.#port = port;
    port.addEventListener('message', (event: MessageEvent<StreamReceiverMessage>) => {
      const message = event.data;
      if (message.kind === 'refused') this.refusal = message.failure;
      else this.#credit += message.credit;
      const wake = this.#waiting;
      this.#waiting = undefined;
      wake?.();
    });
    port.start();
  }

  async send(message: T, transfer: Transferable[] = []): Promise<boolean> {
    while (this.#credit === 0 && this.refusal === undefined) {
      await new Promise<void>((resolve) => {
        this.#waiting = resolve;
      });
    }
    if (this.refusal !== undefined) return false;
    this.#credit -= 1;
    this.#port.postMessage(message, transfer);
    return true;
  }
}

/** The render worker of an export, on the channel the page gives it. */
export class FakeExportRender {
  readonly requests: RenderRequest[] = [];
  readonly runs: RenderRunOptions[] = [];
  /** Where a test holds the render, before it sends its last block. */
  gate: Gate | undefined;
  /** What the render fails with, where a test wants it to. */
  refusal: DomainFailure | undefined;

  /** Holds the next render before its last block, and answers the gate a test opens. */
  hold(): Gate {
    this.gate = new Gate();
    return this.gate;
  }

  readonly host = (): Promise<DomainResult<RenderHost>> =>
    Promise.resolve(succeed({ render: async (request, run) => await this.#render(request, run) }));

  readonly planRender = (): DomainResult<RenderRun> =>
    succeed({
      chunkFrames: BLOCK_FRAMES,
      coefficientBudgetBytes: undefined,
      priority: 'foreground',
    });

  async #render(request: RenderRequest, run: RenderRunOptions) {
    this.requests.push(request);
    this.runs.push(run);
    const [channel] = run.channels ?? [];
    if (channel === undefined) {
      return fail(failure('fake.no-channel', FailureKind.Rejected, 'No channel.'));
    }
    const [sink, port] = channel;
    const sender = new CreditedSender<RenderedStreamMessage>(port);
    const total = request.range.length;
    // The sink's layout, which the graph's conversion gives what it renders.
    const channels =
      request.graph.nodes.find((node) => node.id === sink)?.inputs[0]?.layout.roles.length ?? 1;
    try {
      for (let sent = 0; sent < total;) {
        if (sent + BLOCK_FRAMES >= total) await this.gate?.pass();
        throwIfCancelled(run.signal);
        if (this.refusal !== undefined) {
          await sender.send({ kind: 'failed', failure: this.refusal });
          return fail(this.refusal);
        }
        const frames = Math.min(BLOCK_FRAMES, total - sent);
        const planes = Array.from({ length: channels }, () => new Float32Array(frames));
        if (!(await sender.send({ kind: 'block', channels: planes, frames }))) {
          return fail(sender.refusal ?? failure('fake.refused', FailureKind.Rejected, 'Refused.'));
        }
        sent += frames;
        run.onProgress?.({ framesRendered: sent, framesTotal: total });
      }
      await sender.send({ kind: 'end', frames: total });
    } finally {
      port.close();
    }
    return succeed({
      frames: total,
      latencyTrimmed: new Map(),
      conversions: [],
      dsp: DspImplementation.Reference,
      dspFallbackReason: undefined,
    });
  }
}

/** Everything served: no module failed, and the browser's encoders probed as given. */
export function servedEnvironment(browserEncoders: readonly CodecId[] = []): CodecEnvironment {
  return {
    webAssembly: true,
    codecModule: { kind: 'loaded' },
    encoderModules: new Map(),
    browserDecoders: new Set(),
    browserEncoders: new Set(browserEncoders),
    browserBitRates: new Map(),
  };
}

/** The codec worker of an export: it takes the rendered stream and writes a byte for each frame. */
export class FakeExportCodecs implements Pick<
  CodecServices,
  'capability' | 'environment' | 'encode'
> {
  readonly environment = observable<CodecEnvironment>(servedEnvironment());
  readonly requests: ExportEncodeRequest[] = [];

  capability: CodecServices['capability'] = (codec, use) =>
    codecCapability(this.environment.get(), codec, use);

  readonly encode: CodecServices['encode'] = async (request, ports, progress, signal) => {
    this.requests.push(request);
    const frames = await this.#received(ports.rendered, progress, signal);
    const out = new CreditedSender<EncodedStreamMessage>(ports.stream);
    try {
      if (!frames.ok) {
        await out.send({ kind: 'failed', failure: frames.failures[0] });
        return frames;
      }
      const body = new Uint8Array(frames.value).fill(7);
      if (!(await out.send({ kind: 'body', bytes: body }, [body.buffer]))) {
        return fail(out.refusal ?? failure('fake.refused', FailureKind.Rejected, 'Refused.'));
      }
      await out.send({
        kind: 'finished',
        file: { head: FAKE_HEAD, tail: FAKE_TAIL, dropped: [] },
      });
      const encoded: EncodedFile = {
        frames: expectSuccess(sampleCount(frames.value)),
        encoder: FAKE_ENCODER,
      };
      return succeed(encoded);
    } finally {
      ports.stream.close();
    }
  };

  /** The frames of the rendered stream, granting credit as each message arrives. */
  #received(
    port: MessagePort,
    progress: (frames: number) => void,
    signal: AbortSignal,
  ): Promise<DomainResult<number>> {
    return new Promise((resolve) => {
      let frames = 0;
      const cancelled = (): void => {
        const reason = failure('codec-runtime.cancelled', FailureKind.Retryable, 'Cancelled.');
        port.postMessage({ kind: 'refused', failure: reason } satisfies StreamReceiverMessage);
        port.close();
        resolve(fail(reason));
      };
      if (signal.aborted) {
        cancelled();
        return;
      }
      signal.addEventListener('abort', cancelled, { once: true });
      port.addEventListener('message', (event: MessageEvent<RenderedStreamMessage>) => {
        const message = event.data;
        switch (message.kind) {
          case 'block':
            frames += message.frames;
            progress(frames);
            port.postMessage({ kind: 'ready', credit: 1 } satisfies StreamReceiverMessage);
            return;
          case 'end':
            signal.removeEventListener('abort', cancelled);
            port.close();
            resolve(succeed(frames));
            return;
          case 'failed':
            signal.removeEventListener('abort', cancelled);
            port.close();
            resolve(fail(message.failure));
        }
      });
      port.start();
      port.postMessage({ kind: 'ready', credit: 2 } satisfies StreamReceiverMessage);
    });
  }
}

/**
 * Where an export goes, as a test has the person choose it: the file, folder
 * or folder to trust each chooser answers, nothing where a test leaves it
 * dismissed, and leave to write asked of the handle as the browser asks it.
 */
export class ScriptedExportDestinations implements ExportDestinations {
  /** What the save dialog answers, or nothing for a dismissed one. */
  file: FileSystemFileHandle | undefined;
  /** What the folder picker answers, or nothing for a dismissed one. */
  folder: FileSystemDirectoryHandle | undefined;
  /** The names each save dialog suggested, in order. */
  readonly suggested: string[] = [];
  /** Every download handed over, in order. */
  readonly downloads: { readonly name: string; readonly file: Blob }[] = [];

  readonly chooseFile: ExportDestinations['chooseFile'] = (name) => {
    this.suggested.push(name);
    return Promise.resolve(
      this.file === undefined ? undefined : { kind: 'file', handle: this.file },
    );
  };

  readonly chooseFolder: ExportDestinations['chooseFolder'] = () =>
    Promise.resolve(succeed(this.folder));

  readonly allowWriting = browserExportDestinations(undefined).allowWriting;

  readonly download: ExportDestinations['download'] = (file, name) => {
    this.downloads.push({ name, file });
  };
}
