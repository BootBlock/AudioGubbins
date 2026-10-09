import { describe, expect, it, vi } from 'vitest';

import { failure, FailureKind } from '@audiogubbins/domain';

import { InferenceConversation, type WorkerRuntime } from './inference-conversation.js';
import type { InferencePort } from './inference-port.js';
import type { FromInferenceWorker } from './protocol/inference-messages.js';
import { ADD_MODEL_SHA256, FAKE_ADD, addModelBytes } from './testing/add-model.js';
import { FakeInference } from './testing/fake-inference.js';
import { PINNED } from './testing/port-contract.js';

/**
 * A conversation over `runtime`, with everything it posted but its asks for a
 * model's bytes, which a thread is played answering a turn later, the calls
 * it asked for, and everything it transferred.
 */
function conversationOver(runtime: WorkerRuntime) {
  const posted: FromInferenceWorker[] = [];
  const wanted: number[] = [];
  const transferred: ArrayBuffer[] = [];
  const conversation = new InferenceConversation({
    post: (message, transfer) => {
      if (message.kind === 'model-wanted') {
        wanted.push(message.call);
        setTimeout(() => {
          conversation.receive({ kind: 'model', call: message.call, model: addModelBytes() });
        }, 0);
        return;
      }
      posted.push(message);
      transferred.push(...transfer);
    },
    runtime: () => runtime,
  });
  return { conversation, posted, wanted, transferred };
}

/** An open of the `Add` model as `call`. */
function openOf(call: number) {
  return { kind: 'open', call, sha256: ADD_MODEL_SHA256, options: PINNED } as const;
}

function serving(port: InferencePort): WorkerRuntime {
  return { kind: 'serving', port };
}

describe("a thread's conversation with the inference worker", () => {
  it('fails a session with the reason the worker has no runtime', async () => {
    const reason = failure('inference.setup-refused', FailureKind.Rejected, 'Refused.');
    const { conversation, posted } = conversationOver({ kind: 'unavailable', reason });
    conversation.receive(openOf(1));
    await vi.waitFor(() => {
      expect(posted).toMatchObject([
        { kind: 'failed', call: 1, failures: [{ code: 'inference.setup-refused' }] },
      ]);
    });
  });

  it('refuses a message it cannot read, or could not receive, without knowing its call', () => {
    const { conversation, posted } = conversationOver(serving(new FakeInference(FAKE_ADD)));
    conversation.receive({ kind: 'open', call: 'one' });
    conversation.receive({ kind: 'start', setup: {} });
    conversation.messageFailed();
    expect(posted).toMatchObject([
      { kind: 'refused', failures: [{ code: 'inference.message-malformed' }] },
      { kind: 'refused', failures: [{ code: 'inference.message-malformed' }] },
      { kind: 'refused', failures: [{ code: 'inference.message-malformed' }] },
    ]);
  });

  it("answers a run's outputs with their buffers to transfer, and a run on a session it does not hold as released", async () => {
    const { conversation, posted, transferred } = conversationOver(
      serving(new FakeInference(FAKE_ADD)),
    );
    conversation.receive(openOf(1));
    await vi.waitFor(() => {
      expect(posted.map((one) => one.kind)).toEqual(['opened']);
    });

    const a = { name: 'a', data: new Float32Array([1, 2]), dims: [2] };
    const b = { name: 'b', data: new Float32Array([3, 4]), dims: [2] };
    conversation.receive({ kind: 'run', call: 2, session: 1, inputs: [a, b] });
    conversation.receive({ kind: 'run', call: 3, session: 9, inputs: [a, b] });

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

  it('answers a call whose port throws, rather than leave the thread waiting on it', async () => {
    const { conversation, posted } = conversationOver(
      serving({ open: () => Promise.reject(new Error('The runtime broke.')) }),
    );
    conversation.receive(openOf(1));

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

  it('lets go of a session the thread releases', async () => {
    const fake = new FakeInference(FAKE_ADD);
    const { conversation, posted } = conversationOver(serving(fake));
    conversation.receive(openOf(1));
    await vi.waitFor(() => {
      expect(posted.map((one) => one.kind)).toEqual(['opened']);
    });

    conversation.receive({ kind: 'release', session: 1 });

    expect(fake.openSessions).toBe(0);
  });

  it('asks the thread for the model where its port reads it, and opens from the bytes the thread sends', async () => {
    const fake = new FakeInference(FAKE_ADD);
    const { conversation, posted, wanted } = conversationOver(serving(fake));
    conversation.receive(openOf(1));
    await vi.waitFor(() => {
      expect(posted.map((one) => one.kind)).toEqual(['opened']);
    });
    expect(wanted).toEqual([1]);
    expect(fake.opened).toHaveLength(1);
  });

  it('lets every session go once closed, an open waiting on its model among them, and answers nothing more', async () => {
    const fake = new FakeInference(FAKE_ADD);
    const { conversation, posted } = conversationOver(serving(fake));
    conversation.receive(openOf(1));
    await vi.waitFor(() => {
      expect(posted.map((one) => one.kind)).toEqual(['opened']);
    });
    conversation.receive(openOf(2));

    conversation.close();

    await vi.waitFor(() => {
      expect(fake.openSessions).toBe(0);
    });
    // The second open's read of its model was cancelled, so nothing opened.
    expect(fake.opened).toHaveLength(1);
    conversation.receive(openOf(3));
    expect(posted.map((one) => one.kind)).toEqual(['opened']);
  });
});
