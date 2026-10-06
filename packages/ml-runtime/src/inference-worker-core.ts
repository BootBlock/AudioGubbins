/**
 * What the inference worker does, apart from the scope it runs in.
 *
 * It serves the port it is given, the adapter over the runtime in the worker,
 * to the page: each message read field by field, each session kept by the
 * call that opened it, each call answered once with its outcome, its outputs'
 * buffers transferred. A call the page cancels is cancelled here too, and a
 * session opened for a cancelled call is let go at once rather than kept.
 * Runtime files from any origin but the worker's own are refused before the
 * runtime is started, so a misconfigured base can never send it to a CDN.
 */

import {
  FailureKind,
  createCancellationSource,
  fail,
  failure,
  type CancellationSource,
  type DomainFailureResult,
} from '@audiogubbins/domain';

import type { RuntimeSetup } from './inference-options.js';
import { released, type InferencePort, type InferenceSession } from './inference-port.js';
import { readToInferenceWorker } from './protocol/inference-message-reading.js';
import {
  FromInferenceWorkerKind,
  ToInferenceWorkerKind,
  movable,
  tensorTransfers,
  type FromInferenceWorker,
  type NamedTensor,
  type ToInferenceWorker,
} from './protocol/inference-messages.js';

/** What the worker's scope gives the core. */
export interface InferenceWorkerHost {
  readonly post: (message: FromInferenceWorker, transfer: readonly ArrayBuffer[]) => void;
  /** The port the worker serves, made from the setup the page started it with. */
  readonly serve: (setup: RuntimeSetup) => InferencePort;
  /** The origin the worker was loaded from, such as `https://example.com`. */
  readonly origin: string;
}

type Message<TKind extends ToInferenceWorker['kind']> = Extract<
  ToInferenceWorker,
  { readonly kind: TKind }
>;

/** The scheme and authority a URL begins with. */
const ORIGIN = /^([a-z][a-z\d+.-]*:\/\/[^/?#]*)\//i;

function refusedSetup(summary: string): DomainFailureResult {
  return fail(failure('inference.setup-refused', FailureKind.Rejected, summary));
}

/** The inference worker's work, given its scope's parts. */
export class InferenceWorkerCore {
  readonly #host: InferenceWorkerHost;
  #port: InferencePort | undefined;
  readonly #sessions = new Map<number, InferenceSession>();
  /** The calls not yet answered, each cancelled when the page cancels it. */
  readonly #calls = new Map<number, CancellationSource>();

  constructor(host: InferenceWorkerHost) {
    this.#host = host;
  }

  /** Handles one message from the page. */
  receive(value: unknown): void {
    const read = readToInferenceWorker(value);
    if (!read.ok) {
      this.#host.post({ kind: FromInferenceWorkerKind.Refused, failures: read.failures }, []);
      return;
    }
    const message = read.value;
    switch (message.kind) {
      case ToInferenceWorkerKind.Start:
        this.#start(message);
        return;
      case ToInferenceWorkerKind.Open:
        this.#open(message).catch(this.#faulted(message.call));
        return;
      case ToInferenceWorkerKind.Run:
        this.#run(message).catch(this.#faulted(message.call));
        return;
      case ToInferenceWorkerKind.Cancel:
        this.#calls.get(message.call)?.cancel();
        return;
      case ToInferenceWorkerKind.Release:
        this.#sessions.get(message.session)?.release();
        this.#sessions.delete(message.session);
        return;
    }
  }

  /** A message that could not be deserialised: the page cannot know which call it was. */
  messageFailed(): void {
    this.#host.post(
      {
        kind: FromInferenceWorkerKind.Refused,
        failures: [
          failure(
            'inference.message-malformed',
            FailureKind.Unrecoverable,
            'A message to the inference worker could not be received.',
          ),
        ],
      },
      [],
    );
  }

  #start({ setup }: Message<typeof ToInferenceWorkerKind.Start>): void {
    const refusal = this.#setupRefusal(setup);
    if (refusal === undefined) this.#port = this.#host.serve(setup);
    else this.#host.post({ kind: FromInferenceWorkerKind.Refused, failures: refusal.failures }, []);
  }

  /** Why a worker cannot be started with `setup`: it was started already, or the files are elsewhere. */
  #setupRefusal(setup: RuntimeSetup): DomainFailureResult | undefined {
    if (this.#port !== undefined) {
      return refusedSetup('The inference worker was started already, and keeps its runtime.');
    }
    const origin = ORIGIN.exec(setup.filesBase)?.[1]?.toLowerCase();
    return origin === this.#host.origin.toLowerCase()
      ? undefined
      : refusedSetup(
          `The runtime's files must be served from ${this.#host.origin}, the application's own origin, not ${setup.filesBase}.`,
        );
  }

  async #open({ call, model, options }: Message<typeof ToInferenceWorkerKind.Open>): Promise<void> {
    const port = this.#port;
    if (port === undefined) {
      this.#failed(
        call,
        failure(
          'inference.runtime-unavailable',
          FailureKind.Unrecoverable,
          'The inference worker was sent a session before its runtime setup.',
        ),
      );
      return;
    }
    const source = this.#begin(call);
    const opened = await port.open(model, options, source.signal);
    this.#calls.delete(call);
    if (!opened.ok) {
      this.#answer(call, opened);
      return;
    }
    const session = opened.value;
    if (source.signal.aborted) {
      // Opened for a caller who has gone: nobody will ever release it.
      session.release();
      return;
    }
    this.#sessions.set(call, session);
    const { inputs, outputs, execution } = session;
    this.#host.post({ kind: FromInferenceWorkerKind.Opened, call, inputs, outputs, execution }, []);
  }

  async #run({ call, session, inputs }: Message<typeof ToInferenceWorkerKind.Run>): Promise<void> {
    const open = this.#sessions.get(session);
    if (open === undefined) {
      this.#answer(call, released());
      return;
    }
    const source = this.#begin(call);
    const ran = await open.run(new Map(inputs.map((one) => [one.name, one])), source.signal);
    this.#calls.delete(call);
    if (!ran.ok) {
      this.#answer(call, ran);
      return;
    }
    const outputs = [...ran.value].map(([name, one]): NamedTensor => movable({ name, ...one }));
    this.#host.post({ kind: FromInferenceWorkerKind.Ran, call, outputs }, tensorTransfers(outputs));
  }

  /**
   * Answers a call whose port threw rather than answering, which the port's
   * contract forbids: the page would otherwise wait on the call for ever, since
   * a rejection in a worker reaches no listener of the page's.
   */
  #faulted(call: number): (error: unknown) => void {
    return (error) => {
      this.#calls.delete(call);
      const reason = error instanceof Error ? error.message : String(error);
      this.#failed(
        call,
        failure(
          'inference.worker-failed',
          FailureKind.Unrecoverable,
          `The inference runtime failed: ${reason}`,
        ),
      );
    };
  }

  #begin(call: number): CancellationSource {
    const source = createCancellationSource();
    this.#calls.set(call, source);
    return source;
  }

  /** Answers a call that failed; the page passes over the answer to one it cancelled. */
  #answer(call: number, result: DomainFailureResult): void {
    const [first, ...rest] = result.failures;
    this.#failed(call, first, ...rest);
  }

  #failed(call: number, ...failures: Parameters<typeof fail>): void {
    this.#host.post({ kind: FromInferenceWorkerKind.Failed, call, failures }, []);
  }
}
