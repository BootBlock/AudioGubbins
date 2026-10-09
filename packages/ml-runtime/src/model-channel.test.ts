import { describe, expect, it, vi } from 'vitest';

import {
  FailureKind,
  createCancellationSource,
  fail,
  failure,
  succeed,
  type CancellationSignal,
  type DomainResult,
} from '@audiogubbins/domain';

import { InferenceHost } from './inference-host.js';
import { ModelChannel, type ModelFileRead } from './model-channel.js';
import { ModelThreads, type ModelFileReader } from './model-threads.js';
import type { ToModelThread } from './protocol/model-channel-messages.js';
import { FAKE_ADD, addModel } from './testing/add-model.js';
import { FakeInference } from './testing/fake-inference.js';
import {
  InProcessThread,
  TEST_ORIGIN,
  inProcessChannel,
  testSetup,
} from './testing/in-process-worker.js';
import { PINNED, valueOf, vector } from './testing/port-contract.js';

function pair() {
  const [port1, port2] = inProcessChannel();
  return { port1, port2 };
}

const BYTES = new Uint8Array([1, 2, 3, 4]);
const SHA = 'c'.repeat(64);

/** The page's end over workers played here, a thread's channel connected to it, and what each saw. */
function connectedThread(
  files: ModelFileReader = () => Promise.resolve(succeed({ bytes: BYTES.slice(), sha256: SHA })),
) {
  const fake = new FakeInference(FAKE_ADD);
  const workers: InProcessThread[] = [];
  const host = new InferenceHost({
    createWorker: () => {
      const worker = new InProcessThread(() => fake, TEST_ORIGIN);
      workers.push(worker);
      return worker;
    },
    setup: testSetup(),
  });
  const faults: string[] = [];
  const threads = new ModelThreads({
    inference: () => Promise.resolve(host),
    capabilities: testSetup().capabilities,
    files,
    createChannel: pair,
    reportFault: (summary) => faults.push(summary),
  });
  const channel = new ModelChannel(pair);
  let sent: ToModelThread | undefined;
  const disconnect = threads.connect({
    postMessage: (message) => {
      sent = message;
      expect(channel.receive(message)).toBe(true);
    },
  });
  if (sent === undefined) throw new Error('The thread was sent its connection.');
  return { fake, workers, host, disconnect, channel, faults, page: sent.port };
}

/** Settles after `milliseconds`, for a call that must have been answered by then. */
function stillWaiting(milliseconds: number): Promise<'still waiting'> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve('still waiting');
    }, milliseconds);
  });
}

function codesOf<TValue>(result: DomainResult<TValue>): readonly string[] {
  return result.ok ? [] : result.failures.map((one) => one.code);
}

