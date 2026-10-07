import { afterEach, describe, expect, it, vi } from 'vitest';

import { createCapabilityRegistry } from '@audiogubbins/capabilities';
import { createDiagnosticCentre, createLogStore } from '@audiogubbins/diagnostics';

import { CAPABLE } from '../testing/shell-context.js';
import { startModels } from './model-services.js';

/**
 * A thread that runs chains holds a model channel, and the inference workers
 * hold its sessions, until it lets go: the hosts end a thread only by
 * terminating it, and a terminated thread closes no channel, so terminating
 * one must let go of its channel too. Missed, every render or preview thread
 * ended would leave its sessions open in the inference workers for as long as
 * the page lives.
 */

/** A browser worker as far as the page drives one, recording what it is sent. */
class RecordingWorker {
  static started: RecordingWorker[] = [];
  readonly url: string;
  readonly options: WorkerOptions | undefined;
  readonly sent: { readonly message: unknown; readonly transfer: readonly unknown[] }[] = [];
  terminated = false;

  constructor(url: string, options?: WorkerOptions) {
    this.url = url;
    this.options = options;
    RecordingWorker.started.push(this);
  }

  postMessage(message: unknown, transfer: readonly unknown[] = []): void {
    this.sent.push({ message, transfer });
  }

  terminate(): void {
    this.terminated = true;
  }
}

function settled(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

afterEach(() => {
  vi.unstubAllGlobals();
  RecordingWorker.started = [];
});

function services() {
  const logger = createDiagnosticCentre(createLogStore(), { now: () => 0 }).loggerFor('models');
  return startModels(createCapabilityRegistry(CAPABLE, logger), undefined, logger);
}

/** The end of its model channel `worker` was given, and handed over, as it started. */
function channelEnd(worker: RecordingWorker): MessagePort {
  const [first] = worker.sent;
  const message: unknown = first?.message;
  if (
    typeof message !== 'object' ||
    message === null ||
    !('port' in message) ||
    !(message.port instanceof MessagePort) ||
    !first?.transfer.includes(message.port)
  ) {
    throw new Error('The worker was not sent its model channel first.');
  }
  return message.port;
}

describe('the workers that run chains', () => {
  it('start as module workers, each sent its model channel as it starts', () => {
    vi.stubGlobal('Worker', RecordingWorker);
    const models = services();

    const worker = models.startChainWorker('chain-worker.js');

    const [started] = RecordingWorker.started;
    if (started === undefined) throw new Error('No worker was started.');
    expect(started).toBe(worker);
    expect(started.url).toBe('chain-worker.js');
    expect(started.options).toEqual({ type: 'module' });
    expect(channelEnd(started)).toBeInstanceOf(MessagePort);
    models.dispose();
  });

  it('let go of their model channel as they are terminated, and only then', async () => {
    vi.stubGlobal('Worker', RecordingWorker);
    const models = services();
    const worker = models.startChainWorker('chain-worker.js');
    const [recorded] = RecordingWorker.started;
    if (recorded === undefined) throw new Error('No worker was started.');
    const end = channelEnd(recorded);
    let closed = false;
    const closing = new Promise<void>((resolve) => {
      end.addEventListener('close', () => {
        closed = true;
        resolve();
      });
    });
    end.start();

    await settled(20);
    expect(closed).toBe(false);

    worker.terminate();
    // A channel closes in a later turn; one that never closes fails here.
    await Promise.race([closing, settled(1_000)]);

    expect(recorded.terminated).toBe(true);
    expect(closed).toBe(true);
    end.close();
    models.dispose();
  });
});
