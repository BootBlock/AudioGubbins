import { describe, expect, it } from 'vitest';

import {
  FailureKind,
  createCancellationSource,
  fail,
  failure,
  succeed,
  type DomainResult,
} from '@audiogubbins/domain';

import { GraphOptimisation } from './inference-options.js';
import type { ModelBytes, ModelSource } from './inference-port.js';
import { SharedSessions } from './shared-sessions.js';
import { FAKE_ADD } from './testing/add-model.js';
import { FakeInference } from './testing/fake-inference.js';
import { PINNED, valueOf, vector } from './testing/port-contract.js';

/** A file of `size` bytes known as `sha256`, counting its reads, each answered as `answer` says. */
function fileOf(
  sha256: string,
  size = 8,
  answer: () => Promise<DomainResult<ModelBytes>> = () =>
    Promise.resolve(succeed(new Uint8Array(size))),
) {
  const file = {
    reads: 0,
    source: {
      sha256,
      read: () => {
        file.reads += 1;
        return answer();
      },
    } satisfies ModelSource,
  };
  return file;
}

function codesOf<TValue>(result: DomainResult<TValue>): readonly string[] {
  return result.ok ? [] : result.failures.map((one) => one.code);
}

function sums() {
  return new Map([
    ['a', vector([1])],
    ['b', vector([2])],
  ]);
}

/** A promise and the function that settles it, so a test decides when. */
function deferred<TValue>() {
  let resolve: (value: TValue) => void = () => undefined;
  const promise = new Promise<TValue>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe("the inference worker's shared sessions", () => {
  it('shares one session among opens of the same file and options, reading the file once', async () => {
    const fake = new FakeInference(FAKE_ADD);
    const shared = new SharedSessions(fake);
    const file = fileOf('a'.repeat(64));

    const [one, other] = await Promise.all([
      shared.open(file.source, PINNED),
      shared.open(file.source, PINNED),
    ]);
    expect(file.reads).toBe(1);
    expect(fake.opened).toHaveLength(1);
    expect(valueOf(await valueOf(other).run(sums())).get('c')?.data).toEqual(new Float32Array([3]));

    // Other options, or another file, open sessions of their own.
    valueOf(await shared.open(file.source, { graphOptimisation: GraphOptimisation.All }));
    valueOf(await shared.open(fileOf('b'.repeat(64)).source, PINNED));
    expect(fake.opened).toHaveLength(3);
    valueOf(one).release();
  });

  it('answers a released hold as released, while the session serves every other', async () => {
    const shared = new SharedSessions(new FakeInference(FAKE_ADD));
    const file = fileOf('a'.repeat(64));
    const one = valueOf(await shared.open(file.source, PINNED));
    const other = valueOf(await shared.open(file.source, PINNED));

    one.release();
    one.release();

    expect(codesOf(await one.run(sums()))).toEqual(['inference.session-released']);
    expect(codesOf(await other.run(sums()))).toEqual([]);
  });

  it('keeps sessions nobody holds within its bound, letting the least recently let go go first', async () => {
    const fake = new FakeInference(FAKE_ADD);
    const shared = new SharedSessions(fake, 20);
    const first = fileOf('a'.repeat(64), 10);
    const second = fileOf('b'.repeat(64), 10);
    const third = fileOf('c'.repeat(64), 10);

    valueOf(await shared.open(first.source, PINNED)).release();
    valueOf(await shared.open(second.source, PINNED)).release();
    expect(fake.openSessions).toBe(2);
    // Opened again, the first is read no more and is now the more recent.
    valueOf(await shared.open(first.source, PINNED)).release();
    expect(first.reads).toBe(1);

    valueOf(await shared.open(third.source, PINNED)).release();
    expect(fake.openSessions).toBe(2);
    valueOf(await shared.open(second.source, PINNED)).release();
    expect(second.reads).toBe(2);
    expect(first.reads).toBe(1);

    shared.releaseIdle();
    expect(fake.openSessions).toBe(0);
  });

  it('never lets go of a session held, however far past its bound', async () => {
    const fake = new FakeInference(FAKE_ADD);
    const shared = new SharedSessions(fake, 4);
    const large = fileOf('a'.repeat(64), 100);

    const held = valueOf(await shared.open(large.source, PINNED));
    const again = valueOf(await shared.open(large.source, PINNED));
    shared.releaseIdle();
    expect(fake.openSessions).toBe(1);
    expect(large.reads).toBe(1);

    held.release();
    again.release();
    expect(fake.openSessions).toBe(0);
  });

  it("opens the file afresh with its own reader where another open's read failed", async () => {
    const fake = new FakeInference(FAKE_ADD);
    const shared = new SharedSessions(fake);
    const reading = deferred<DomainResult<ModelBytes>>();
    const refused = fileOf('a'.repeat(64), 8, () => reading.promise);
    const sound = fileOf('a'.repeat(64));

    const first = shared.open(refused.source, PINNED);
    const second = shared.open(sound.source, PINNED);
    reading.resolve(
      fail(failure('model-pack.file-missing', FailureKind.IntegrityViolation, 'Gone.')),
    );

    expect(codesOf(await first)).toEqual(['model-pack.file-missing']);
    valueOf(await second);
    expect(sound.reads).toBe(1);
    expect(fake.opened).toHaveLength(1);
  });

  it('gives up the hold of an open cancelled while it waits, keeping the session for the next', async () => {
    const fake = new FakeInference(FAKE_ADD);
    const shared = new SharedSessions(fake);
    const reading = deferred<DomainResult<ModelBytes>>();
    const file = fileOf('a'.repeat(64), 8, () => reading.promise);
    const opener = shared.open(file.source, PINNED);
    const caller = createCancellationSource();

    const waiting = shared.open(file.source, PINNED, caller.signal);
    caller.cancel();
    expect(codesOf(await waiting)).toEqual(['inference.cancelled']);

    reading.resolve(succeed(new Uint8Array(8)));
    valueOf(await opener).release();
    expect(fake.openSessions).toBe(1);
    shared.releaseIdle();
    expect(fake.openSessions).toBe(0);
  });
});
