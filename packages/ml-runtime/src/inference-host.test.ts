import { describe, expect, it } from 'vitest';

import { InferenceHost, type InferenceThreadPort } from './inference-host.js';
import type { ToInferenceThread } from './protocol/inference-messages.js';
import { inProcessChannel, testSetup } from './testing/in-process-worker.js';

/** A worker that records what the host sends it, and can fail. */
class RecordingWorker implements InferenceThreadPort {
  readonly sent: ToInferenceThread[] = [];
  terminated = false;
  #error: ((event: { readonly message: string }) => void) | undefined;

  postMessage(message: ToInferenceThread): void {
    this.sent.push(message);
  }

  addEventListener(_type: 'error', listener: (event: { readonly message: string }) => void): void {
    this.#error = listener;
  }

  terminate(): void {
    this.terminated = true;
  }

  fail(message: string): void {
    this.#error?.({ message });
  }
}

function hostOver() {
  const workers: RecordingWorker[] = [];
  const host = new InferenceHost({
    createWorker: () => {
      const worker = new RecordingWorker();
      workers.push(worker);
      return worker;
    },
    setup: testSetup(),
  });
  return { host, workers };
}

describe("the page's end of the inference worker", () => {
  it('starts no worker until a thread connects, then one for every thread, started with the setup once', () => {
    const { host, workers } = hostOver();
    const one = host.client(() => undefined);
    const other = host.client(() => undefined);
    expect(workers).toHaveLength(0);
    expect(host.running).toBe(false);

    one.connect(inProcessChannel()[1]);
    other.connect(inProcessChannel()[1]);

    expect(workers).toHaveLength(1);
    expect(workers[0]?.sent).toMatchObject([
      { kind: 'start', setup: testSetup() },
      { kind: 'connect', client: 1 },
      { kind: 'connect', client: 2 },
    ]);
  });

  it("tells the worker once that a thread has gone, and refuses the thread's later channels", () => {
    const { host, workers } = hostOver();
    const one = host.client(() => undefined);
    const other = host.client(() => undefined);
    one.connect(inProcessChannel()[1]);
    other.connect(inProcessChannel()[1]);

    one.disconnect();
    one.disconnect();
    const [, late] = inProcessChannel();
    one.connect(late);

    expect(workers[0]?.sent.at(-1)).toEqual({ kind: 'disconnect', client: 1 });
    expect(workers[0]?.sent.filter((message) => message.kind === 'disconnect')).toHaveLength(1);
    expect(late.closed).toBe(true);
  });

  it('ends a worker that fails, tells each thread connected to it why, and starts another for the next connection', () => {
    const { host, workers } = hostOver();
    const heard: [string, string][] = [];
    const one = host.client((reason) => heard.push(['one', reason]));
    const other = host.client((reason) => heard.push(['other', reason]));
    const idle = host.client((reason) => heard.push(['idle', reason]));
    one.connect(inProcessChannel()[1]);
    other.connect(inProcessChannel()[1]);

    workers[0]?.fail('The runtime ran out of memory.');
    workers[0]?.fail('Again.');

    expect(workers[0]?.terminated).toBe(true);
    expect(heard).toEqual([
      ['one', 'The runtime ran out of memory.'],
      ['other', 'The runtime ran out of memory.'],
    ]);
    expect(host.running).toBe(false);

    idle.connect(inProcessChannel()[1]);
    expect(workers).toHaveLength(2);
    expect(workers[1]?.sent.map((message) => message.kind)).toEqual(['start', 'connect']);
  });

  it('ends the worker it is disposed of, telling the threads', () => {
    const { host, workers } = hostOver();
    const heard: string[] = [];
    host.client((reason) => heard.push(reason)).connect(inProcessChannel()[1]);

    host.dispose();

    expect(workers[0]?.terminated).toBe(true);
    expect(heard).toEqual(['The inference worker was closed.']);
  });
});
