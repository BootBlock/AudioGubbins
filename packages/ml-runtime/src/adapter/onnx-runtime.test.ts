import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  FailureKind,
  createCancellationSource,
  fail,
  failure,
  succeed,
  type DomainResult,
} from '@audiogubbins/domain';

import { GraphOptimisation, type RuntimeSetup } from '../inference-options.js';
import type { ModelSource } from '../inference-port.js';
import type { RuntimeFiles } from '../runtime-files.js';
import { EVERY_CAPABILITY } from '../testing/fake-inference.js';
import { PINNED, valueOf, vector } from '../testing/port-contract.js';
import {
  OnnxRuntimeInference,
  type OnnxRuntimeHost,
  type OnnxRuntimeModule,
  type OnnxSessionOptions,
} from './onnx-runtime.js';
import type { OnnxSession, OnnxTensor, OnnxValueMetadata } from './onnx-session.js';

/** The runtime's WebAssembly file, as the files port reads it. */
const FILE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1]);

function sha256Of(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

const SETUP: RuntimeSetup = {
  filesBase: 'https://audiogubbins.test/runtime/',
  webAssemblySha256: sha256Of(FILE),
  capabilities: EVERY_CAPABILITY,
};

/** The files port, reading `FILE` and recording each read. */
function filesOf(read: RuntimeFiles['read'] = () => Promise.resolve(succeed(FILE))) {
  return { read: vi.fn(read) } satisfies RuntimeFiles;
}

/** A promise and the functions that settle it, so a test decides when. */
function deferred<TValue>(): {
  readonly promise: Promise<TValue>;
  readonly resolve: (value: TValue) => void;
} {
  let resolve: (value: TValue) => void = () => undefined;
  const promise = new Promise<TValue>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/** A tensor of the fake runtime's. */
class RuntimeTensor implements OnnxTensor {
  readonly type = 'float32';
  readonly data: Float32Array;
  readonly dims: readonly number[];

  constructor(_type: 'float32', data: Float32Array, dims: readonly number[]) {
    this.data = data;
    this.dims = dims;
  }
}

const VECTOR: OnnxValueMetadata = { name: 'a', isTensor: true, type: 'float32', shape: ['n'] };

/** A session of the fake runtime's: `c = a + b`, its runs held while `gate` is set. */
class RuntimeSession implements OnnxSession {
  readonly inputMetadata: readonly OnnxValueMetadata[];
  readonly outputMetadata: readonly OnnxValueMetadata[] = [{ ...VECTOR, name: 'c' }];
  readonly runs: string[] = [];
  released = 0;
  gate: Promise<void> | undefined;
  failRun: Error | undefined;
  failRelease: Error | undefined;

  constructor(inputs: readonly OnnxValueMetadata[] = [VECTOR, { ...VECTOR, name: 'b' }]) {
    this.inputMetadata = inputs;
  }

  async run(
    feeds: Readonly<Record<string, OnnxTensor>>,
  ): Promise<Readonly<Record<string, unknown>>> {
    const a = feeds['a'];
    const b = feeds['b'];
    if (!(a instanceof RuntimeTensor) || !(b instanceof RuntimeTensor))
      throw new Error('No feeds.');
    this.runs.push(`start ${String(a.data[0])}`);
    await this.gate;
    this.runs.push(`end ${String(a.data[0])}`);
    if (this.failRun !== undefined) throw this.failRun;
    return {
      c: new RuntimeTensor(
        'float32',
        a.data.map((one, index) => one + (b.data[index] ?? 0)),
        a.dims,
      ),
    };
  }

  release(): Promise<void> {
    this.released += 1;
    return this.failRelease === undefined ? Promise.resolve() : Promise.reject(this.failRelease);
  }
}

/** A runtime build that makes `session`, and records how it was started and asked. */
function runtimeBuild(
  make: () => Promise<OnnxSession> = () => Promise.resolve(new RuntimeSession()),
) {
  const created: OnnxSessionOptions[] = [];
  const module: OnnxRuntimeModule = {
    env: { versions: { web: '1.30.0' }, wasm: {} },
    InferenceSession: {
      create: (_model, options) => {
        created.push(options);
        return make();
      },
    },
    Tensor: RuntimeTensor,
  };
  return { module, created };
}

/** An adapter over a fake build, with the spies that load it and read its file, and the faults it reports. */
function adapterOver(cpu = runtimeBuild(), files = filesOf()) {
  const load = vi.fn(() => Promise.resolve(cpu.module));
  const reportFault = vi.fn<OnnxRuntimeHost['reportFault']>();
  return {
    adapter: new OnnxRuntimeInference(SETUP, { load, files, reportFault }),
    load,
    files,
    reportFault,
  };
}

/** The model's file, its bytes made afresh at each read; the fake runtime reads none of them. */
const MODEL: ModelSource = {
  sha256: 'd'.repeat(64),
  read: () => Promise.resolve(succeed(new Uint8Array([1, 2, 3]))),
};

function codesOf<TValue>(result: DomainResult<TValue>): readonly string[] {
  return result.ok ? [] : result.failures.map((one) => one.code);
}

function sums() {
  return new Map([
    ['a', vector([1, 2])],
    ['b', vector([10, 20])],
  ]);
}

describe('the adapter over ONNX Runtime Web', () => {
  it('imports the runtime on the first session, and once however many sessions it serves', async () => {
    const { adapter, load } = adapterOver();
    expect(load).not.toHaveBeenCalled();

    valueOf(await adapter.open(MODEL, PINNED));
    valueOf(await adapter.open(MODEL, PINNED));

    expect(load).toHaveBeenCalledOnce();
  });

  it('starts a pinned session on the WebAssembly backend alone, on one thread, with fixed-width SIMD, at the level stated', async () => {
    const cpu = runtimeBuild();
    const { adapter } = adapterOver(cpu);

    valueOf(await adapter.open(MODEL, PINNED));

    expect(cpu.module.env.wasm).toEqual({
      numThreads: 1,
      simd: 'fixed',
      proxy: false,
      wasmBinary: FILE,
    });
    expect(cpu.created).toEqual([
      {
        executionProviders: ['wasm'],
        graphOptimizationLevel: GraphOptimisation.Extended,
        intraOpNumThreads: 1,
        interOpNumThreads: 1,
        executionMode: 'sequential',
      },
    ]);
  });

  it('says it ran on the version the runtime gives and the digest of the file it was given', async () => {
    const { adapter } = adapterOver();
    const session = valueOf(await adapter.open(MODEL, PINNED));
    expect(session.execution).toEqual({
      options: PINNED,
      runtime: {
        name: 'onnxruntime-web',
        version: '1.30.0',
        webAssemblySha256: sha256Of(FILE),
      },
    });
  });

  it('gives the runtime the very bytes the files port read, and sets it no path to fetch from', async () => {
    const cpu = runtimeBuild();
    const { adapter, files } = adapterOver(cpu);

    valueOf(await adapter.open(MODEL, PINNED));

    expect(files.read).toHaveBeenCalledOnce();
    expect(cpu.module.env.wasm.wasmBinary).toBe(FILE);
    expect(Object.keys(cpu.module.env.wasm)).not.toContain('wasmPaths');
  });

  it('refuses a WebAssembly file whose digest is not the setup’s, naming the file and both digests, and never imports the runtime', async () => {
    const cpu = runtimeBuild();
    const tampered = FILE.slice();
    tampered[8] = 9;
    const { adapter, load } = adapterOver(
      cpu,
      filesOf(() => Promise.resolve(succeed(tampered))),
    );

    const opened = await adapter.open(MODEL, PINNED);

    expect(codesOf(opened)).toEqual(['inference.runtime-file-mismatch']);
    const reason = opened.ok ? undefined : opened.failures[0];
    const expected = SETUP.webAssemblySha256;
    expect(reason?.kind).toBe(FailureKind.IntegrityViolation);
    expect(reason?.summary).toContain('ort-wasm-simd-threaded.wasm');
    expect(reason?.summary).toContain(sha256Of(tampered));
    expect(reason?.summary).toContain(expected);
    expect(reason?.details).toEqual({
      file: 'ort-wasm-simd-threaded.wasm',
      expectedSha256: expected,
      foundSha256: sha256Of(tampered),
    });
    expect(load).not.toHaveBeenCalled();
    expect(cpu.created).toEqual([]);
    expect(cpu.module.env.wasm).toEqual({});
  });

  it('reads the file once for every session, and again after a read that failed', async () => {
    const files = filesOf();
    files.read.mockResolvedValueOnce(
      fail(failure('inference.runtime-file-unavailable', FailureKind.Unrecoverable, 'Offline.')),
    );
    const { adapter, load } = adapterOver(runtimeBuild(), files);

    expect(codesOf(await adapter.open(MODEL, PINNED))).toEqual([
      'inference.runtime-file-unavailable',
    ]);
    expect(load).not.toHaveBeenCalled();
    valueOf(await adapter.open(MODEL, PINNED));
    valueOf(await adapter.open(MODEL, PINNED));

    expect(files.read).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenCalledOnce();
  });

  it('refuses a session whose backend cannot start, and tries no other', async () => {
    const cpu = runtimeBuild(() =>
      Promise.reject(
        new Error('no available backend found. ERR: [wasm] RuntimeError: unreachable'),
      ),
    );
    const { adapter } = adapterOver(cpu);

    const opened = await adapter.open(MODEL, PINNED);

    expect(codesOf(opened)).toEqual(['inference.runtime-unavailable']);
    expect(opened.ok ? '' : opened.failures[0].summary).toMatch(
      /refused rather than run on another/,
    );
    expect(cpu.created.map((options) => options.executionProviders)).toEqual([['wasm']]);
  });

  it('refuses every session where the runtime could not be imported', async () => {
    const { adapter, load } = adapterOver();
    load.mockImplementation(() => Promise.reject(new Error('The module did not load.')));

    expect(codesOf(await adapter.open(MODEL, PINNED))).toEqual(['inference.runtime-unavailable']);
    expect(codesOf(await adapter.open(MODEL, PINNED))).toEqual(['inference.runtime-unavailable']);
    expect(load).toHaveBeenCalledOnce();
  });

  it('refuses a runtime that does not say its version, which a pinned render records', async () => {
    const cpu = runtimeBuild();
    const { adapter } = adapterOver({
      ...cpu,
      module: { ...cpu.module, env: { versions: {}, wasm: {} } },
    });
    expect(codesOf(await adapter.open(MODEL, PINNED))).toEqual(['inference.runtime-unavailable']);
  });

  it('refuses a model the runtime refuses, as the model and not the runtime', async () => {
    const cpu = runtimeBuild(() =>
      Promise.reject(new Error('Load model failed: protobuf parsing failed.')),
    );
    const { adapter } = adapterOver(cpu);
    expect(codesOf(await adapter.open(MODEL, PINNED))).toEqual(['inference.model-refused']);
  });

  it('lets go of a session whose model takes what no pack needs', async () => {
    const integers = new RuntimeSession([{ name: 'a', isTensor: true, type: 'int64', shape: [1] }]);
    const { adapter } = adapterOver(runtimeBuild(() => Promise.resolve(integers)));

    expect(codesOf(await adapter.open(MODEL, PINNED))).toEqual(['inference.model-unsupported']);
    expect(integers.released).toBe(1);
  });

  it('lets go of a session that opens after its caller cancelled', async () => {
    const session = new RuntimeSession();
    const creating = deferred<OnnxSession>();
    const cpu = runtimeBuild(() => creating.promise);
    const { adapter } = adapterOver(cpu);
    const caller = createCancellationSource();

    const opening = adapter.open(MODEL, PINNED, caller.signal);
    await vi.waitFor(() => {
      expect(cpu.created).toHaveLength(1);
    });
    caller.cancel();
    expect(codesOf(await opening)).toEqual(['inference.cancelled']);

    creating.resolve(session);
    await vi.waitFor(() => {
      expect(session.released).toBe(1);
    });
  });

  it('takes runs on one session in turn, as the runtime needs', async () => {
    const runtimeSession = new RuntimeSession();
    const gate = deferred<undefined>();
    runtimeSession.gate = gate.promise.then(() => undefined);
    const { adapter } = adapterOver(runtimeBuild(() => Promise.resolve(runtimeSession)));
    const session = valueOf(await adapter.open(MODEL, PINNED));

    const first = session.run(
      new Map([
        ['a', vector([1])],
        ['b', vector([1])],
      ]),
    );
    const second = session.run(
      new Map([
        ['a', vector([2])],
        ['b', vector([1])],
      ]),
    );
    await vi.waitFor(() => {
      expect(runtimeSession.runs).toEqual(['start 1']);
    });
    gate.resolve(undefined);

    expect([...(valueOf(await first).get('c')?.data ?? [])]).toEqual([2]);
    expect([...(valueOf(await second).get('c')?.data ?? [])]).toEqual([3]);
    expect(runtimeSession.runs).toEqual(['start 1', 'end 1', 'start 2', 'end 2']);
  });

  it('answers a run the runtime fails as failed, and keeps the session for the next', async () => {
    const runtimeSession = new RuntimeSession();
    const { adapter } = adapterOver(runtimeBuild(() => Promise.resolve(runtimeSession)));
    const session = valueOf(await adapter.open(MODEL, PINNED));

    runtimeSession.failRun = new Error('Named dimension n disagrees.');
    expect(codesOf(await session.run(sums()))).toEqual(['inference.run-failed']);
    runtimeSession.failRun = undefined;
    expect(valueOf(await session.run(sums())).get('c')?.dims).toEqual([2]);
  });

  it('answers a run waiting on a session that is let go as released, and frees the session after the run in hand', async () => {
    const runtimeSession = new RuntimeSession();
    const gate = deferred<undefined>();
    runtimeSession.gate = gate.promise.then(() => undefined);
    const { adapter } = adapterOver(runtimeBuild(() => Promise.resolve(runtimeSession)));
    const session = valueOf(await adapter.open(MODEL, PINNED));

    const running = session.run(sums());
    const waiting = session.run(sums());
    await vi.waitFor(() => {
      expect(runtimeSession.runs).toEqual(['start 1']);
    });
    session.release();

    expect(codesOf(await running)).toEqual(['inference.session-released']);
    expect(codesOf(await waiting)).toEqual(['inference.session-released']);
    expect(runtimeSession.released).toBe(0);
    gate.resolve(undefined);
    await vi.waitFor(() => {
      expect(runtimeSession.released).toBe(1);
    });
    expect(runtimeSession.runs).toEqual(['start 1', 'end 1']);
  });

  it('reports a session the runtime cannot free, which no caller can act on', async () => {
    const runtimeSession = new RuntimeSession();
    runtimeSession.failRelease = new Error('The session could not be freed.');
    const { adapter, reportFault } = adapterOver(
      runtimeBuild(() => Promise.resolve(runtimeSession)),
    );
    const session = valueOf(await adapter.open(MODEL, PINNED));

    session.release();

    await vi.waitFor(() => {
      expect(reportFault).toHaveBeenCalledWith(runtimeSession.failRelease);
    });
  });
});
