import { describe, expect, it, vi } from 'vitest';

import { createCancellationSource, type DomainResult } from '@audiogubbins/domain';

import {
  GraphOptimisation,
  InferenceMode,
  PreviewAcceleratorKind,
  RuntimeBuild,
  type InferenceCapabilities,
  type InferenceOptions,
} from './inference-options.js';
import type { InferencePort, InferenceSession, ModelBytes } from './inference-port.js';
import type { Tensor } from './tensor.js';
import { FAKE_ADD, addModelBytes } from './testing/add-model.js';
import { EVERY_CAPABILITY, FakeInference } from './testing/fake-inference.js';
import { InProcessWorker, TEST_ORIGIN } from './testing/in-process-worker.js';
import { PINNED, valueOf, vector } from './testing/port-contract.js';
import { WorkerInference } from './worker-inference.js';

/** A port whose sessions open only when the test lets them. */
class GatedInference implements InferencePort {
  readonly fake = new FakeInference(FAKE_ADD);
  #let: () => void = () => undefined;
  readonly #gate = new Promise<void>((resolve) => {
    this.#let = resolve;
  });

  async open(
    model: ModelBytes,
    options: InferenceOptions,
  ): Promise<DomainResult<InferenceSession>> {
    await this.#gate;
    // Opened whatever the caller's signal says, as a port that had passed the
    // point of no return would answer.
    return await this.fake.open(model, options);
  }

  letOpen(): void {
    this.#let();
  }
}

/** A client over played workers serving `serve`, with the workers it made. */
function clientOver(
  serve: () => InferencePort = () => new FakeInference(FAKE_ADD),
  capabilities: InferenceCapabilities = EVERY_CAPABILITY,
) {
  const workers: InProcessWorker[] = [];
  const createWorker = vi.fn(() => {
    const worker = new InProcessWorker(serve);
    workers.push(worker);
    return worker;
  });
  const client = new WorkerInference({
    createWorker,
    setup: {
      filesBase: `${TEST_ORIGIN}/runtime/`,
      webAssemblySha256: {
        [RuntimeBuild.Cpu]: 'a'.repeat(64),
        [RuntimeBuild.WebGpu]: 'b'.repeat(64),
      },
      capabilities,
    },
  });
  return { client, workers, createWorker };
}

function codesOf<TValue>(result: DomainResult<TValue>): readonly string[] {
  return result.ok ? [] : result.failures.map((one) => one.code);
}

function sums(): Map<string, Tensor> {
  return new Map([
    ['a', vector([1, 2])],
    ['b', vector([10, 20])],
  ]);
}

const PREVIEW_ON_TWO: InferenceOptions = {
  kind: InferenceMode.Preview,
  graphOptimisation: GraphOptimisation.All,
  accelerator: { kind: PreviewAcceleratorKind.Threads, threads: 2 },
};

