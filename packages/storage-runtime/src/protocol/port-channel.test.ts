import { describe, expect, it, vi } from 'vitest';

import { TreeFailure, TreeFailureKind } from '@audiogubbins/project-format';

import { portPair, type PortPair } from '../testing/index.js';
import { Transferring, type Handlers, type Operation, type Stream } from './operations.js';
import { PortChannel } from './port-channel.js';

/** What the page calls on the worker in these tests. */
type WorkerOperations = {
  'echo.text': Operation<string, string>;
  'bytes.measure': Operation<ArrayBuffer, number>;
  'bytes.make': Operation<number, ArrayBuffer>;
  'call.wait': Operation<undefined, string>;
  'tree.refuse': Operation<undefined, undefined>;
  'handler.throw': Operation<undefined, undefined>;
  'answer.uncloneable': Operation<undefined, () => void>;
};

/** What the worker calls back on the page in these tests. */
type PageOperations = {
  'page.name': Operation<number, string>;
  'page.wait': Operation<undefined, string>;
};

/** What the worker serves and sends the page, a stream of each thing's counts among it. */
type WorkerSide = {
  operations: WorkerOperations;
  streams: {
    log: Stream<{ readonly line: number; readonly bytes?: ArrayBuffer }>;
    other: Stream<string>;
    [count: `count:${string}`]: Stream<number>;
  };
};

/** What the page serves and sends the worker. */
type PageSide = { operations: PageOperations; streams: { nudge: Stream<string> } };

