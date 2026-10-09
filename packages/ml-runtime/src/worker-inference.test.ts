import { describe, expect, it, vi } from 'vitest';

import {
  FailureKind,
  createCancellationSource,
  fail,
  failure,
  succeed,
  type DomainResult,
} from '@audiogubbins/domain';

import type { InferenceCapabilities, InferenceOptions } from './inference-options.js';
import type { InferencePort, InferenceSession, ModelSource } from './inference-port.js';
import type { Tensor } from './tensor.js';
import { ADD_MODEL_SHA256, FAKE_ADD, addModel, addModelBytes } from './testing/add-model.js';
import { EVERY_CAPABILITY, FakeInference } from './testing/fake-inference.js';
import { inProcessInference, testSetup } from './testing/in-process-worker.js';
import { PINNED, valueOf, vector } from './testing/port-contract.js';

/** A port that reads a model at once and opens its session only when the test lets it. */
class GatedInference implements InferencePort {
  readonly fake = new FakeInference(FAKE_ADD);
  #let: () => void = () => undefined;
  readonly #gate = new Promise<void>((resolve) => {
    this.#let = resolve;
  });

  async open(
    model: ModelSource,
    options: InferenceOptions,
  ): Promise<DomainResult<InferenceSession>> {
    const read = await model.read();
    await this.#gate;
    // Opened whatever the caller's signal says, as a port that had passed the
    // point of no return would answer.
    return await this.fake.open(
      { sha256: model.sha256, read: () => Promise.resolve(read) },
      options,
    );
  }

  letOpen(): void {
    this.#let();
  }
}

/**
 * A thread's client over played workers serving `serve`, with the workers the
 * page started and the thread's place among the host's clients.
 */
function clientOver(
  serve: () => InferencePort = () => new FakeInference(FAKE_ADD),
  capabilities: InferenceCapabilities = EVERY_CAPABILITY,
) {
  const { inference, threads, client } = inProcessInference(serve, testSetup(capabilities));
  return { client: inference, workers: threads, thread: client };
}

