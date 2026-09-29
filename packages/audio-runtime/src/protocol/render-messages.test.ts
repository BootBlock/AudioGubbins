import { describe, expect, it } from 'vitest';

import {
  FailureKind,
  StandardLayouts,
  failure,
  sampleCount,
  sampleRate,
} from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { nodeId, type GraphDescriptor } from '@audiogubbins/audio-graph';
import {
  BuiltInNodeType,
  DspImplementation,
  ResamplingQuality,
  toneRecipe,
  PcmDescriptionKind,
} from '@audiogubbins/audio-engine';
import { dspModuleBytes, graphOf, nodeOf, wire } from '@audiogubbins/audio-engine/testing';

import { DspDeliveryKind } from '../dsp/dsp-delivery.js';
import {
  FromRenderWorkerKind,
  ToRenderWorkerKind,
  readFromRenderWorker,
  readToRenderWorker,
  type FromRenderWorker,
  type ToRenderWorker,
} from './render-messages.js';

const INPUT = expectSuccess(nodeId('in'));
const OUTPUT = expectSuccess(nodeId('out'));
const RATE = expectSuccess(sampleRate(48_000));
const CD_RATE = expectSuccess(sampleRate(44_100));

const GRAPH: GraphDescriptor = graphOf(
  [
    nodeOf('in', BuiltInNodeType.GraphInput, StandardLayouts.stereo, { outputs: ['out'] }),
    nodeOf('out', BuiltInNodeType.Output, StandardLayouts.stereo, { inputs: ['in'] }),
  ],
  [wire('in.out', 'out.in')],
);

function renderMessage(module: WebAssembly.Module | undefined): ToRenderWorker {
  return {
    kind: ToRenderWorkerKind.Render,
    jobId: 'render-1',
    graph: GRAPH,
    sampleRate: RATE,
    range: { start: expectSuccess(sampleCount(10)), length: expectSuccess(sampleCount(4_800)) },
    chunkFrames: 1_024,
    resamplingQuality: ResamplingQuality.High,
    coefficientBudgetBytes: module === undefined ? undefined : 250_000,
    sources: [
      {
        node: INPUT,
        kind: PcmDescriptionKind.Pcm,
        sampleRate: CD_RATE,
        channels: [new Float32Array([0.25, -0.5]), new Float32Array([0.125, 1])],
      },
      {
        node: expectSuccess(nodeId('tone')),
        kind: PcmDescriptionKind.Signal,
        sampleRate: RATE,
        recipe: expectSuccess(toneRecipe(2, 48_000, 1_000, 0.5)),
      },
    ],
    dsp:
      module === undefined
        ? { kind: DspDeliveryKind.Unavailable, reason: 'This page cannot compile WebAssembly.' }
        : { kind: DspDeliveryKind.Available, module },
  };
}

const REPLIES: readonly FromRenderWorker[] = [
  {
    kind: FromRenderWorkerKind.Progress,
    jobId: 'render-1',
    framesRendered: 1_024,
    framesTotal: 4_800,
  },
  {
    kind: FromRenderWorkerKind.Chunk,
    jobId: 'render-1',
    node: OUTPUT,
    channels: [new Float32Array([0.5, 0.25]), new Float32Array([-1, 0])],
  },
  {
    kind: FromRenderWorkerKind.Done,
    jobId: 'render-1',
    frames: expectSuccess(sampleCount(4_800)),
    latencyTrimmed: [[OUTPUT, expectSuccess(sampleCount(64))]],
    conversions: [{ node: INPUT, from: CD_RATE, to: RATE, quality: ResamplingQuality.Maximum }],
    dsp: DspImplementation.Reference,
    dspFallbackReason: 'This page cannot compile WebAssembly.',
  },
  {
    kind: FromRenderWorkerKind.Failed,
    jobId: 'render-1',
    failures: [
      failure('render.sink-unbound', FailureKind.Rejected, 'The sink out has nowhere to write.', {
        details: { node: 'out', frames: 64, aligned: false },
      }),
      failure('render.worker-busy', FailureKind.Conflict, 'This worker is busy.', {
        cause: failure('render.worker-fault', FailureKind.Unrecoverable, 'The cause.'),
      }),
    ],
  },
  { kind: FromRenderWorkerKind.Cancelled, jobId: 'render-1' },
  {
    kind: FromRenderWorkerKind.Refused,
    failures: [
      failure(
        'protocol.render-message-malformed',
        FailureKind.Rejected,
        "The message's kind is not one of render, chunk-taken, cancel.",
      ),
    ],
  },
];

/**
 * A message with each sample array as its tag and its samples, for comparing
 * a message with its clone. The clone's arrays are made in Node's realm, not
 * in the one Vitest runs this project's tests in, and `toEqual` refuses
 * typed arrays of two realms however equal their samples are.
 */
function comparable(value: unknown): unknown {
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    return {
      tag: Object.prototype.toString.call(value),
      samples: [
        ...new Float32Array(
          value.buffer,
          value.byteOffset,
          value.byteLength / Float32Array.BYTES_PER_ELEMENT,
        ),
      ],
    };
  }
  if (Array.isArray(value)) return value.map(comparable);
  if (
    typeof value === 'object' &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    return Object.fromEntries(
      Object.entries(value).map(([key, field]) => [key, comparable(field)]),
    );
  }
  return value;
}

/** The summary of a read's first failure, which names the field that was wrong. */
function refusalOf(result: ReturnType<typeof readToRenderWorker | typeof readFromRenderWorker>) {
  return result.ok ? undefined : result.failures[0].summary;
}