describe("the inference workers' client", () => {
  it('starts each worker with the setup, and runs each runtime configuration in a worker of its own', async () => {
    const { client, workers } = clientOver();

    valueOf(await client.open(addModelBytes(), PINNED));
    valueOf(await client.open(addModelBytes(), PINNED));
    valueOf(await client.open(addModelBytes(), PREVIEW_ON_TWO));

    expect(workers).toHaveLength(2);
    expect(workers.map((worker) => worker.kinds)).toEqual([
      ['start', 'open', 'open'],
      ['start', 'open'],
    ]);
  });

  it("takes the inputs' buffers to the worker, and leaves the model's bytes with the caller", async () => {
    const { client } = clientOver();
    const model = addModelBytes();
    const session = valueOf(await client.open(model, PINNED));
    const inputs = sums();

    valueOf(await session.run(inputs));

    expect(model.byteLength).toBeGreaterThan(0);
    expect([...inputs.values()].map((one) => one.data.byteLength)).toEqual([0, 0]);
  });

  it('copies an input that is a view of a larger buffer, rather than taking the memory around it', async () => {
    const { client } = clientOver();
    const session = valueOf(await client.open(addModelBytes(), PINNED));
    const memory = new Float32Array([7, 1, 2, 10, 20, 7]);

    const outputs = valueOf(
      await session.run(
        new Map([
          ['a', { data: memory.subarray(1, 3), dims: [2] }],
          ['b', { data: memory.subarray(3, 5), dims: [2] }],
        ]),
      ),
    );

    expect([...memory]).toEqual([7, 1, 2, 10, 20, 7]);
    expect([...(outputs.get('c')?.data ?? [])]).toEqual([11, 22]);
  });

  it('answers a cancelled run at once, tells the worker, and passes over its late answer', async () => {
    const { client, workers } = clientOver();
    const session = valueOf(await client.open(addModelBytes(), PINNED));
    const [worker] = workers;
    worker?.holdAnswers();
    const caller = createCancellationSource();

    const running = session.run(sums(), caller.signal);
    await vi.waitFor(() => {
      expect(worker?.kinds).toContain('run');
    });
    caller.cancel();

    expect(codesOf(await running)).toEqual(['inference.cancelled']);
    await vi.waitFor(() => {
      expect(worker?.kinds).toContain('cancel');
    });
    worker?.deliverHeld();
    expect(valueOf(await session.run(sums())).get('c')?.dims).toEqual([2]);
  });

  it('lets go of a session that opened after its caller cancelled', async () => {
    const fake = new FakeInference(FAKE_ADD);
    const { client, workers } = clientOver(() => fake);
    valueOf(await client.open(addModelBytes(), PINNED));
    const [worker] = workers;
    // The worker opens the second session and answers before it hears of the cancel.
    worker?.holdAnswers();
    const caller = createCancellationSource();

    const opening = client.open(addModelBytes(), PINNED, caller.signal);
    await vi.waitFor(() => {
      expect(fake.openSessions).toBe(2);
    });
    caller.cancel();
    expect(codesOf(await opening)).toEqual(['inference.cancelled']);
    worker?.deliverHeld();

    await vi.waitFor(() => {
      expect(fake.openSessions).toBe(1);
    });
  });

  it('has the worker let go of a session whose open was cancelled before it opened', async () => {
    const gated = new GatedInference();
    const { client, workers } = clientOver(() => gated);
    const caller = createCancellationSource();

    const opening = client.open(addModelBytes(), PINNED, caller.signal);
    await vi.waitFor(() => {
      expect(workers[0]?.kinds).toContain('open');
    });
    caller.cancel();
    expect(codesOf(await opening)).toEqual(['inference.cancelled']);
    await vi.waitFor(() => {
      expect(workers[0]?.kinds).toContain('cancel');
    });
    gated.letOpen();

    await vi.waitFor(() => {
      expect(gated.fake.opened).toHaveLength(1);
    });
    await vi.waitFor(() => {
      expect(gated.fake.openSessions).toBe(0);
    });
  });

  it('answers the runs waiting on a released session as released, and tells the worker', async () => {
    const fake = new FakeInference(FAKE_ADD);
    const { client, workers } = clientOver(() => fake);
    const session = valueOf(await client.open(addModelBytes(), PINNED));
    workers[0]?.holdAnswers();

    const running = session.run(sums());
    session.release();

    expect(codesOf(await running)).toEqual(['inference.session-released']);
    await vi.waitFor(() => {
      expect(fake.openSessions).toBe(0);
    });
    expect(workers[0]?.kinds.at(-1)).toBe('release');
  });

  it('fails every call and session of a worker that stops, and starts a new worker for the next session', async () => {
    const { client, workers } = clientOver();
    const session = valueOf(await client.open(addModelBytes(), PINNED));
    const [worker] = workers;
    worker?.holdAnswers();

    const running = session.run(sums());
    worker?.fail('An error the worker did not catch.');

    const stopped = await running;
    expect(codesOf(stopped)).toEqual(['inference.worker-failed']);
    expect(stopped.ok ? '' : stopped.failures[0].summary).toMatch(/did not catch/);
    expect(codesOf(await session.run(sums()))).toEqual(['inference.worker-failed']);
    expect(worker?.terminated).toBe(true);

    valueOf(await client.open(addModelBytes(), PINNED));
    expect(workers).toHaveLength(2);
  });

  it('ends a worker that answers what cannot be read', async () => {
    const { client, workers } = clientOver();
    const session = valueOf(await client.open(addModelBytes(), PINNED));
    const [worker] = workers;
    worker?.holdAnswers();

    const running = session.run(sums());
    await vi.waitFor(() => {
      expect(worker?.kinds).toContain('run');
    });
    worker?.answer({ kind: 'ran', call: 2, outputs: [{ name: 'c', data: [1, 2], dims: [2] }] });

    const ended = await running;
    expect(codesOf(ended)).toEqual(['inference.worker-failed']);
    expect(ended.ok ? '' : ended.failures[0].summary).toMatch(/data is not 32-bit floats/);
    expect(worker?.terminated).toBe(true);
  });

  it("refuses a tensor whose dimensions miss its data, without the worker's hearing of it", async () => {
    const { client, workers } = clientOver();
    const session = valueOf(await client.open(addModelBytes(), PINNED));

    const refused = await session.run(
      new Map([
        ['a', { data: new Float32Array(3), dims: [4] }],
        ['b', vector([1, 2, 3, 4])],
      ]),
    );

    expect(codesOf(refused)).toEqual(['inference.tensor-shape']);
    expect(workers[0]?.kinds).not.toContain('run');
  });

  it('refuses a session the device cannot run without starting a worker', async () => {
    const { client, createWorker } = clientOver(undefined, { ...EVERY_CAPABILITY, threads: 1 });
    expect(codesOf(await client.open(addModelBytes(), PREVIEW_ON_TWO))).toEqual([
      'inference.capability-missing',
    ]);
    expect(createWorker).not.toHaveBeenCalled();
  });

  it('ends every worker it closes, failing what they held', async () => {
    const { client, workers } = clientOver();
    const session = valueOf(await client.open(addModelBytes(), PINNED));
    workers[0]?.holdAnswers();
    const running = session.run(sums());

    client.dispose();

    expect(codesOf(await running)).toEqual(['inference.worker-failed']);
    expect(workers[0]?.terminated).toBe(true);
  });
});