/** The `Add` model's bytes as another file, by another SHA-256, which no session shares with it. */
function anotherModel(): ModelSource {
  return { ...addModel(), sha256: 'b'.repeat(64) };
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

describe("the inference worker's client", () => {
  it('has the worker started with the setup, and opens every session over one connection to it', async () => {
    const { client, workers } = clientOver();

    valueOf(await client.open(addModel(), PINNED));
    valueOf(await client.open(anotherModel(), PINNED));

    expect(workers).toHaveLength(1);
    expect(workers.map((worker) => worker.scope)).toEqual([['start', 'connect']]);
    expect(workers.map((worker) => worker.kinds)).toEqual([['open', 'model', 'open', 'model']]);
  });

  it("takes the model's bytes and the inputs' buffers to the worker, copying neither", async () => {
    const { client } = clientOver();
    const bytes = addModelBytes();
    const model = { sha256: ADD_MODEL_SHA256, read: () => Promise.resolve(succeed(bytes)) };
    const session = valueOf(await client.open(model, PINNED));
    const inputs = sums();

    valueOf(await session.run(inputs));

    // Nothing on this side keeps them: the bytes were copied for a cache that
    // did not exist, and read again for every pass.
    expect(bytes.byteLength).toBe(0);
    expect([...inputs.values()].map((one) => one.data.byteLength)).toEqual([0, 0]);
  });

  it('reads a file only where the worker holds no session on it, sharing one it holds or kept', async () => {
    const fake = new FakeInference(FAKE_ADD);
    const { client, workers } = clientOver(() => fake);
    let reads = 0;
    const counted = (): ModelSource => ({
      sha256: ADD_MODEL_SHA256,
      read: () => {
        reads += 1;
        return Promise.resolve(succeed(addModelBytes()));
      },
    });

    const first = valueOf(await client.open(counted(), PINNED));
    const second = valueOf(await client.open(counted(), PINNED));
    expect(reads).toBe(1);
    expect(fake.opened).toHaveLength(1);
    expect([...(valueOf(await second.run(sums())).get('c')?.data ?? [])]).toEqual([11, 22]);

    first.release();
    second.release();
    // Kept with nobody holding it, so a pass run again reads nothing.
    valueOf(await client.open(counted(), PINNED));
    expect(reads).toBe(1);
    expect(fake.opened).toHaveLength(1);
    expect(workers[0]?.kinds.filter((kind) => kind === 'model')).toHaveLength(1);
  });

  it('hands a read the file refused to its caller, and lets the worker stop waiting', async () => {
    const fake = new FakeInference(FAKE_ADD);
    const { client, workers } = clientOver(() => fake);
    const refusal = failure('model-pack.file-missing', FailureKind.IntegrityViolation, 'Gone.');
    const refused: ModelSource = {
      sha256: ADD_MODEL_SHA256,
      read: () => Promise.resolve(fail(refusal)),
    };

    expect(codesOf(await client.open(refused, PINNED))).toEqual(['model-pack.file-missing']);
    await vi.waitFor(() => {
      expect(workers[0]?.kinds).toEqual(['open', 'cancel']);
    });
    // The next open of the file reads it afresh.
    valueOf(await client.open(addModel(), PINNED));
    expect(fake.opened).toHaveLength(1);
  });

  it('copies an input that is a view of a larger buffer, rather than taking the memory around it', async () => {
    const { client } = clientOver();
    const session = valueOf(await client.open(addModel(), PINNED));
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
    const session = valueOf(await client.open(addModel(), PINNED));
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
    const gated = new GatedInference();
    const { client, workers } = clientOver(() => gated);
    const caller = createCancellationSource();

    const opening = client.open(addModel(), PINNED, caller.signal);
    // The worker opens the session and answers before it hears of the cancel.
    await vi.waitFor(() => {
      expect(workers[0]?.kinds).toContain('model');
    });
    workers[0]?.holdAnswers();
    gated.letOpen();
    await vi.waitFor(() => {
      expect(gated.fake.openSessions).toBe(1);
    });
    caller.cancel();
    expect(codesOf(await opening)).toEqual(['inference.cancelled']);
    workers[0]?.deliverHeld();

    // The thread lets its hold go; the worker keeps the session for the next
    // open, until no thread is connected to it.
    await vi.waitFor(() => {
      expect(workers[0]?.kinds.at(-1)).toBe('release');
    });
    expect(gated.fake.openSessions).toBe(1);
  });

  it('has the worker let go of a session whose open was cancelled before it opened', async () => {
    const gated = new GatedInference();
    const { client, workers, thread } = clientOver(() => gated);
    const caller = createCancellationSource();

    const opening = client.open(addModel(), PINNED, caller.signal);
    await vi.waitFor(() => {
      expect(workers[0]?.kinds).toContain('model');
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
    // Nobody holds it, and it is let go once no thread is connected.
    thread.disconnect();
    await vi.waitFor(() => {
      expect(gated.fake.openSessions).toBe(0);
    });
  });

  it('answers the runs waiting on a released session as released, and tells the worker', async () => {
    const fake = new FakeInference(FAKE_ADD);
    const { client, workers, thread } = clientOver(() => fake);
    const session = valueOf(await client.open(addModel(), PINNED));
    workers[0]?.holdAnswers();

    const running = session.run(sums());
    session.release();

    expect(codesOf(await running)).toEqual(['inference.session-released']);
    await vi.waitFor(() => {
      expect(workers[0]?.kinds.at(-1)).toBe('release');
    });
    workers[0]?.deliverHeld();
    thread.disconnect();
    await vi.waitFor(() => {
      expect(fake.openSessions).toBe(0);
    });
  });

  it('fails every call and session of a worker that stops, and starts a new worker for the next session', async () => {
    const { client, workers } = clientOver();
    const session = valueOf(await client.open(addModel(), PINNED));
    const [worker] = workers;
    worker?.holdAnswers();

    const running = session.run(sums());
    worker?.fail('An error the worker did not catch.');

    const stopped = await running;
    expect(codesOf(stopped)).toEqual(['inference.worker-failed']);
    expect(stopped.ok ? '' : stopped.failures[0].summary).toMatch(/did not catch/);
    expect(codesOf(await session.run(sums()))).toEqual(['inference.worker-failed']);
    expect(worker?.terminated).toBe(true);

    valueOf(await client.open(addModel(), PINNED));
    expect(workers).toHaveLength(2);
  });

  it('ends a connection whose worker answers what cannot be read', async () => {
    const { client, workers } = clientOver();
    const session = valueOf(await client.open(addModel(), PINNED));
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
    expect(worker?.channels[0]?.other?.closed).toBe(true);
  });

  it("refuses a tensor whose dimensions miss its data, without the worker's hearing of it", async () => {
    const { client, workers } = clientOver();
    const session = valueOf(await client.open(addModel(), PINNED));

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
    const { client, workers } = clientOver(undefined, { fixedWidthSimd: false });
    expect(codesOf(await client.open(addModel(), PINNED))).toEqual([
      'inference.capability-missing',
    ]);
    expect(workers).toHaveLength(0);
  });

  it('ends every connection it closes, failing what they held', async () => {
    const { client, workers } = clientOver();
    const session = valueOf(await client.open(addModel(), PINNED));
    workers[0]?.holdAnswers();
    const running = session.run(sums());

    client.dispose();

    expect(codesOf(await running)).toEqual(['inference.worker-failed']);
    expect(workers[0]?.channels[0]?.other?.closed).toBe(true);
  });
});