/** A promise and what settles it, from outside. */
function deferred<TValue>(): { promise: Promise<TValue>; resolve: (value: TValue) => void } {
  let resolve: (value: TValue) => void = () => undefined;
  const promise = new Promise<TValue>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/** Waits for a later task, by which a message posted now has arrived. */
function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** A handler that waits until its call is abandoned, telling `started` its signal. */
function waiting(
  started: (signal: AbortSignal) => void,
): (argument: undefined, context: { signal: AbortSignal }) => Promise<string> {
  return async (_argument, { signal }) => {
    started(signal);
    await new Promise((resolve) => {
      signal.addEventListener('abort', resolve);
    });
    signal.throwIfAborted();
    return 'not abandoned';
  };
}

const WORKER_HANDLERS: Handlers<WorkerOperations> = {
  'echo.text': (text) => Promise.resolve(text),
  'bytes.measure': (bytes) => Promise.resolve(bytes.byteLength),
  'bytes.make': (length) => {
    const bytes = new ArrayBuffer(length);
    return Promise.resolve(new Transferring(bytes, [bytes]));
  },
  'call.wait': waiting(() => undefined),
  'tree.refuse': () => Promise.reject(new TreeFailure(TreeFailureKind.Quota, 'The disc is full.')),
  'handler.throw': () => Promise.reject(new Error('The handler broke.')),
  'answer.uncloneable': () => Promise.resolve(() => undefined),
};

/** A page and a worker, each with its side of the port, the worker serving `handlers`. */
function joined(handlers: Partial<Handlers<WorkerOperations>> = {}) {
  const pair = portPair();
  const page = new PortChannel<WorkerSide, PageSide>(pair.page);
  const worker = new PortChannel<PageSide, WorkerSide>(pair.worker);
  worker.serve({ ...WORKER_HANDLERS, ...handlers });
  return { pair, page, worker };
}

describe('a call across the port', () => {
  it('resolves to the answer the other side gave', async () => {
    const { page } = joined();

    await expect(page.call('echo.text', 'hello')).resolves.toBe('hello');
  });

  it('moves the buffers it transfers, in the call and in the answer', async () => {
    let made: ArrayBuffer | undefined;
    const { page } = joined({
      'bytes.make': (length) => {
        made = new ArrayBuffer(length);
        return Promise.resolve(new Transferring(made, [made]));
      },
    });
    const sent = new ArrayBuffer(8);

    await expect(page.call('bytes.measure', sent, { transfer: [sent] })).resolves.toBe(8);
    expect(sent.byteLength).toBe(0);
    expect((await page.call('bytes.make', 5)).byteLength).toBe(5);
    expect(made?.byteLength).toBe(0);
  });

  it('crosses calls in both directions at once, each answered to its own caller', async () => {
    const { page, worker } = joined();
    page.serve({
      'page.name': (index) => Promise.resolve(`page ${String(index)}`),
      'page.wait': waiting(() => undefined),
    });

    await expect(
      Promise.all([page.call('echo.text', 'worker'), worker.call('page.name', 1)]),
    ).resolves.toEqual(['worker', 'page 1']);
  });

  it('rebuilds a refusal of the storage tree with its kind', async () => {
    const { page } = joined();

    const refused = page.call('tree.refuse', undefined);
    await expect(refused).rejects.toBeInstanceOf(TreeFailure);
    await expect(refused).rejects.toMatchObject({
      kind: TreeFailureKind.Quota,
      message: 'The disc is full.',
    });
  });

  it('rejects with a fault where the handler throws anything else', async () => {
    const { page } = joined();

    const failed = page.call('handler.throw', undefined);
    await expect(failed).rejects.not.toBeInstanceOf(TreeFailure);
    await expect(failed).rejects.toThrow('The call of handler.throw failed: The handler broke.');
  });

  it('answers a fault for an answer the browser cannot clone, and goes on serving', async () => {
    const { page } = joined();

    await expect(page.call('answer.uncloneable', undefined)).rejects.toThrow(
      'The answer could not be sent',
    );
    await expect(page.call('echo.text', 'still')).resolves.toBe('still');
  });

  it('answers a fault for an operation the other side does not serve', async () => {
    const { pair } = joined();

    pair.sendToWorker({ type: 'call', id: 9, operation: 'library.burn', argument: 1 });

    await vi.waitFor(() => {
      expect(pair.toPage).toEqual([
        {
          type: 'answer',
          id: 9,
          outcome: { kind: 'fault', message: 'No operation named library.burn is served.' },
        },
      ]);
    });
  });

  it('drops an answer to no call waiting, and goes on answering', async () => {
    const { pair, page } = joined();

    pair.sendToPage({ type: 'answer', id: 40, outcome: { kind: 'value', value: 'stray' } });

    await expect(page.call('echo.text', 'next')).resolves.toBe('next');
  });

  it('serves its calls once', () => {
    const { worker } = joined();

    expect(() => {
      worker.serve(WORKER_HANDLERS);
    }).toThrow('already serves');
  });
});

describe('abandoning a call', () => {
  it("cancels it on the other side, whose signal aborts, and rejects with the signal's reason", async () => {
    const served = deferred<AbortSignal>();
    const { pair, page } = joined({ 'call.wait': waiting(served.resolve) });
    const controller = new AbortController();
    const reason = new Error('Stop.');

    const call = page.call('call.wait', undefined, { signal: controller.signal });
    const signal = await served.promise;
    controller.abort(reason);

    await expect(call).rejects.toBe(reason);
    await vi.waitFor(() => {
      expect(signal.aborted).toBe(true);
    });
    expect(signal.reason).toMatchObject({ name: 'AbortError' });
    expect(pair.toWorker).toContainEqual({ type: 'cancel', target: 0 });
  });

  it("answers cancelled where the handler rejects with its signal's reason", async () => {
    const served = deferred<AbortSignal>();
    const { pair, page } = joined({ 'call.wait': waiting(served.resolve) });
    const controller = new AbortController();

    const call = page.call('call.wait', undefined, { signal: controller.signal });
    await served.promise;
    controller.abort();
    await expect(call).rejects.toMatchObject({ name: 'AbortError' });

    await vi.waitFor(() => {
      expect(pair.toPage).toEqual([{ type: 'answer', id: 0, outcome: { kind: 'cancelled' } }]);
    });
  });

  it('settles only once the other side has given the call up', async () => {
    const served = deferred<AbortSignal>();
    const stopped = deferred<undefined>();
    const { page } = joined({
      'call.wait': async (_nothing, { signal }) => {
        served.resolve(signal);
        await stopped.promise;
        signal.throwIfAborted();
        return 'not abandoned';
      },
    });
    const controller = new AbortController();
    const reason = new Error('Stop.');
    let settled = false;

    const call = page.call('call.wait', undefined, { signal: controller.signal });
    void call.catch(() => undefined).finally(() => (settled = true));
    const signal = await served.promise;
    controller.abort(reason);
    await vi.waitFor(() => {
      expect(signal.aborted).toBe(true);
    });
    await nextTask();
    expect(settled).toBe(false);

    stopped.resolve(undefined);
    await expect(call).rejects.toBe(reason);
  });

  it('resolves to the answer where the other side carried the call out before it heard the cancel', async () => {
    const served = deferred<AbortSignal>();
    const { page } = joined({
      'call.wait': async (_nothing, { signal }) => {
        served.resolve(signal);
        await new Promise((resolve) => {
          signal.addEventListener('abort', resolve);
        });
        return 'carried out';
      },
    });
    const controller = new AbortController();

    const call = page.call('call.wait', undefined, { signal: controller.signal });
    await served.promise;
    controller.abort(new Error('Too late.'));

    await expect(call).resolves.toBe('carried out');
  });

  it("rejects with the signal's reason where a call given up failed all the same", async () => {
    const served = deferred<AbortSignal>();
    const { page } = joined({
      'call.wait': async (_nothing, { signal }) => {
        served.resolve(signal);
        await new Promise((resolve) => {
          signal.addEventListener('abort', resolve);
        });
        throw new Error('The handler broke as it stopped.');
      },
    });
    const controller = new AbortController();
    const reason = new Error('Stop.');

    const call = page.call('call.wait', undefined, { signal: controller.signal });
    await served.promise;
    controller.abort(reason);

    await expect(call).rejects.toBe(reason);
  });

  it('rejects as abandoned where the other side answers that it was cancelled', async () => {
    const { pair, page } = joined();

    const call = page.call('call.wait', undefined);
    pair.sendToPage({ type: 'answer', id: 0, outcome: { kind: 'cancelled' } });

    await expect(call).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('is harmless once the call is answered, on either side', async () => {
    const { pair, page } = joined();
    const controller = new AbortController();

    await page.call('echo.text', 'done', { signal: controller.signal });
    controller.abort();
    pair.sendToWorker({ type: 'cancel', target: 0 });

    await expect(page.call('echo.text', 'again')).resolves.toBe('again');
    expect(pair.toWorker).toEqual([
      { type: 'call', id: 0, operation: 'echo.text', argument: 'done' },
      { type: 'cancel', target: 0 },
      { type: 'call', id: 1, operation: 'echo.text', argument: 'again' },
    ]);
  });

  it('sends nothing where its signal has already aborted', async () => {
    const { pair, page } = joined();
    const reason = new Error('Already.');

    await expect(
      page.call('echo.text', 'never', { signal: AbortSignal.abort(reason) }),
    ).rejects.toBe(reason);
    expect(pair.toWorker).toEqual([]);
  });
});

describe('events across the port', () => {
  it('reach the listeners of their stream until each stops listening', async () => {
    const { page, worker } = joined();
    const heard: unknown[] = [];
    const stop = page.listen('log', (value) => heard.push(value));
    page.listen('other', () => heard.push('wrong stream'));
    const bytes = new ArrayBuffer(4);

    worker.emit('log', { line: 1, bytes }, [bytes]);
    await vi.waitFor(() => {
      expect(heard).toEqual([{ line: 1, bytes: new ArrayBuffer(4) }]);
    });
    expect(bytes.byteLength).toBe(0);

    stop();
    worker.emit('log', { line: 2 });
    await expect(page.call('echo.text', 'after')).resolves.toBe('after');
    expect(heard).toHaveLength(1);
  });

  it('reach only the listeners of their own key, where a stream is kept for each thing', async () => {
    const { page, worker } = joined();
    const heard: string[] = [];
    page.listen('count:a', (count) => heard.push(`a ${String(count)}`));
    page.listen('count:b', (count) => heard.push(`b ${String(count)}`));

    worker.emit('count:b', 2);
    worker.emit('count:a', 1);
    worker.emit('count:c', 3);

    await expect(page.call('echo.text', 'after')).resolves.toBe('after');
    expect(heard).toEqual(['b 2', 'a 1']);
  });

  it('cross from the page to the worker as well', async () => {
    const { page, worker } = joined();
    const heard: string[] = [];
    worker.listen('nudge', (text) => heard.push(text));

    page.emit('nudge', 'hello');

    await vi.waitFor(() => {
      expect(heard).toEqual(['hello']);
    });
  });
});

describe('a broken port', () => {
  it.each([
    [
      'a malformed message',
      (pair: PortPair) => {
        pair.sendToPage({ type: 'x' });
      },
    ],
    [
      'an unreadable message',
      (pair: PortPair) => {
        pair.spoilToPage();
      },
    ],
  ])('fails every call waiting and every call after with %s', async (_why, breakIt) => {
    const { pair, page } = joined();

    const pending = page.call('call.wait', undefined);
    breakIt(pair);

    const reason = await pending.then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(reason).toBeInstanceOf(Error);
    expect(reason).not.toBeInstanceOf(TreeFailure);
    await expect(page.call('echo.text', 'later')).rejects.toBe(reason);
  });

  it('fails every call waiting and every call after as unavailable when the worker fails', async () => {
    const { pair, page } = joined();

    const pending = page.call('call.wait', undefined);
    pair.fail();

    await expect(pending).rejects.toMatchObject({ kind: TreeFailureKind.Unavailable });
    await expect(page.call('echo.text', 'later')).rejects.toBeInstanceOf(TreeFailure);
  });

  it('aborts every call it was serving, and answers none of them', async () => {
    const served = deferred<AbortSignal>();
    const { pair, page, worker } = joined();
    page.serve({
      'page.name': (index) => Promise.resolve(String(index)),
      'page.wait': waiting(served.resolve),
    });

    void worker.call('page.wait', undefined);
    const signal = await served.promise;
    pair.fail();

    expect(signal.aborted).toBe(true);
    pair.sendToPage({ type: 'call', id: 5, operation: 'page.name', argument: 1 });
    await nextTask();
    await nextTask();
    expect(pair.toWorker).toEqual([]);
  });
});