describe('the messages a render worker is sent', () => {
  it('reads a render back from its structured clone, with a compiled module', async () => {
    const module = await WebAssembly.compile(dspModuleBytes());
    const sent = renderMessage(module);

    const read = expectSuccess(readToRenderWorker(structuredClone(sent)));

    expect(comparable(read)).toEqual(comparable(sent));
    expect(
      read.kind === ToRenderWorkerKind.Render &&
        read.dsp.kind === DspDeliveryKind.Available &&
        read.dsp.module,
    ).toBeInstanceOf(WebAssembly.Module);
  });

  it('reads a render without a module, with the reason there is none', () => {
    const sent = renderMessage(undefined);

    expect(comparable(expectSuccess(readToRenderWorker(structuredClone(sent))))).toEqual(
      comparable(sent),
    );
  });

  it.each([ToRenderWorkerKind.ChunkTaken, ToRenderWorkerKind.Cancel])(
    'reads %s back from its structured clone',
    (kind) => {
      const sent: ToRenderWorker = { kind, jobId: 'render-7' };

      expect(comparable(expectSuccess(readToRenderWorker(structuredClone(sent))))).toEqual(
        comparable(sent),
      );
    },
  );

  it.each([
    ['kind', { kind: 'paint' }],
    ['jobId', { jobId: 7 }],
    ['graph', { graph: { version: 99, nodes: [], edges: [] } }],
    ['sampleRate', { sampleRate: 12.5 }],
    ['range', { range: 'all of it' }],
    ['length', { range: { start: 0, length: -1 } }],
    ['chunkFrames', { chunkFrames: 0.5 }],
    ['resamplingQuality', { resamplingQuality: 'best' }],
    ['sources', { sources: 'in' }],
    ['sources[0]', { sources: [null] }],
    ['kind', { sources: [{ node: 'in', kind: 'file', sampleRate: 48_000 }] }],
    ['node', { sources: [{ node: 'In Put', kind: 'pcm', sampleRate: 48_000, channels: [] }] }],
    ['channels', { sources: [{ node: 'in', kind: 'pcm', sampleRate: 48_000, channels: [[1]] }] }],
    [
      'recipe',
      { sources: [{ node: 'in', kind: 'signal', sampleRate: 48_000, recipe: { length: 1 } }] },
    ],
    ['coefficientBudgetBytes', { coefficientBudgetBytes: -1 }],
    ['coefficientBudgetBytes', { coefficientBudgetBytes: 'plenty' }],
    ['dsp', { dsp: undefined }],
    ['dsp.kind', { dsp: { kind: 'maybe', reason: 'Either.' } }],
    ['dsp.module', { dsp: { kind: 'available', module: new Uint8Array(8) } }],
    ['dsp.module', { dsp: { kind: 'available', reason: 'A reason, and no module.' } }],
    ['dsp.reason', { dsp: { kind: 'unavailable', reason: 3 } }],
    ['dsp.reason', { dsp: { kind: 'unavailable' } }],
  ])('refuses a render whose %s is wrong, naming it', (field, change) => {
    const read = readToRenderWorker({ ...renderMessage(undefined), ...change });

    expect(expectFailureCode(read)).toBe('protocol.render-message-malformed');
    expect(refusalOf(read)).toContain(`message's ${field} `);
  });
});

describe('the messages a render worker sends', () => {
  it.each(REPLIES.map((reply) => [reply.kind, reply] as const))(
    'reads %s back from its structured clone',
    (_kind, sent) => {
      expect(comparable(expectSuccess(readFromRenderWorker(structuredClone(sent))))).toEqual(
        comparable(sent),
      );
    },
  );

  it.each([
    ['kind', { kind: 'progress-bar', jobId: 'render-1' }],
    ['jobId', { kind: 'cancelled' }],
    ['framesRendered', { kind: 'progress', jobId: 'render-1', framesRendered: -1, framesTotal: 1 }],
    ['node', { kind: 'chunk', jobId: 'render-1', node: '', channels: [] }],
    [
      'channels',
      { kind: 'chunk', jobId: 'render-1', node: 'out', channels: [new Float64Array(1)] },
    ],
    ['failures', { kind: 'failed', jobId: 'render-1', failures: [] }],
    ['failures', { kind: 'refused', failures: 'broken' }],
    ['failures[0]', { kind: 'failed', jobId: 'render-1', failures: [404] }],
    ['code', { kind: 'failed', jobId: 'render-1', failures: [{ kind: 'rejected', summary: 's' }] }],
    [
      'kind',
      { kind: 'failed', jobId: 'render-1', failures: [{ code: 'c', kind: 'bad', summary: 's' }] },
    ],
    [
      'details.node',
      {
        kind: 'failed',
        jobId: 'render-1',
        failures: [{ code: 'c', kind: 'rejected', summary: 's', details: { node: [1] } }],
      },
    ],
    [
      'cause',
      {
        kind: 'failed',
        jobId: 'render-1',
        failures: [{ code: 'c', kind: 'rejected', summary: 's', cause: 'why' }],
      },
    ],
    ['latencyTrimmed', { ...REPLIES[2], latencyTrimmed: {} }],
    ['latencyTrimmed[0]', { ...REPLIES[2], latencyTrimmed: [['out']] }],
    ['frames', { ...REPLIES[2], latencyTrimmed: [['out', 1.5]] }],
    ['conversions[0]', { ...REPLIES[2], conversions: [7] }],
    [
      'quality',
      { ...REPLIES[2], conversions: [{ node: 'in', from: 44_100, to: 48_000, quality: 9 }] },
    ],
    ['dsp', { ...REPLIES[2], dsp: 'gpu' }],
  ])('refuses a reply whose %s is wrong, naming it', (field, reply) => {
    const read = readFromRenderWorker(reply);

    expect(expectFailureCode(read)).toBe('protocol.render-reply-malformed');
    expect(refusalOf(read)).toContain(`message's ${field} `);
  });
});
