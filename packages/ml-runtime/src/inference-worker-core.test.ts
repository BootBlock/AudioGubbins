import { describe, expect, it, vi } from 'vitest';

import type { RuntimeSetup } from './inference-options.js';
import { InferenceWorkerCore, MOST_CONNECTIONS } from './inference-worker-core.js';
import { ADD_MODEL_SHA256, FAKE_ADD, addModelBytes } from './testing/add-model.js';
import { EVERY_CAPABILITY, FakeInference } from './testing/fake-inference.js';
import { inProcessChannel } from './testing/in-process-worker.js';
import { PINNED } from './testing/port-contract.js';

const ORIGIN = 'https://audiogubbins.test';

const SETUP: RuntimeSetup = {
  filesBase: `${ORIGIN}/assets/runtime/`,
  webAssemblySha256: 'a'.repeat(64),
  capabilities: EVERY_CAPABILITY,
};

/** A core over the fake, with the faults it reported. */
function coreOver() {
  const faults: string[] = [];
  const fake = new FakeInference(FAKE_ADD);
  const serve = vi.fn(() => fake);
  const core = new InferenceWorkerCore({
    serve,
    origin: ORIGIN,
    reportFault: (error) => faults.push(error.message),
  });
  return { core, faults, fake, serve };
}

/**
 * A thread's end of a new channel the core serves as `client`, and the replies
 * it heard but the worker's asks for the model's bytes, which it answers.
 */
function connected(core: InferenceWorkerCore, client: number) {
  const [thread, worker] = inProcessChannel();
  const replies: unknown[] = [];
  thread.addEventListener('message', (event) => {
    const reply: unknown = event.data;
    if (
      typeof reply === 'object' &&
      reply !== null &&
      Reflect.get(reply, 'kind') === 'model-wanted'
    ) {
      const model = addModelBytes();
      thread.postMessage({ kind: 'model', call: Reflect.get(reply, 'call'), model }, [
        model.buffer,
      ]);
      return;
    }
    replies.push(reply);
  });
  thread.start();
  core.receive({ kind: 'connect', client, port: worker });
  return { thread, worker, replies };
}

/** An open of the `Add` model as `call`. */
function openOf(call: number) {
  return { kind: 'open', call, sha256: ADD_MODEL_SHA256, options: PINNED } as const;
}

describe('the inference worker core', () => {
  it('serves the port made from its setup, and reports a second start rather than take it', () => {
    const { core, faults, serve } = coreOver();

    core.receive({ kind: 'start', setup: SETUP });
    core.receive({ kind: 'start', setup: SETUP });

    expect(serve).toHaveBeenCalledOnce();
    expect(faults).toEqual([expect.stringMatching(/^inference\.setup-refused: .*started already/)]);
  });

  it.each([
    ['another origin', 'https://cdn.example.com/runtime/'],
    ['an origin that only begins like its own', `${ORIGIN}.example.com/runtime/`],
    ['its own host under another scheme', 'http://audiogubbins.test/runtime/'],
  ])(
    'refuses runtime files from %s, starts no runtime, and answers sessions why',
    async (_case, filesBase) => {
      const { core, faults, serve } = coreOver();
      core.receive({ kind: 'start', setup: { ...SETUP, filesBase } });
      const { thread, replies } = connected(core, 1);
      thread.postMessage(openOf(1), []);

      expect(serve).not.toHaveBeenCalled();
      expect(faults).toEqual([expect.stringMatching(/application's own origin/)]);
      await vi.waitFor(() => {
        expect(replies).toMatchObject([
          { kind: 'failed', call: 1, failures: [{ code: 'inference.setup-refused' }] },
        ]);
      });
    },
  );

  it('reports a message from the page it cannot read, or could not receive', () => {
    const { core, faults } = coreOver();
    core.receive({ kind: 'connect', client: 1, port: {} });
    core.messageFailed();
    expect(faults).toEqual([
      expect.stringMatching(/^inference\.message-malformed: .*port/),
      expect.stringMatching(/^inference\.message-malformed: /),
    ]);
  });

  it('shares a session on one file among the threads, and lets it go once the last thread has gone', async () => {
    const { core, fake } = coreOver();
    core.receive({ kind: 'start', setup: SETUP });
    const one = connected(core, 1);
    const other = connected(core, 2);
    one.thread.postMessage(openOf(1), []);
    await vi.waitFor(() => {
      expect(one.replies).toHaveLength(1);
    });
    other.thread.postMessage(openOf(1), []);
    await vi.waitFor(() => {
      expect(other.replies).toHaveLength(1);
    });
    // Each pass of every thread loaded the model again before.
    expect(fake.opened).toHaveLength(1);
    expect(fake.openSessions).toBe(1);

    core.receive({ kind: 'disconnect', client: 1 });
    expect(fake.openSessions).toBe(1);
    expect(core.connections).toBe(1);
    expect(one.worker.closed).toBe(true);

    core.receive({ kind: 'disconnect', client: 2 });
    expect(fake.openSessions).toBe(0);
  });

  it(`refuses a connection past ${String(MOST_CONNECTIONS)}, saying why, and closes it`, async () => {
    const { core } = coreOver();
    core.receive({ kind: 'start', setup: SETUP });
    for (let client = 1; client <= MOST_CONNECTIONS; client += 1) connected(core, client);

    const refused = connected(core, MOST_CONNECTIONS + 1);

    expect(core.connections).toBe(MOST_CONNECTIONS);
    expect(refused.worker.closed).toBe(true);
    await vi.waitFor(() => {
      expect(refused.replies).toMatchObject([
        { kind: 'refused', failures: [{ code: 'inference.too-many-connections' }] },
      ]);
    });
  });
});
