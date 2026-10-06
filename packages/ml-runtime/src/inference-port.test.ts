import { describe, expect, it, vi } from 'vitest';

import { createCancellationSource, succeed, type DomainResult } from '@audiogubbins/domain';

import { unlessCancelled } from './inference-port.js';
import { tensor } from './tensor.js';
import { FAKE_ADD, addModelBytes } from './testing/add-model.js';
import { FakeInference } from './testing/fake-inference.js';
import { InProcessWorker, TEST_ORIGIN } from './testing/in-process-worker.js';
import { portContract } from './testing/port-contract.js';
import { RuntimeBuild } from './inference-options.js';
import { WorkerInference } from './worker-inference.js';

portContract('the fake runtime', {
  port: (capabilities) => new FakeInference(FAKE_ADD, capabilities),
  model: addModelBytes,
});

portContract("the worker's client, over a worker serving the fake", {
  port: (capabilities) =>
    new WorkerInference({
      createWorker: () =>
        new InProcessWorker((setup) => new FakeInference(FAKE_ADD, setup.capabilities)),
      setup: {
        filesBase: `${TEST_ORIGIN}/runtime/`,
        webAssemblySha256: {
          [RuntimeBuild.Cpu]: 'a'.repeat(64),
          [RuntimeBuild.WebGpu]: 'b'.repeat(64),
        },
        capabilities,
      },
    }),
  model: addModelBytes,
});

describe('a tensor', () => {
  it('is its data in dimensions that multiply to its length', () => {
    expect(tensor(new Float32Array(6), [2, 3]).ok).toBe(true);
    expect(tensor(new Float32Array(0), [0, 4]).ok).toBe(true);
  });

  it('refuses dimensions that do not describe its data, or are not whole', () => {
    const codes = (result: DomainResult<unknown>): readonly string[] =>
      result.ok ? [] : result.failures.map((one) => one.code);
    expect(codes(tensor(new Float32Array(5), [2, 3]))).toEqual(['inference.tensor-shape']);
    expect(codes(tensor(new Float32Array(3), [1.5, 2]))).toEqual(['inference.tensor-shape']);
    expect(codes(tensor(new Float32Array(3), [-1, -3]))).toEqual(['inference.tensor-shape']);
  });
});

describe('answering unless cancelled', () => {
  it('hands work that outran its cancelled caller to be let go, and only that work', async () => {
    const caller = createCancellationSource();
    let finish: (value: DomainResult<string>) => void = () => undefined;
    const work = new Promise<DomainResult<string>>((resolve) => {
      finish = resolve;
    });
    const discarded: string[] = [];

    const answer = unlessCancelled(work, caller.signal, {
      discard: (value) => discarded.push(value),
    });
    caller.cancel();
    expect(await answer).toMatchObject({ ok: false, failures: [{ code: 'inference.cancelled' }] });
    expect(discarded).toEqual([]);

    finish(succeed('session'));
    await vi.waitFor(() => {
      expect(discarded).toEqual(['session']);
    });
  });

  it('gives the work its own answer, and discards nothing, where it comes first', async () => {
    const caller = createCancellationSource();
    const discarded: string[] = [];
    const answer = await unlessCancelled(Promise.resolve(succeed('session')), caller.signal, {
      discard: (value) => discarded.push(value),
    });
    caller.cancel();
    expect(answer).toEqual(succeed('session'));
    expect(discarded).toEqual([]);
  });
});
