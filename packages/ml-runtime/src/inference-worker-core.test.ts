import { describe, expect, it, vi } from 'vitest';

import { RuntimeBuild, type RuntimeSetup } from './inference-options.js';
import { InferenceWorkerCore } from './inference-worker-core.js';
import type { FromInferenceWorker } from './protocol/inference-messages.js';
import { FAKE_ADD, addModelBytes } from './testing/add-model.js';
import { EVERY_CAPABILITY, FakeInference } from './testing/fake-inference.js';
import { PINNED } from './testing/port-contract.js';

const ORIGIN = 'https://audiogubbins.test';

const SETUP: RuntimeSetup = {
  filesBase: `${ORIGIN}/assets/runtime/`,
  webAssemblySha256: { [RuntimeBuild.Cpu]: 'a'.repeat(64), [RuntimeBuild.WebGpu]: 'b'.repeat(64) },
  capabilities: EVERY_CAPABILITY,
};

/** A core over the fake, with everything it posted and everything it transferred. */
function coreOver() {
  const posted: FromInferenceWorker[] = [];
  const transferred: ArrayBuffer[] = [];
  const fake = new FakeInference(FAKE_ADD);
  const serve = vi.fn(() => fake);
  const core = new InferenceWorkerCore({
    post: (message, transfer) => {
      posted.push(message);
      transferred.push(...transfer);
    },
    serve,
    origin: ORIGIN,
  });
  return { core, posted, transferred, fake, serve };
}

describe('the inference worker core', () => {
  it('serves the port made from its setup, and refuses to be started twice', () => {
    const { core, posted, serve } = coreOver();

    core.receive({ kind: 'start', setup: SETUP });
    core.receive({ kind: 'start', setup: SETUP });

    expect(serve).toHaveBeenCalledOnce();
    expect(posted).toMatchObject([
      { kind: 'refused', failures: [{ code: 'inference.setup-refused' }] },
    ]);
  });

  it.each([
    ['another origin', 'https://cdn.example.com/runtime/'],
    ['an origin that only begins like its own', `${ORIGIN}.example.com/runtime/`],
    ['its own host under another scheme', 'http://audiogubbins.test/runtime/'],
  ])('refuses runtime files from %s, and starts no runtime', (_case, filesBase) => {
    const { core, posted, serve } = coreOver();
    core.receive({ kind: 'start', setup: { ...SETUP, filesBase } });
    expect(serve).not.toHaveBeenCalled();
    expect(posted).toMatchObject([
      { kind: 'refused', failures: [{ code: 'inference.setup-refused' }] },
    ]);
  });

  it('fails a session asked for before its setup', async () => {
    const { core, posted } = coreOver();
    core.receive({ kind: 'open', call: 1, model: addModelBytes(), options: PINNED });
    await vi.waitFor(() => {
      expect(posted).toMatchObject([
        { kind: 'failed', call: 1, failures: [{ code: 'inference.runtime-unavailable' }] },
      ]);
    });
  });

  it('refuses a message it cannot read, or could not receive, without knowing its call', () => {
    const { core, posted } = coreOver();
    core.receive({ kind: 'open', call: 'one' });
    core.messageFailed();
    expect(posted).toMatchObject([
      { kind: 'refused', failures: [{ code: 'inference.message-malformed' }] },
      { kind: 'refused', failures: [{ code: 'inference.message-malformed' }] },
    ]);
  });

  it("answers a run's outputs with their buffers to transfer, and a run on a session it does not hold as released", async () => {
    const { core, posted, transferred } = coreOver();
    core.receive({ kind: 'start', setup: SETUP });
    core.receive({ kind: 'open', call: 1, model: addModelBytes(), options: PINNED });
    await vi.waitFor(() => {
      expect(posted.map((one) => one.kind)).toEqual(['opened']);
    });

    const a = { name: 'a', data: new Float32Array([1, 2]), dims: [2] };
    const b = { name: 'b', data: new Float32Array([3, 4]), dims: [2] };
    core.receive({ kind: 'run', call: 2, session: 1, inputs: [a, b] });
    core.receive({ kind: 'run', call: 3, session: 9, inputs: [a, b] });

    await vi.waitFor(() => {
      expect(posted).toHaveLength(3);
    });
    const ran = posted.find((one) => one.kind === 'ran');
    expect(ran?.kind === 'ran' ? ran.outputs.map((one) => one.data.buffer) : []).toEqual(
      transferred,
    );
    expect(transferred).toHaveLength(1);
    expect(posted).toContainEqual({
      kind: 'failed',
      call: 3,
      failures: [expect.objectContaining({ code: 'inference.session-released' })],
    });
  });

  it('answers a call whose port throws, rather than leave the page waiting on it', async () => {
    const posted: FromInferenceWorker[] = [];
    const core = new InferenceWorkerCore({
      post: (message) => posted.push(message),
      serve: () => ({ open: () => Promise.reject(new Error('The runtime broke.')) }),
      origin: ORIGIN,
    });
    core.receive({ kind: 'start', setup: SETUP });
    core.receive({ kind: 'open', call: 1, model: addModelBytes(), options: PINNED });

    await vi.waitFor(() => {
      expect(posted).toMatchObject([
        {
          kind: 'failed',
          call: 1,
          failures: [
            {
              code: 'inference.worker-failed',
              summary: 'The inference runtime failed: The runtime broke.',
            },
          ],
        },
      ]);
    });
  });

  it('lets go of a session the page releases', async () => {
    const { core, posted, fake } = coreOver();
    core.receive({ kind: 'start', setup: SETUP });
    core.receive({ kind: 'open', call: 1, model: addModelBytes(), options: PINNED });
    await vi.waitFor(() => {
      expect(posted.map((one) => one.kind)).toEqual(['opened']);
    });

    core.receive({ kind: 'release', session: 1 });

    expect(fake.openSessions).toBe(0);
  });
});
