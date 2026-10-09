/**
 * What the inference worker does, apart from the scope it runs in.
 *
 * The page starts it once with the runtime's setup, and the worker makes the
 * port it serves, the adapter over the runtime, from it. Runtime files from
 * any origin but the worker's own are refused before the runtime is started,
 * so a misconfigured base can never send it to a CDN. The page then connects
 * it to each thread that runs models by a channel of the thread's own, and
 * the worker holds a conversation over each (`inference-conversation.ts`),
 * every one served by the one runtime, since a runtime is started once in its
 * global scope and a session cannot cross into another, and every one sharing
 * the sessions it holds (`shared-sessions.ts`), which the worker lets go once
 * no thread is connected.
 *
 * Connections are bounded: a thread connects at most once per runtime
 * configuration, the page lets a thread's connections go once the thread has
 * gone, and past {@link MOST_CONNECTIONS} a connection is refused rather than
 * left to hold sessions without limit, since a page that forgot to say a
 * thread had gone would otherwise keep every session it ever opened.
 */

import { FailureKind, failure, type DomainFailure } from '@audiogubbins/domain';

import type { ChannelEnd } from './channel-end.js';
import { InferenceConversation, type WorkerRuntime } from './inference-conversation.js';
import type { RuntimeSetup } from './inference-options.js';
import type { InferencePort } from './inference-port.js';
import { readToInferenceThread } from './protocol/inference-message-reading.js';
import { SharedSessions } from './shared-sessions.js';
import {
  FromInferenceWorkerKind,
  ToInferenceThreadKind,
  type FromInferenceWorker,
} from './protocol/inference-messages.js';

/**
 * The most channels a worker serves at once: far more than the threads that
 * run chains (the preview, peak and detection workers, a feeder per playback
 * session and the render pool), so it is met only by a page that loses track
 * of its threads.
 */
export const MOST_CONNECTIONS = 32;

/** What the worker's scope gives the core. */
export interface InferenceWorkerHost {
  /** The port the worker serves, made from the setup the page started it with. */
  readonly serve: (setup: RuntimeSetup) => InferencePort;
  /** The origin the worker was loaded from, such as `https://example.com`. */
  readonly origin: string;
  /** Reports what no thread can be told: a message from the page that was refused. */
  readonly reportFault: (error: Error) => void;
}

/** Why a session asked for before the page's setup cannot open. */
const NOT_STARTED: WorkerRuntime = {
  kind: 'unavailable',
  reason: failure(
    'inference.runtime-unavailable',
    FailureKind.Unrecoverable,
    'The inference worker was sent a session before its runtime setup.',
  ),
};

/** The scheme and authority a URL begins with. */
const ORIGIN = /^([a-z][a-z\d+.-]*:\/\/[^/?#]*)\//i;

/** A connection: the conversation, and the channel it is held over. */
interface Connection {
  readonly client: number;
  readonly end: ChannelEnd;
  readonly conversation: InferenceConversation;
}

/** The inference worker's work, given its scope's parts. */
export class InferenceWorkerCore {
  readonly #host: InferenceWorkerHost;
  #runtime: WorkerRuntime = NOT_STARTED;
  /** The sessions every conversation shares, once the runtime is started. */
  #sessions: SharedSessions | undefined;
  readonly #connections = new Set<Connection>();

  constructor(host: InferenceWorkerHost) {
    this.#host = host;
  }

  /** How many channels the worker serves now. */
  get connections(): number {
    return this.#connections.size;
  }

  /** Handles one message from the page to the worker's own scope. */
  receive(value: unknown): void {
    const read = readToInferenceThread(value);
    if (!read.ok) {
      this.#report(read.failures[0]);
      return;
    }
    const message = read.value;
    switch (message.kind) {
      case ToInferenceThreadKind.Start: {
        const refusal = this.#setupRefusal(message.setup);
        if (refusal === undefined) {
          const sessions = new SharedSessions(this.#host.serve(message.setup));
          this.#sessions = sessions;
          this.#runtime = { kind: 'serving', port: sessions };
        } else {
          this.#report(refusal);
          // Its sessions are answered with the reason; a runtime already
          // started is kept, and serves on.
          if (this.#runtime.kind === 'unavailable') {
            this.#runtime = { kind: 'unavailable', reason: refusal };
          }
        }
        return;
      }
      case ToInferenceThreadKind.Connect:
        this.#connect(message.client, message.port);
        return;
      case ToInferenceThreadKind.Disconnect:
        for (const connection of [...this.#connections]) {
          if (connection.client === message.client) this.#close(connection);
        }
        return;
    }
  }

  /** A message from the page that could not be deserialised, which names nothing to answer. */
  messageFailed(): void {
    this.#report(
      failure(
        'inference.message-malformed',
        FailureKind.Unrecoverable,
        'A message to the inference worker could not be received.',
      ),
    );
  }

  #connect(client: number, end: ChannelEnd): void {
    const post = (message: FromInferenceWorker, transfer: readonly ArrayBuffer[]): void => {
      end.postMessage(message, transfer);
    };
    if (this.#connections.size >= MOST_CONNECTIONS) {
      post(
        {
          kind: FromInferenceWorkerKind.Refused,
          failures: [
            failure(
              'inference.too-many-connections',
              FailureKind.Rejected,
              `The inference worker serves ${String(MOST_CONNECTIONS)} threads at most, so another is refused.`,
            ),
          ],
        },
        [],
      );
      end.close();
      return;
    }
    const conversation = new InferenceConversation({ post, runtime: () => this.#runtime });
    this.#connections.add({ client, end, conversation });
    end.addEventListener('message', (event) => {
      conversation.receive(event.data);
    });
    end.addEventListener('messageerror', () => {
      conversation.messageFailed();
    });
    end.start();
  }

  #close(connection: Connection): void {
    this.#connections.delete(connection);
    connection.conversation.close();
    connection.end.close();
    if (this.#connections.size === 0) this.#sessions?.releaseIdle();
  }

  /** Why a worker cannot be started with `setup`: it was started already, or the files are elsewhere. */
  #setupRefusal(setup: RuntimeSetup): DomainFailure | undefined {
    if (this.#runtime.kind === 'serving') {
      return failure(
        'inference.setup-refused',
        FailureKind.Rejected,
        'The inference worker was started already, and keeps its runtime.',
      );
    }
    const origin = ORIGIN.exec(setup.filesBase)?.[1]?.toLowerCase();
    return origin === this.#host.origin.toLowerCase()
      ? undefined
      : failure(
          'inference.setup-refused',
          FailureKind.Rejected,
          `The runtime's files must be served from ${this.#host.origin}, the application's own origin, not ${setup.filesBase}.`,
        );
  }

  #report(refusal: DomainFailure): void {
    this.#host.reportFault(new Error(`${refusal.code}: ${refusal.summary}`));
  }
}