describe("a thread's model channel", () => {
  it("passes over a message of the thread's own protocol, and answers every call with why before the page connects it", async () => {
    const channel = new ModelChannel(pair);
    expect(channel.receive({ kind: 'render', job: 1 })).toBe(false);
    expect(codesOf(await channel.file('pack', '1.0.0', 'model.onnx'))).toEqual([
      'inference.channel-failed',
    ]);
    expect(codesOf(await channel.open(addModel(), PINNED))).toEqual(['inference.channel-failed']);
  });

  it("reads a pack's file through the page, its bytes and their hash as the page's reader gave them", async () => {
    const asked: string[] = [];
    const { channel } = connectedThread((pack, version, path) => {
      asked.push(`${pack} ${version} ${path}`);
      return Promise.resolve(succeed({ bytes: BYTES.slice(), sha256: SHA }));
    });

    const read = valueOf(await channel.file('deepfilternet-3', '1.0.0', 'enc.onnx'));

    expect(asked).toEqual(['deepfilternet-3 1.0.0 enc.onnx']);
    expect([...read.bytes]).toEqual([...BYTES]);
    expect(read.sha256).toBe(SHA);
  });

  it("answers a file the page's reader cannot give with the reader's failures, their details and cause kept", async () => {
    const unavailable = failure('model.unavailable', FailureKind.Unrecoverable, 'Not installed.', {
      details: { condition: 'required-unavailable', pack: 'deepfilternet-3' },
      cause: failure('model-pack.not-installed', FailureKind.Conflict, 'No pack.'),
    });
    const { channel } = connectedThread(() => Promise.resolve(fail(unavailable)));

    const read = await channel.file('deepfilternet-3', '1.0.0', 'enc.onnx');

    expect(read.ok ? [] : read.failures).toEqual([unavailable]);
  });

  it("cancels the page's read when the thread cancels, answering at once", async () => {
    let heard: CancellationSignal | undefined;
    const { channel } = connectedThread((_pack, _version, _path, signal) => {
      heard = signal;
      return new Promise<DomainResult<ModelFileRead>>(() => undefined);
    });
    const caller = createCancellationSource();

    const reading = channel.file('pack', '1.0.0', 'model.onnx', caller.signal);
    await vi.waitFor(() => {
      expect(heard).toBeDefined();
    });
    caller.cancel();

    expect(codesOf(await reading)).toEqual(['inference.cancelled']);
    await vi.waitFor(() => {
      expect(heard?.aborted).toBe(true);
    });
  });

  it('runs a model on the one worker the page starts, talking to it directly', async () => {
    const { channel, workers } = connectedThread();

    const session = valueOf(await channel.open(addModel(), PINNED));
    const outputs = valueOf(
      await session.run(
        new Map([
          ['a', vector([1, 2])],
          ['b', vector([10, 20])],
        ]),
      ),
    );

    expect([...(outputs.get('c')?.data ?? [])]).toEqual([11, 22]);
    expect(workers).toHaveLength(1);
    expect(workers[0]?.kinds).toEqual(['open', 'model', 'run']);
  });

  it("fails the thread's calls with the reason when its worker fails, and connects again for the next session", async () => {
    const { channel, workers } = connectedThread();
    const session = valueOf(await channel.open(addModel(), PINNED));
    workers[0]?.holdAnswers();
    const running = session.run(
      new Map([
        ['a', vector([1])],
        ['b', vector([2])],
      ]),
    );
    await vi.waitFor(() => {
      expect(workers[0]?.kinds).toContain('run');
    });

    workers[0]?.fail('The runtime ran out of memory.');

    // Bounded, so a call the failure never reaches fails here and says so.
    const failed = await Promise.race([running, stillWaiting(1_000)]);
    if (failed === 'still waiting') expect.fail('The run was not answered once its worker failed.');
    expect(codesOf(failed)).toEqual(['inference.worker-failed']);
    expect(failed.ok ? '' : failed.failures[0].summary).toMatch(/ran out of memory/);
    valueOf(await channel.open(addModel(), PINNED));
    expect(workers).toHaveLength(2);
  });

  it('has the workers let the sessions of a thread that has gone go, and cancels its reads', async () => {
    let heard: CancellationSignal | undefined;
    const { channel, fake, disconnect } = connectedThread((_pack, _version, _path, signal) => {
      heard = signal;
      return new Promise<DomainResult<ModelFileRead>>(() => undefined);
    });
    valueOf(await channel.open(addModel(), PINNED));
    void channel.file('pack', '1.0.0', 'model.onnx');
    await vi.waitFor(() => {
      expect(heard).toBeDefined();
    });
    expect(fake.openSessions).toBe(1);

    disconnect();

    expect(heard?.aborted).toBe(true);
    await vi.waitFor(() => {
      expect(fake.openSessions).toBe(0);
    });
  });

  it('records a message from a thread it cannot read, and fails a channel the page answers unreadably', async () => {
    const { page: threadEnd, faults } = connectedThread();
    threadEnd.postMessage({ kind: 'file', call: 'one' }, []);
    await vi.waitFor(() => {
      expect(faults).toEqual([expect.stringMatching(/call is not a whole number/)]);
    });

    const [thread, other] = inProcessChannel();
    const channel = new ModelChannel(pair);
    channel.receive({
      kind: 'model-channel',
      port: thread,
      capabilities: testSetup().capabilities,
    });
    const reading = channel.file('pack', '1.0.0', 'model.onnx');
    other.addEventListener('message', () => {
      other.postMessage({ kind: 'file', call: 1, bytes: [1], sha256: SHA }, []);
    });
    other.start();

    const failed = await reading;
    expect(codesOf(failed)).toEqual(['inference.channel-failed']);
    expect(failed.ok ? '' : failed.failures[0].summary).toMatch(/bytes is not bytes/);
  });
});
