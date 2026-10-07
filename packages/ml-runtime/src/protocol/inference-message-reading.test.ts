import { describe, expect, it } from 'vitest';

import { FailureKind, failure } from '@audiogubbins/domain';

import {
  GraphOptimisation,
  InferenceMode,
  PreviewAcceleratorKind,
  RuntimeBuild,
} from '../inference-options.js';
import { inProcessChannel } from '../testing/in-process-worker.js';
import {
  readFromInferenceWorker,
  readToInferenceThread,
  readToInferenceWorker,
} from './inference-message-reading.js';
import type { FromInferenceWorker, ToInferenceWorker } from './inference-messages.js';

const SETUP = {
  filesBase: 'https://audiogubbins.test/runtime/',
  webAssemblySha256: { [RuntimeBuild.Cpu]: 'a'.repeat(64), [RuntimeBuild.WebGpu]: 'b'.repeat(64) },
  capabilities: { fixedWidthSimd: true, threads: 4, webGpu: false },
};

const TO_WORKER: readonly ToInferenceWorker[] = [
  {
    kind: 'open',
    call: 1,
    model: new Uint8Array([8, 1]),
    options: { kind: InferenceMode.Pinned, graphOptimisation: GraphOptimisation.Extended },
  },
  {
    kind: 'open',
    call: 2,
    model: new Uint8Array([8, 1]),
    options: {
      kind: InferenceMode.Preview,
      graphOptimisation: GraphOptimisation.All,
      accelerator: { kind: PreviewAcceleratorKind.Threads, threads: 3 },
    },
  },
  {
    kind: 'run',
    call: 3,
    session: 1,
    inputs: [{ name: 'a', data: new Float32Array([1, 2, 3, 4]), dims: [2, 2] }],
  },
  { kind: 'cancel', call: 3 },
  { kind: 'release', session: 1 },
];

const FROM_WORKER: readonly FromInferenceWorker[] = [
  {
    kind: 'opened',
    call: 1,
    inputs: [{ name: 'a', dims: ['frames', 180] }],
    outputs: [{ name: 'mask', dims: ['', 961] }],
    execution: {
      options: {
        kind: InferenceMode.Preview,
        graphOptimisation: GraphOptimisation.All,
        accelerator: { kind: PreviewAcceleratorKind.WebGpu },
      },
      runtime: { name: 'onnxruntime-web', version: '1.30.0', webAssemblySha256: 'c'.repeat(64) },
    },
  },
  { kind: 'ran', call: 3, outputs: [{ name: 'c', data: new Float32Array([1]), dims: [1] }] },
  {
    kind: 'failed',
    call: 4,
    failures: [
      failure('inference.run-failed', FailureKind.Unrecoverable, 'It failed.', {
        details: { node: 'add', rank: 2, fatal: true },
        cause: failure('inference.cancelled', FailureKind.Rejected, 'It was cancelled.'),
      }),
    ],
  },
  {
    kind: 'refused',
    failures: [failure('inference.message-malformed', FailureKind.Rejected, 'No.')],
  },
];

/** The summary of the reading's first failure, or the empty text where it read. */
function refusal(read: { ok: boolean; failures?: readonly { summary: string }[] }): string {
  return read.ok ? '' : (read.failures?.[0]?.summary ?? '');
}

describe('the inference protocol', () => {
  it.each(TO_WORKER.map((message) => [message.kind, message] as const))(
    'reads a %s message the worker is sent, as it crosses a thread',
    (_kind, message) => {
      expect(readToInferenceWorker(structuredClone(message))).toEqual({ ok: true, value: message });
    },
  );

  it("reads the page's start and disconnect messages to the worker's scope, as they cross a thread", () => {
    for (const message of [
      { kind: 'start', setup: SETUP },
      { kind: 'disconnect', client: 3 },
    ] as const) {
      expect(readToInferenceThread(structuredClone(message))).toEqual({ ok: true, value: message });
    }
  });

  it("reads the page's connection of a thread with the channel's end it carries", () => {
    const [, port] = inProcessChannel();
    expect(readToInferenceThread({ kind: 'connect', client: 2, port })).toEqual({
      ok: true,
      value: { kind: 'connect', client: 2, port },
    });
    expect(refusal(readToInferenceThread({ kind: 'connect', client: 2, port: {} }))).toMatch(
      /port is not the end of a message channel/,
    );
  });

  it("refuses a start sent over a thread's channel, which only the page may send", () => {
    expect(refusal(readToInferenceWorker({ kind: 'start', setup: SETUP }))).toMatch(
      /kind is not one of/,
    );
  });

  it.each(FROM_WORKER.map((message) => [message.kind, message] as const))(
    'reads a %s message the worker sends, as it crosses a thread',
    (_kind, message) => {
      expect(readFromInferenceWorker(structuredClone(message))).toEqual({
        ok: true,
        value: message,
      });
    },
  );

  it.each([
    ['an unknown kind', { kind: 'reset' }, /kind is not one of/],
    ['a call that is no whole number', { kind: 'cancel', call: 1.5 }, /call is not a whole number/],
    [
      'a preview on no threads',
      {
        kind: 'open',
        call: 1,
        model: new Uint8Array(1),
        options: {
          kind: 'preview',
          graphOptimisation: 'all',
          accelerator: { kind: 'threads', threads: 0 },
        },
      },
      /threads is not a whole number, one or more/,
    ],
    [
      'an optimisation level the runtime does not have',
      {
        kind: 'open',
        call: 1,
        model: new Uint8Array(1),
        options: { kind: 'pinned', graphOptimisation: 'most' },
      },
      /graphOptimisation is not one of/,
    ],
    [
      'a model in shared memory, which cannot be moved',
      {
        kind: 'open',
        call: 1,
        model: new Uint8Array(new SharedArrayBuffer(4)),
        options: { kind: 'pinned', graphOptimisation: 'all' },
      },
      /model is not bytes in memory of their own/,
    ],
    [
      'a tensor of doubles',
      {
        kind: 'run',
        call: 1,
        session: 1,
        inputs: [{ name: 'a', data: new Float64Array(2), dims: [2] }],
      },
      /data is not 32-bit floats/,
    ],
    [
      'a tensor whose dimensions do not describe its data',
      {
        kind: 'run',
        call: 1,
        session: 1,
        inputs: [{ name: 'a', data: new Float32Array(3), dims: [2, 2] }],
      },
      /inputs\[0\]\.dims is not the dimensions of its data/,
    ],
  ])('refuses %s, naming the field', (_case, message, expected) => {
    const read = readToInferenceWorker(message);
    expect(read.ok ? [] : read.failures.map((one) => one.code)).toEqual([
      'inference.message-malformed',
    ]);
    expect(refusal(read)).toMatch(expected);
  });

  it.each([
    [
      'a digest that is not SHA-256 in lowercase hexadecimal',
      {
        kind: 'start',
        setup: { ...SETUP, webAssemblySha256: { cpu: 'A'.repeat(64), webgpu: 'b'.repeat(64) } },
      },
      /cpu is not a SHA-256 digest/,
    ],
    [
      'a base URL that does not end in a slash',
      { kind: 'start', setup: { ...SETUP, filesBase: 'https://audiogubbins.test/runtime' } },
      /filesBase is not a base URL ending in a slash/,
    ],
  ])('refuses a setup with %s, naming the field', (_case, message, expected) => {
    const read = readToInferenceThread(message);
    expect(read.ok ? [] : read.failures.map((one) => one.code)).toEqual([
      'inference.message-malformed',
    ]);
    expect(refusal(read)).toMatch(expected);
  });

  it.each([
    [
      'a failure with no failures',
      { kind: 'failed', call: 1, failures: [] },
      /failures is not a list of at least one/,
    ],
    [
      'a failure whose detail is an object',
      {
        kind: 'failed',
        call: 1,
        failures: [{ code: 'x', kind: 'rejected', summary: 'x', details: { nested: {} } }],
      },
      /details\.nested is not text, a number or a flag/,
    ],
    [
      'an input dimension that is neither a length nor a name',
      {
        kind: 'opened',
        call: 1,
        inputs: [{ name: 'a', dims: [-1] }],
        outputs: [],
        execution: FROM_WORKER[0]?.kind === 'opened' ? FROM_WORKER[0].execution : undefined,
      },
      /dims\[0\] is not a whole number/,
    ],
  ])('refuses a reply with %s, naming the field', (_case, message, expected) => {
    const read = readFromInferenceWorker(message);
    expect(read.ok ? [] : read.failures.map((one) => one.code)).toEqual([
      'inference.reply-malformed',
    ]);
    expect(refusal(read)).toMatch(expected);
  });
});
